/**
 * Property 45 — API Rate Limiting Returns 429 on Excessive Requests
 *
 * REQUIREMENT:
 * The app's rate limiter MUST reject request bursts exceeding the configured
 * limit with HTTP 429 (Too Many Requests), including:
 *   - JSON body: { error, retryAfterMs, resetAt }
 *   - Headers: Retry-After, X-RateLimit-Limit/Remaining/Reset
 *   - Handler NOT called on limit hit
 *
 * INVARIANTS UNDER TEST:
 *   45.1 — Excess requests return status 429
 *   45.2 — 429 body contains retryAfterMs ≥ 0 and resetAt
 *   45.3 — 429 includes rate-limit headers (X-RateLimit-*, Retry-After)
 *   45.4 — Handler is invoked exactly `limit` times, then blocked
 *   45.5 — Limits scoped per IP+route; different keys independent
 *   45.6 — Window expires: allowed again after windowMs
 *
 * CONFIG UNDER TEST:
 *   AUTH_RATE_LIMIT (10 requests / 15min per IP), used on auth routes.
 *
 * TEST STRATEGY:
 *   Contract test against `withRateLimit` middleware wrapping a mock handler.
 *   fast-check generates request bursts, fixed IP, varying timings.
 *   ≥ 100 iterations per property. Uses in-memory store directly.
 *
 * Feature: craft-platform
 * Property: 45
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/api/with-rate-limit';
import { AUTH_RATE_LIMIT, checkRateLimit, getRateLimitKey, _resetStore } from '@/lib/api/rate-limit';

type MockHandler = () => Promise<NextResponse>;

interface RateLimitResponse {
  status: number;
  headers: Headers;
  json(): Promise<{ error: string; retryAfterMs: number; resetAt: number }>;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

const makeReq = (ip = '127.0.0.1'): NextRequest => {
  const headersInit: Record<string, string> = { 'x-forwarded-for': ip };
  const req = new NextRequest('http://localhost/api/auth/signin', { headers: headersInit });
  vi.spyOn(req.headers, 'get').mockImplementation((name: string) => headersInit[name] ?? null);
  return req;
};

const makeMockHandler = (callCountRef: { count: number }): MockHandler => {
  return vi.fn(async () => {
    callCountRef.count++;
    return NextResponse.json({ ok: true });
  });
};

const expectRateLimit429 = async (res: RateLimitResponse): Promise<void> => {
  expect(res.status).toBe(429);
  const body = await res.json();
  expect(body).toMatchObject({
    error: 'Too many requests. Please try again later.',
    retryAfterMs: expect.any(Number),
    resetAt: expect.any(Number),
  });
  expect(body.retryAfterMs).toBeGreaterThanOrEqual(0);
  expect(body.resetAt).toBeGreaterThan(Date.now());

  // Headers
  expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
  expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
  expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
};

// ── Contract Interface ───────────────────────────────────────────────────────

interface RateLimitContract {
  sendBurst(req: NextRequest, burstSize: number): Promise<RateLimitResponse[]>;
  getHandlerCalls(): number;
}

// ── Mock Wrapper ─────────────────────────────────────────────────────────────

class MockRateLimitContract implements RateLimitContract {
  private handlerCalls = 0;
  private readonly mockHandler = vi.fn(async () => {
    this.handlerCalls++;
    return NextResponse.json({ ok: true });
  });

  constructor() {
    this.handlerCalls = 0;
  }

  async sendBurst(req: NextRequest, burstSize: number): Promise<RateLimitResponse[]> {
    const wrapped = withRateLimit('api:auth:signin', AUTH_RATE_LIMIT)(this.mockHandler);
    const responses: RateLimitResponse[] = [];
    for (let i = 0; i < burstSize; i++) {
      const res = await wrapped(req, { params: {} });
      responses.push({
        status: Number(res.status),
        headers: res.headers,
        json: () => res.json(),
      });
    }
    return responses;
  }

  getHandlerCalls(): number {
    return this.handlerCalls;
  }
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

/** Burst sizes that exceed the limit (≥ 11 for AUTH_RATE_LIMIT). */
const arbExcessBurstSize = fc.integer({ min: 11, max: 20 });

/** Different IPs for isolation. */
const arbIp = fc.ipV4();

