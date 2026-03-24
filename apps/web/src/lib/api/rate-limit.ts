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

// ── Pre-defined configs for auth-sensitive routes ────────────────────────────

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

// ── Store ────────────────────────────────────────────────────────────────────

// Map<key, timestamps[]> — each entry is a sorted list of request timestamps.
const store = new Map<string, number[]>();

// ── Core logic ───────────────────────────────────────────────────────────────

/**
 * Check and record a request against the rate limit for the given key.
 * Pure function over the shared store — no I/O.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Retrieve and prune timestamps outside the current window.
  const timestamps = (store.get(key) ?? []).filter((t) => t > windowStart);

  const allowed = timestamps.length < config.limit;

  if (allowed) {
    timestamps.push(now);
    store.set(key, timestamps);
  }

  const oldest = timestamps[0] ?? now;
  const resetAt = oldest + config.windowMs;

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
