// @vitest-environment node
/**
 * SDK Retry-After Integration Test (Issue #1317)
 *
 * Drives CraftClient against a local HTTP server that reproduces the exact 429
 * contract emitted by apps/backend/src/lib/api/tier-rate-limit.ts
 * (withTierRateLimit), backed by the real sliding-window limiter in
 * apps/backend/src/lib/api/rate-limit.ts. This catches contract drift between
 * what the SDK expects and what the backend actually sends, which a
 * hand-crafted fetch mock in client.test.ts cannot.
 *
 * 429 contract reproduced (keep in sync with withTierRateLimit):
 *   Status:  429
 *   Headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset,
 *            X-RateLimit-Tier, Retry-After (whole seconds, ceil(retryAfterMs/1000))
 *   Body:    { error, retryAfterMs, resetAt, tier }
 *
 * Hermetic: the server binds to 127.0.0.1 on an ephemeral port; no external
 * network access is made.
 *
 * Run: npm run --workspace @craft/sdk test -- retry-after.integration
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import {
  checkRateLimit,
  _resetStore,
  type RateLimitConfig,
} from '../../../apps/backend/src/lib/api/rate-limit';
import { CraftClient, CraftApiError, type TemplateListResponse } from '../src/client';

// ── Test server reproducing withTierRateLimit ─────────────────────────────────

type Tier = 'free' | 'pro' | 'enterprise';

interface ServedRequest {
  at: number;
  status: number;
  retryAfterHeader?: string;
  retryAfterMs?: number;
}

const TEMPLATES_BODY: TemplateListResponse = {
  templates: [],
  total: 0,
  limit: 10,
  offset: 0,
};

/**
 * Minimal harness equivalent to `withTierRateLimit('api/templates')(handler)`.
 * Tier lookup is fixed per server (the real middleware reads it from Supabase),
 * everything downstream of the tier — limiter call, headers and 429 body — is
 * identical to the middleware.
 */
