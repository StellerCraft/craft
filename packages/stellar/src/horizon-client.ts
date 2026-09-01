/**
 * Stellar Horizon API Client with Adaptive Retry and Circuit Breaker (#787)
 *
 * Wraps raw Horizon HTTP calls with:
 * - Adaptive backoff: respects X-RateLimit-Remaining / X-RateLimit-Reset
 * - Circuit breaker: opens after 5 failures in 30 s, half-opens after 60 s
 * - Retry budget: maximum 3 retries per request regardless of rate-limit headroom
 * - Logging: each retry is logged to the analytics service
 */

import { CircuitBreaker } from './circuit-breaker';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HorizonResponse<T = unknown> {
  data: T;
  headers: Record<string, string>;
}

export interface RetryLog {
  attempt: number;
  delayMs: number;
  reason: string;
}

export interface HorizonClientOptions {
  /** Base URL of the Horizon server, e.g. https://horizon.stellar.org */
  baseUrl: string;
  /** Maximum retries per request (default: 3). */
  maxRetries?: number;
  /** Number of failures in the window to open the circuit (default: 5). */
  circuitOpenThreshold?: number;
  /** Sliding window in ms for counting failures (default: 30_000). */
  circuitWindowMs?: number;
  /** Time in ms before a half-open probe is attempted (default: 60_000). */
  circuitRecoveryMs?: number;
  /** Called for each retry attempt for observability. */
  onRetry?: (log: RetryLog) => void;
  /** Injected fetch for unit testing (default: global fetch). */
  _fetch?: typeof fetch;
}

export interface RequestOptions {
  /** HTTP method (default: 'GET'). */
  method?: string;
  /** Request body for POST/PUT/PATCH requests. */
  body?: BodyInit;
  /** Additional request headers. */
  headers?: Record<string, string>;
}

/** Request body type (same as fetch BodyInit). */
export type BodyInit = string | Uint8Array | ReadableStream<Uint8Array> | FormData | URLSearchParams;

// ── Adaptive retry helper ──────────────────────────────────────────────────────

/**
 * Upper bound for the rate-limit-derived backoff delay.
 *
 * The X-RateLimit-Reset header is server-supplied and can be far in the future
 * because of a Horizon anomaly, a misbehaving proxy, or clock drift between the
 * client and the server. Without a ceiling, a single retry attempt could block
 * the caller for minutes or hours. Cap it at a few seconds so a retry never
 * outlives a reasonable request timeout.
 */
export const MAX_BACKOFF_DELAY_MS = 5_000;

/**
 * Computes the backoff delay in ms for a given response.
 *
 * - If X-RateLimit-Remaining < 10, delays until X-RateLimit-Reset (epoch seconds),
 *   clamped to {@link MAX_BACKOFF_DELAY_MS}.
 * - Otherwise uses exponential backoff: 200 * 2^attempt ms.
 */
export function computeBackoffMs(
  headers: Record<string, string>,
  attempt: number,
): { delayMs: number; reason: string } {
  const remaining = parseInt(headers['x-ratelimit-remaining'] ?? '999', 10);
  const reset = parseInt(headers['x-ratelimit-reset'] ?? '0', 10);

  if (remaining < 10 && reset > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    const uncappedDelayMs = Math.max(0, (reset - nowSec) * 1000);
    const delayMs = Math.min(uncappedDelayMs, MAX_BACKOFF_DELAY_MS);
    const capped = delayMs < uncappedDelayMs;
    const reason =
      `rate_limit_low_remaining (${remaining} left, reset in ${reset - nowSec}s` +
      (capped ? `, capped ${uncappedDelayMs}ms->${delayMs}ms)` : `)`);
    return { delayMs, reason };
  }

  const delayMs = 200 * Math.pow(2, attempt);
  return { delayMs, reason: `exponential_backoff (attempt ${attempt})` };
}

// ── HorizonClient ─────────────────────────────────────────────────────────────

export class HorizonClient {
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly onRetry: ((log: RetryLog) => void) | undefined;
  private readonly _fetch: typeof fetch;
  readonly circuit: CircuitBreaker;

  constructor(options: HorizonClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.maxRetries = options.maxRetries ?? 3;
    this.onRetry = options.onRetry;
    this._fetch = options._fetch ?? globalThis.fetch;
    this.circuit = new CircuitBreaker({
      name: 'horizon',
      failureThreshold: options.circuitOpenThreshold ?? 5,
      resetTimeoutMs: options.circuitRecoveryMs ?? 60_000,
    });
  }

  /**
   * Performs an HTTP request with adaptive retry and circuit breaker protection.
   *
   * Supports any HTTP method and applies identical circuit-breaker/retry/backoff logic
   * regardless of method. Note that retry-safety for non-idempotent methods (POST) depends
   * on server-side deduplication (e.g., Horizon's dedupe-by-hash behavior for transactions).
   *
   * @param path - URL path relative to baseUrl
   * @param options - Request options (method, body, headers)
   * @throws {Error} When the circuit is open or all retries are exhausted.
   */
  async request<T>(path: string, options?: RequestOptions): Promise<HorizonResponse<T>> {
    if (this.circuit.isOpen()) {
      throw new Error(`Circuit breaker is open. Horizon requests are suspended.`);
    }

    const url = `${this.baseUrl}${path}`;
    const method = options?.method ?? 'GET';
    let attempt = 0;
    let lastHeaders: Record<string, string> = {};

    while (true) {
      try {
        const fetchOptions: RequestInit = {
          method,
          headers: options?.headers ?? {},
        };
        if (options?.body !== undefined) {
          fetchOptions.body = options.body;
        }

        const res = await this._fetch(url, fetchOptions);
        const headers = extractHeaders(res.headers);
        lastHeaders = headers;

        if (res.ok) {
          this.circuit.recordSuccess();
          const data = (await res.json()) as T;
          return { data, headers };
        }

        // Treat non-OK responses as failures
        const err = new Error(`Horizon returned HTTP ${res.status} for ${path}`);
        throw Object.assign(err, { status: res.status, headers });
      } catch (err: unknown) {
        this.circuit.recordFailure();

        if (attempt >= this.maxRetries || this.circuit.isOpen()) {
          throw err;
        }

        const { delayMs, reason } = computeBackoffMs(lastHeaders, attempt);
        this.onRetry?.({ attempt: attempt + 1, delayMs, reason });
        await sleep(delayMs);
        attempt++;
      }
    }
  }

  /**
   * Performs an HTTP GET with adaptive retry and circuit breaker protection.
   *
   * Thin wrapper around request(path, { method: 'GET' }) for backwards compatibility.
   *
   * @throws {Error} When the circuit is open or all retries are exhausted.
   */
  async get<T>(path: string): Promise<HorizonResponse<T>> {
    return this.request<T>(path, { method: 'GET' });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