/** Delays within windowMs to test sliding window. */
const arbDelayMs = fc.integer({ min: 0, max: AUTH_RATE_LIMIT.windowMs / 2 });

// ── Property Tests ───────────────────────────────────────────────────────────

describe('Property 45 — API Rate Limiting Returns 429 on Excessive Requests', () => {
  let contract: MockRateLimitContract;

  beforeEach(() => {
    _resetStore();
    contract = new MockRateLimitContract();
  });

  /**
   * 45.1 — Requests exceeding limit ALWAYS return 429.
   */
  it('45.1 — excess requests always return status 429', async () => {
    await fc.assert(
      fc.asyncProperty(arbExcessBurstSize, async (burstSize) => {
        const req = makeReq();
        const responses = await contract.sendBurst(req, burstSize);

        // Last request blocked
        expectRateLimit429(responses[burstSize - 1]);
        // Prior requests succeed (200)
        for (let i = 0; i < AUTH_RATE_LIMIT.limit; i++) {
          expect(responses[i].status).toBe(200);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * 45.2 — 429 body always contains retryAfterMs ≥ 0 and resetAt > now.
   */
  it('45.2 — 429 body shape and retryAfterMs ≥ 0', async () => {
    await fc.assert(
      fc.asyncProperty(arbExcessBurstSize, async (burstSize) => {
        const req = makeReq();
        const responses = await contract.sendBurst(req, burstSize);
        expectRateLimit429(responses[burstSize - 1]);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * 45.3 — 429 response includes all rate-limit headers.
   */
  it('45.3 — 429 includes rate-limit headers', async () => {
    await fc.assert(
      fc.asyncProperty(arbExcessBurstSize, async (burstSize) => {
        const req = makeReq();
        const responses = await contract.sendBurst(req, burstSize);
        const blocked = responses[burstSize - 1];

        expect(blocked.headers.get('Retry-After')).not.toBeNull();
        expect(blocked.headers.get('X-RateLimit-Limit')).toBe('10');
        expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
        expect(blocked.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * 45.4 — Mock handler called exactly `limit` times on burst > limit.
   */
  it('45.4 — handler invoked limit times, then blocked', async () => {
    await fc.assert(
      fc.asyncProperty(arbExcessBurstSize, async (burstSize) => {
        const req = makeReq();
        await contract.sendBurst(req, burstSize);
        expect(contract.getHandlerCalls()).toBe(AUTH_RATE_LIMIT.limit);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * 45.5 — Isolation: different IPs independent.
   */
  it('45.5 — limits isolated by IP', async () => {
    await fc.assert(
      fc.asyncProperty(arbIp, arbIp, async (ipA, ipB) => {
        fc.pre(ipA !== ipB);

        const reqA = makeReq(ipA);
        const reqB = makeReq(ipB);

        // Exhaust A
        await contract.sendBurst(reqA, AUTH_RATE_LIMIT.limit + 1);
        expect(contract.getHandlerCalls()).toBe(AUTH_RATE_LIMIT.limit); // A's handler calls

        // Reset contract/handler count for B
        contract = new MockRateLimitContract();

        // B unaffected
        await contract.sendBurst(reqB, AUTH_RATE_LIMIT.limit + 1);
        expect(contract.getHandlerCalls()).toBe(AUTH_RATE_LIMIT.limit);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * 45.6 — Sliding window: allowed again after windowMs.
   */
  it('45.6 — requests allowed again after windowMs elapses', async () => {
    await fc.assert(
      fc.asyncProperty(arbDelayMs, async (delayMs) => {
        vi.useFakeTimers();

        const req = makeReq();
        // Exhaust limit
        await contract.sendBurst(req, AUTH_RATE_LIMIT.limit);
        expect(contract.getHandlerCalls()).toBe(AUTH_RATE_LIMIT.limit);

        // Advance past window
        vi.advanceTimersByTime(AUTH_RATE_LIMIT.windowMs + 1);

        // Reset contract for continued testing
        contract = new MockRateLimitContract();

        // Should be allowed again
        const responses = await contract.sendBurst(req, 1);
        expect(responses[0].status).toBe(200);
        expect(contract.getHandlerCalls()).toBe(1);

        vi.useRealTimers();
      }),
      { numRuns: 100 },
    );
  });
});