function startRateLimitedServer(opts: { config: RateLimitConfig; tier?: Tier; routeKey?: string }) {
  const tier = opts.tier ?? 'free';
  const routeKey = opts.routeKey ?? 'api/templates';
  const served: ServedRequest[] = [];

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Same key shape as getRateLimitKey(): `${route}:${ip}`.
    const forwarded = req.headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '127.0.0.1';
    const result = checkRateLimit(`${routeKey}:${ip}`, opts.config);

    const rateLimitHeaders = {
      'X-RateLimit-Limit': String(opts.config.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      'X-RateLimit-Tier': tier,
    };

    if (!result.allowed) {
      const retryAfter = String(Math.ceil(result.retryAfterMs / 1000));
      served.push({ at: Date.now(), status: 429, retryAfterHeader: retryAfter, retryAfterMs: result.retryAfterMs });
      res.writeHead(429, {
        'Content-Type': 'application/json',
        ...rateLimitHeaders,
        'Retry-After': retryAfter,
      });
      res.end(
        JSON.stringify({
          error: 'Too many requests. Please try again later.',
          retryAfterMs: result.retryAfterMs,
          resetAt: result.resetAt,
          tier,
        }),
      );
      return;
    }

    served.push({ at: Date.now(), status: 200 });
    res.writeHead(200, { 'Content-Type': 'application/json', ...rateLimitHeaders });
    res.end(JSON.stringify(TEMPLATES_BODY));
  });

  return {
    served,
    listen: () =>
      new Promise<string>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** Consumes the whole window so the SDK's first request is rate-limited. */
async function exhaustQuota(baseUrl: string, limit: number): Promise<void> {
  for (let i = 0; i < limit; i++) {
    const res = await fetch(`${baseUrl}/api/templates`);
    expect(res.status).toBe(200);
    await res.text();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CraftClient Retry-After handling against the tier rate-limit 429 contract', () => {
  beforeEach(() => {
    _resetStore();
  });

  describe('when the rate-limit window clears within the retry budget', () => {
    const config: RateLimitConfig = { limit: 1, windowMs: 1_000 };
    const harness = startRateLimitedServer({ config });
    let baseUrl: string;

    beforeAll(async () => {
      baseUrl = await harness.listen();
    });

    afterAll(async () => {
      await harness.close();
    });

    beforeEach(() => {
      harness.served.length = 0;
    });

    it('waits for the advertised Retry-After and then succeeds', async () => {
      await exhaustQuota(baseUrl, config.limit);
      const client = new CraftClient({ baseUrl, maxRetries: 2 });

      const started = Date.now();
      const result = await client.listTemplates();
      const elapsed = Date.now() - started;

      expect(result).toEqual(TEMPLATES_BODY);

      // Priming request (200), SDK's first attempt (429), SDK's retry (200).
      expect(harness.served.map((r) => r.status)).toEqual([200, 429, 200]);

      const rejected = harness.served[1];
      const retried = harness.served[2];
      const advertisedMs = Number(rejected.retryAfterHeader) * 1000;

      // The SDK must not retry before the server-advertised wait has elapsed…
      expect(retried.at - rejected.at).toBeGreaterThanOrEqual(advertisedMs - 50);
      // …and must not stall far beyond it either.
      expect(elapsed).toBeLessThan(advertisedMs + 1_500);
    });

    it('does not retry at all when the first request is within quota', async () => {
      const client = new CraftClient({ baseUrl, maxRetries: 2 });

      await expect(client.listTemplates()).resolves.toEqual(TEMPLATES_BODY);
      expect(harness.served.map((r) => r.status)).toEqual([200]);
    });
  });

  describe('when retries exhaust before the rate-limit window clears', () => {
    // A long window: the SDK's waits are compressed below so the test stays fast,
    // meaning real time never reaches the window boundary and every retry is 429.
    const config: RateLimitConfig = { limit: 1, windowMs: 30_000 };
    const harness = startRateLimitedServer({ config, tier: 'pro' });
    let baseUrl: string;
    let requestedWaits: number[];

    beforeAll(async () => {
      baseUrl = await harness.listen();
    });

    afterAll(async () => {
      await harness.close();
    });

    beforeEach(() => {
      harness.served.length = 0;
      requestedWaits = [];
      const realSetTimeout = globalThis.setTimeout;
      // Record and fast-forward only the SDK's Retry-After sleeps (whole seconds
      // matching this window); every other timer runs untouched.
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        handler: (...args: unknown[]) => void,
        timeout?: number,
        ...args: unknown[]
      ) => {
        if (typeof timeout === 'number' && timeout >= 25_000 && timeout <= 30_000 && timeout % 1000 === 0) {
          requestedWaits.push(timeout);
          return realSetTimeout(handler, 0, ...args);
        }
        return realSetTimeout(handler, timeout, ...args);
      }) as typeof setTimeout);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('surfaces a clear CraftApiError once maxRetries is exhausted', async () => {
      await exhaustQuota(baseUrl, config.limit);
      const client = new CraftClient({ baseUrl, maxRetries: 2 });

      const err = await client.listTemplates().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CraftApiError);
      const apiErr = err as CraftApiError;
      expect(apiErr.status).toBe(429);
      expect(apiErr.code).toBe('RATE_LIMITED');
      // The backend's `error` field (not raw JSON) must reach the caller.
      expect(apiErr.message).toContain('Too many requests. Please try again later.');
      expect(apiErr.message).toMatch(/gave up after 2 retries/);
      expect(apiErr.message).not.toContain('{');

      // Initial attempt + 2 retries, all rejected; nothing beyond the budget.
      const sdkRequests = harness.served.slice(config.limit);
      expect(sdkRequests.map((r) => r.status)).toEqual([429, 429, 429]);

      // Each wait honoured the Retry-After header the server actually sent.
      expect(requestedWaits).toEqual(
        sdkRequests.slice(0, 2).map((r) => Number(r.retryAfterHeader) * 1000),
      );

      // retryAfterMs on the error mirrors the final Retry-After header.
      expect(apiErr.retryAfterMs).toBe(Number(sdkRequests[2].retryAfterHeader) * 1000);
    });

    it('fails fast without sleeping when Retry-After exceeds maxRetryDelayMs', async () => {
      await exhaustQuota(baseUrl, config.limit);
      const client = new CraftClient({ baseUrl, maxRetries: 3, maxRetryDelayMs: 5_000 });

      const err = await client.listTemplates().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CraftApiError);
      expect((err as CraftApiError).status).toBe(429);
      expect((err as CraftApiError).code).toBe('RATE_LIMITED');
      expect((err as CraftApiError).message).toMatch(/exceeds maxRetryDelayMs \(5000ms\)/);
      expect(requestedWaits).toEqual([]);
      expect(harness.served.slice(config.limit).map((r) => r.status)).toEqual([429]);
    });

    it('does not retry when maxRetries is 0', async () => {
      await exhaustQuota(baseUrl, config.limit);
      const client = new CraftClient({ baseUrl, maxRetries: 0 });

      const err = await client.listTemplates().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CraftApiError);
      expect((err as CraftApiError).message).toMatch(/gave up after 0 retries/);
      expect(requestedWaits).toEqual([]);
      expect(harness.served.slice(config.limit).map((r) => r.status)).toEqual([429]);
    });
  });
});
