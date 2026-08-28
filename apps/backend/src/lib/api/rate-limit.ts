/**
 * In-memory sliding-window rate limiter.
 *
 * Suitable for single-instance / local-dev use.
 * In production with multiple replicas, swap the store for a shared
 * Redis/Upstash backend — the RateLimiter interface stays the same.
 *
 * Configuration
 * ─────────────
 * Each "limit config" defines:
 *   - limit      : max requests allowed in the window
 *   - windowMs   : rolling window length in milliseconds
 *
 * Request key
 * ───────────
 * Keys are derived from the client IP (x-forwarded-for → x-real-ip →
 * "unknown") combined with a route identifier so limits are scoped
 * per-endpoint, not globally.
 *
 * Local development
 * ─────────────────
 * Set RATE_LIMIT_DISABLED=true in .env.local to bypass all checks.
 * Thresholds are intentionally generous in dev to avoid friction.
 *
 * See "Rate Limiting, Idempotency, and Tier Enforcement" in CONTRIBUTING.md
 * for the full env-var reference.
 */

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Rolling window duration in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (ms) when the oldest request in the window expires. */
  resetAt: number;
  /** How many ms until the window resets (convenience alias). */
  retryAfterMs: number;
}

// ── Pre-defined configs per endpoint type ────────────────────────────────────

/** Strict limit for credential submission (sign-in / sign-up). */
export const AUTH_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 15 * 60 * 1000, // 10 attempts per 15 minutes
};

/** Lighter limit for read-only auth endpoints (user, profile). */
export const AUTH_READ_RATE_LIMIT: RateLimitConfig = {
  limit: 60,
  windowMs: 60 * 1000, // 60 requests per minute
};

/** General API endpoints (templates, deployments, analytics). */
export const API_RATE_LIMIT: RateLimitConfig = {
  limit: 120,
  windowMs: 60 * 1000, // 120 requests per minute
};

/** Mutation endpoints (create/update/delete deployments, drafts). */
export const MUTATION_RATE_LIMIT: RateLimitConfig = {
  limit: 30,
  windowMs: 60 * 1000, // 30 mutations per minute
};

/** Webhook endpoints — high throughput, verified by signature. */
export const WEBHOOK_RATE_LIMIT: RateLimitConfig = {
  limit: 500,
  windowMs: 60 * 1000, // 500 per minute
};

/** Cron endpoints — called by Vercel Cron, very low expected volume. */
export const CRON_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 60 * 1000, // 10 per minute
};

// ── Store ────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  /** Sorted list of request timestamps (ms) within the window. */
  timestamps: number[];
  /** Rolling window length (ms) — retained so expired entries can be swept. */
  windowMs: number;
}

// Map<key, entry> — each entry tracks its own window so a low-frequency sweep
// can evict fully-expired entries independent of fresh traffic on that key.
const store = new Map<string, RateLimitEntry>();

// ── Bounded growth ───────────────────────────────────────────────────────────

// Lazily-triggered sweep that evicts fully-expired entries. This bounds memory
// growth from one-off clients (scanners, bots, rotating CDN/proxy IPs) that make
// a single request and never return — their entry would otherwise linger until
// the next request on that key, which may never come.
const SWEEP_INTERVAL_CALLS = parseInt(
  process.env.RATE_LIMIT_SWEEP_INTERVAL ?? '1000',
  10,
);
const SWEEP_EVERY =
  Number.isFinite(SWEEP_INTERVAL_CALLS) && SWEEP_INTERVAL_CALLS > 0
    ? SWEEP_INTERVAL_CALLS
    : 1000;

let callCount = 0;

function sweepStore(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    const windowStart = now - entry.windowMs;
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

function maybeSweep(): void {
  callCount += 1;
  if (callCount % SWEEP_EVERY === 0) sweepStore();
}

// ── Core logic ───────────────────────────────────────────────────────────────

/**
 * Check and record a request against the rate limit for the given key.
 * Pure function over the shared store — no I/O.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Retrieve and prune timestamps outside the current window.
  const existing = store.get(key);
  const timestamps = (existing?.timestamps ?? []).filter((t) => t > windowStart);

  const allowed = timestamps.length < config.limit;

  if (allowed) {
    timestamps.push(now);
    store.set(key, { timestamps, windowMs: config.windowMs });
  } else if (timestamps.length === 0) {
    // Pruning left nothing and the request was not allowed to extend the
    // window — drop the stale empty entry rather than leaving it behind.
    store.delete(key);
  }

  const oldest = timestamps[0] ?? now;
  const resetAt = oldest + config.windowMs;

  maybeSweep();

  return {
    allowed,
    remaining: Math.max(0, config.limit - timestamps.length),
    resetAt,
    retryAfterMs: Math.max(0, resetAt - now),
  };
}

/**
 * Derive a stable rate-limit key from a Next.js request and a route label.
 *
 * Priority: x-forwarded-for → x-real-ip → "unknown"
 */
export function getRateLimitKey(req: { headers: { get(name: string): string | null } }, route: string): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : (req.headers.get('x-real-ip') ?? 'unknown');
  return `${route}:${ip}`;
}

/** Clears the in-memory store — intended for use in tests only. */
export function _resetStore(): void {
  store.clear();
}

/** Returns the number of keys currently held in the store — for tests/observability. */
export function _storeSize(): number {
  return store.size;
}

/** Force an immediate sweep of fully-expired entries — exposed for tests. */
export function _sweepStore(): void {
  sweepStore();
}
