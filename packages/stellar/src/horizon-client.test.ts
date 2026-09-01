/**
 * Horizon API Client Tests (#787)
 *
 * Tests for adaptive retry, circuit breaker state transitions,
 * and retry budget exhaustion.
 */

import { describe, it, expect, vi } from 'vitest';
import { HorizonClient, computeBackoffMs, MAX_BACKOFF_DELAY_MS } from './horizon-client';
import { CircuitBreaker } from './circuit-breaker';

const BASE_URL = 'https://horizon-testnet.stellar.org';

function makeResponse(
  status: number,
  headers: Record<string, string> = {},
  body: unknown = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: {
      forEach(cb: (value: string, key: string) => void) {
        Object.entries(headers).forEach(([k, v]) => cb(v, k));
      },
    },
  } as unknown as Response;
}

// ── computeBackoffMs ──────────────────────────────────────────────────────────

describe('computeBackoffMs', () => {
  it('uses exponential backoff when rate limit is healthy', () => {
    const { delayMs, reason } = computeBackoffMs({ 'x-ratelimit-remaining': '50' }, 0);
    expect(delayMs).toBe(200);
    expect(reason).toContain('exponential_backoff');
  });

  it('uses reset-based delay when remaining < 10', () => {
    const resetSec = Math.floor(Date.now() / 1000) + 5;
    const { delayMs, reason } = computeBackoffMs(
      { 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': String(resetSec) },
      0,
    );
    expect(delayMs).toBeGreaterThan(0);
    expect(reason).toContain('rate_limit_low_remaining');
  });

  it('returns 0 delay when reset time has already passed', () => {
    const pastReset = Math.floor(Date.now() / 1000) - 10;
    const { delayMs } = computeBackoffMs(
      { 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': String(pastReset) },
      0,
    );
    expect(delayMs).toBe(0);
  });

  it('doubles delay on each attempt for exponential backoff', () => {
    const { delayMs: d0 } = computeBackoffMs({}, 0);
    const { delayMs: d1 } = computeBackoffMs({}, 1);
    const { delayMs: d2 } = computeBackoffMs({}, 2);
    expect(d1).toBe(d0 * 2);
    expect(d2).toBe(d0 * 4);
  });

  it('caps a far-future X-RateLimit-Reset delay instead of returning it unbounded (#1115)', () => {
    // Reset one hour in the future (clock skew / Horizon anomaly / bad proxy).
    const farFutureReset = Math.floor(Date.now() / 1000) + 3600;
    const { delayMs, reason } = computeBackoffMs(
      { 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String(farFutureReset) },
      0,
    );

    // Without the cap this would be ~3_600_000 ms.
    expect(delayMs).toBe(MAX_BACKOFF_DELAY_MS);
    expect(delayMs).toBeLessThanOrEqual(MAX_BACKOFF_DELAY_MS);
    expect(reason).toContain('rate_limit_low_remaining');
    expect(reason).toContain('capped');
  });

  it('does not mark a within-cap reset delay as capped (#1115)', () => {
    const resetSec = Math.floor(Date.now() / 1000) + 2;
    const { delayMs, reason } = computeBackoffMs(
      { 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String(resetSec) },
      0,
    );
    expect(delayMs).toBeLessThanOrEqual(MAX_BACKOFF_DELAY_MS);
    expect(reason).not.toContain('capped');
  });
});

// ── CircuitBreaker ────────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 5, resetTimeoutMs: 60_000 });
    expect(cb.currentState).toBe('CLOSED');
    expect(cb.isOpen()).toBe(false);
  });

  it('opens after threshold failures', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 5, resetTimeoutMs: 60_000 });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.currentState).toBe('OPEN');
    expect(cb.isOpen()).toBe(true);
  });

  it('transitions to half-open after recovery period', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
      resetTimeoutMs: 60_000,
      now: () => Date.now(),
    });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.currentState).toBe('OPEN');

    vi.advanceTimersByTime(60_001);
    expect(cb.getState()).toBe('HALF_OPEN');
    vi.useRealTimers();
  });

  it('closes on success after half-open', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
      resetTimeoutMs: 60_000,
      now: () => Date.now(),
    });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    vi.advanceTimersByTime(60_001);
    cb.recordSuccess();
    expect(cb.getState()).toBe('CLOSED');
    vi.useRealTimers();
  });

  it('reopens immediately on failure while half-open', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker({
      name: 'test',
      failureThreshold: 5,
      resetTimeoutMs: 60_000,
      now: () => Date.now(),
    });
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.currentState).toBe('OPEN');

    vi.advanceTimersByTime(60_001);
    expect(cb.getState()).toBe('HALF_OPEN');

    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    vi.useRealTimers();
  });

  it('resets failure count after success', () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 5, resetTimeoutMs: 60_000 });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    cb.recordSuccess();
    // 4 more failures should not open because failure count was reset
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.currentState).toBe('CLOSED');
  });
});

// ── HorizonClient ─────────────────────────────────────────────────────────────

describe('HorizonClient – successful request', () => {
  it('returns parsed JSON data on HTTP 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(200, {}, { id: 'account1' }));
    const client = new HorizonClient({ baseUrl: BASE_URL, _fetch: mockFetch });

    const result = await client.get('/accounts/G123');
    expect(result.data).toEqual({ id: 'account1' });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('records circuit success on HTTP 200', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(200, {}, {}));
    const client = new HorizonClient({ baseUrl: BASE_URL, _fetch: mockFetch });

    await client.get('/ledgers');
    expect(client.circuit.currentState).toBe('CLOSED');
  });
});

describe('HorizonClient – retry and rate limit backoff', () => {
  it('retries on non-OK response and succeeds on second attempt', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(503, {}))
      .mockResolvedValueOnce(makeResponse(200, {}, { ok: true }));

    const retryLogs: unknown[] = [];
    const client = new HorizonClient({
      baseUrl: BASE_URL,
      _fetch: mockFetch,
      onRetry: (log) => retryLogs.push(log),
    });

    // Patch sleep to avoid real delays
    const result = await client.get('/transactions');
    expect(result.data).toEqual({ ok: true });
    expect(retryLogs).toHaveLength(1);
  });

  it('calls onRetry with delay and reason on each retry', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(429, { 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1) }))
      .mockResolvedValueOnce(makeResponse(200, {}, {}));

    const retryLogs: Array<{ attempt: number; delayMs: number; reason: string }> = [];
    const client = new HorizonClient({
      baseUrl: BASE_URL,
      _fetch: mockFetch,
      onRetry: (log) => retryLogs.push(log),
    });

    await client.get('/ledgers');
    expect(retryLogs[0].attempt).toBe(1);
    expect(retryLogs[0].reason).toContain('rate_limit_low_remaining');
  });

  it('throws after exhausting the retry budget', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(503, {}));
    const client = new HorizonClient({ baseUrl: BASE_URL, maxRetries: 3, _fetch: mockFetch });

    await expect(client.get('/accounts/G123')).rejects.toThrow('HTTP 503');
    // initial + 3 retries = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe('HorizonClient – circuit breaker integration', () => {
  it('throws immediately when circuit is open', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse(503, {}));
    const client = new HorizonClient({
      baseUrl: BASE_URL,
      circuitOpenThreshold: 5,
      circuitWindowMs: 30_000,
      maxRetries: 0,
      _fetch: mockFetch,
    });

    // Trip circuit: 5 failures
    for (let i = 0; i < 5; i++) {
      await client.get('/ledgers').catch(() => {});
    }

    expect(client.circuit.isOpen()).toBe(true);
    await expect(client.get('/ledgers')).rejects.toThrow('Circuit breaker is open');
    // After circuit opens, no additional fetch calls
    const callsBefore = mockFetch.mock.calls.length;
    await client.get('/ledgers').catch(() => {});
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
  });
});
