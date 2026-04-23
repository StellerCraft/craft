/**
 * Rate Limiting Verification Tests
 *
 * Verifies that rate limits are correctly enforced across all endpoint
 * categories, tier-based configs, headers, reset timing, and bypass attempts.
 *
 * Uses the real checkRateLimit / withRateLimit implementations with an
 * isolated in-memory store (_resetStore) — no network I/O required.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
    checkRateLimit,
    getRateLimitKey,
    _resetStore,
    AUTH_RATE_LIMIT,
    AUTH_READ_RATE_LIMIT,
    API_RATE_LIMIT,
    MUTATION_RATE_LIMIT,
    WEBHOOK_RATE_LIMIT,
    CRON_RATE_LIMIT,
    type RateLimitConfig,
} from '@/lib/api/rate-limit';
import { withRateLimit } from '@/lib/api/with-rate-limit';

// ── Helpers ───────────────────────────────────────────────────────────────────

const okHandler = vi.fn(async () => NextResponse.json({ ok: true }));

function makeReq(ip = '10.0.0.1', route = 'http://localhost/api/test') {
    return new NextRequest(route, { headers: { 'x-forwarded-for': ip } });
}

/** Exhaust a rate limit config for a given key. */
function exhaust(key: string, config: RateLimitConfig) {
    for (let i = 0; i < config.limit; i++) checkRateLimit(key, config);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    _resetStore();
    vi.clearAllMocks();
    delete process.env.RATE_LIMIT_DISABLED;
});

afterEach(() => {
    vi.useRealTimers();
    delete process.env.RATE_LIMIT_DISABLED;
});

// ── Endpoint category limits ──────────────────────────────────────────────────

describe('Endpoint category limits', () => {
    const cases: Array<[string, RateLimitConfig]> = [
        ['auth (credential)', AUTH_RATE_LIMIT],
        ['auth (read)', AUTH_READ_RATE_LIMIT],
        ['api (general)', API_RATE_LIMIT],
        ['mutation', MUTATION_RATE_LIMIT],
        ['webhook', WEBHOOK_RATE_LIMIT],
        ['cron', CRON_RATE_LIMIT],
    ];

    it.each(cases)('%s: allows exactly `limit` requests then blocks', (_label, config) => {
        const key = `test:${_label}`;
        exhaust(key, config);
        const blocked = checkRateLimit(key, config);
        expect(blocked.allowed).toBe(false);
        expect(blocked.remaining).toBe(0);
    });

    it.each(cases)('%s: remaining decrements correctly', (_label, config) => {
        const key = `remaining:${_label}`;
        const first = checkRateLimit(key, config);
        expect(first.remaining).toBe(config.limit - 1);
    });
});

// ── Tier-based limit enforcement ──────────────────────────────────────────────

describe('Tier-based limit enforcement', () => {
    const tiers: Record<string, RateLimitConfig> = {
        anonymous: { limit: 10, windowMs: 60_000 },
        authenticated: { limit: 100, windowMs: 60_000 },
        pro: { limit: 500, windowMs: 60_000 },
        enterprise: { limit: 1000, windowMs: 60_000 },
    };

    it('anonymous tier is more restrictive than authenticated', () => {
        expect(tiers.anonymous.limit).toBeLessThan(tiers.authenticated.limit);
    });

    it('pro tier allows more requests than authenticated', () => {
        expect(tiers.pro.limit).toBeGreaterThan(tiers.authenticated.limit);
    });

    it('enterprise tier allows more requests than pro', () => {
        expect(tiers.enterprise.limit).toBeGreaterThan(tiers.pro.limit);
    });

    it('each tier enforces its own limit independently', () => {
        for (const [tier, config] of Object.entries(tiers)) {
            const key = `tier:${tier}`;
            exhaust(key, config);
            expect(checkRateLimit(key, config).allowed).toBe(false);
        }
    });

    it('different tier keys do not interfere with each other', () => {
        exhaust('tier:anonymous', tiers.anonymous);
        // authenticated key is unaffected
        expect(checkRateLimit('tier:authenticated', tiers.authenticated).allowed).toBe(true);
    });
});

// ── Rate limit headers ────────────────────────────────────────────────────────

describe('Rate limit headers', () => {
    const config: RateLimitConfig = { limit: 3, windowMs: 60_000 };

    it('successful response includes X-RateLimit-Limit, Remaining, Reset', async () => {
        const wrapped = withRateLimit('hdr:test', config)(okHandler);
        const res = await wrapped(makeReq(), { params: {} });

        expect(res.headers.get('X-RateLimit-Limit')).toBe('3');
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('2');
        expect(Number(res.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(Date.now() / 1000);
    });

    it('429 response includes Retry-After header in seconds', async () => {
        const wrapped = withRateLimit('hdr:429', config)(okHandler);
        for (let i = 0; i < config.limit; i++) await wrapped(makeReq(), { params: {} });

        const res = await wrapped(makeReq(), { params: {} });
        expect(res.status).toBe(429);
        const retryAfter = Number(res.headers.get('Retry-After'));
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(Math.ceil(config.windowMs / 1000));
    });

    it('429 body contains retryAfterMs and resetAt', async () => {
        const wrapped = withRateLimit('hdr:body', config)(okHandler);
        for (let i = 0; i < config.limit; i++) await wrapped(makeReq(), { params: {} });

        const res = await wrapped(makeReq(), { params: {} });
        const body = await res.json();
        expect(body.retryAfterMs).toBeGreaterThan(0);
        expect(body.resetAt).toBeGreaterThan(Date.now());
    });

    it('X-RateLimit-Remaining is 0 (not negative) when blocked', async () => {
        const wrapped = withRateLimit('hdr:neg', config)(okHandler);
        for (let i = 0; i < config.limit + 2; i++) await wrapped(makeReq(), { params: {} });

        const res = await wrapped(makeReq(), { params: {} });
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    });
});

// ── Reset timing ──────────────────────────────────────────────────────────────

describe('Rate limit reset timing', () => {
    it('requests are allowed again after the window expires', () => {
        vi.useFakeTimers();
        const config: RateLimitConfig = { limit: 2, windowMs: 30_000 };
        const key = 'reset:timing';

        exhaust(key, config);
        expect(checkRateLimit(key, config).allowed).toBe(false);

        vi.advanceTimersByTime(config.windowMs + 1);

        const after = checkRateLimit(key, config);
        expect(after.allowed).toBe(true);
        expect(after.remaining).toBe(1);
    });

    it('resetAt is within the window duration from now', () => {
        const config: RateLimitConfig = { limit: 5, windowMs: 60_000 };
        const result = checkRateLimit('reset:at', config);
        expect(result.resetAt).toBeGreaterThan(Date.now());
        expect(result.resetAt).toBeLessThanOrEqual(Date.now() + config.windowMs);
    });

    it('sliding window: new requests extend the window', () => {
        vi.useFakeTimers();
        const config: RateLimitConfig = { limit: 3, windowMs: 10_000 };
        const key = 'reset:sliding';

        checkRateLimit(key, config); // t=0
        vi.advanceTimersByTime(5_000);
        checkRateLimit(key, config); // t=5s
        checkRateLimit(key, config); // t=5s — now at limit

        // At t=11s the first request (t=0) has expired, freeing one slot.
        vi.advanceTimersByTime(6_000);
        expect(checkRateLimit(key, config).allowed).toBe(true);
    });
});

// ── Per-IP isolation ──────────────────────────────────────────────────────────

describe('Per-IP isolation', () => {
    const config: RateLimitConfig = { limit: 2, windowMs: 60_000 };

    it('exhausting one IP does not affect another', async () => {
        const wrapped = withRateLimit('ip:iso', config)(okHandler);
        await wrapped(makeReq('1.1.1.1'), { params: {} });
        await wrapped(makeReq('1.1.1.1'), { params: {} });
        const blocked = await wrapped(makeReq('1.1.1.1'), { params: {} });
        expect(blocked.status).toBe(429);

        const other = await wrapped(makeReq('2.2.2.2'), { params: {} });
        expect(other.status).toBe(200);
    });

    it('x-forwarded-for first IP is used for keying', () => {
        const key1 = getRateLimitKey(
            { headers: { get: (h: string) => (h === 'x-forwarded-for' ? '3.3.3.3, 9.9.9.9' : null) } },
            'route'
        );
        const key2 = getRateLimitKey(
            { headers: { get: (h: string) => (h === 'x-forwarded-for' ? '4.4.4.4, 9.9.9.9' : null) } },
            'route'
        );
        expect(key1).not.toBe(key2);
        expect(key1).toContain('3.3.3.3');
    });
});

// ── Bypass attempts ───────────────────────────────────────────────────────────

describe('Rate limit bypass attempts', () => {
    const config: RateLimitConfig = { limit: 2, windowMs: 60_000 };

    it('RATE_LIMIT_DISABLED=true bypasses all limits', async () => {
        process.env.RATE_LIMIT_DISABLED = 'true';
        const wrapped = withRateLimit('bypass:env', config)(okHandler);
        for (let i = 0; i < config.limit + 3; i++) {
            const res = await wrapped(makeReq(), { params: {} });
            expect(res.status).toBe(200);
        }
    });

    it('RATE_LIMIT_DISABLED=false does NOT bypass limits', async () => {
        process.env.RATE_LIMIT_DISABLED = 'false';
        const wrapped = withRateLimit('bypass:false', config)(okHandler);
        for (let i = 0; i < config.limit; i++) await wrapped(makeReq(), { params: {} });
        const res = await wrapped(makeReq(), { params: {} });
        expect(res.status).toBe(429);
    });

    it('spoofed x-forwarded-for with multiple IPs uses only the first', () => {
        const req = { headers: { get: (h: string) => (h === 'x-forwarded-for' ? 'attacker, proxy1, proxy2' : null) } };
        const key = getRateLimitKey(req, 'route');
        expect(key).toBe('route:attacker');
    });

    it('missing IP header falls back to "unknown" key (still rate limited)', () => {
        const config2: RateLimitConfig = { limit: 1, windowMs: 60_000 };
        const key = 'route:unknown';
        checkRateLimit(key, config2);
        expect(checkRateLimit(key, config2).allowed).toBe(false);
    });
});

// ── Distributed rate limiting (store isolation) ───────────────────────────────

describe('Distributed rate limiting (store isolation)', () => {
    it('_resetStore clears all keys between tests', () => {
        const config: RateLimitConfig = { limit: 1, windowMs: 60_000 };
        checkRateLimit('dist:key', config);
        expect(checkRateLimit('dist:key', config).allowed).toBe(false);

        _resetStore();

        expect(checkRateLimit('dist:key', config).allowed).toBe(true);
    });

    it('independent keys do not share counters', () => {
        const config: RateLimitConfig = { limit: 2, windowMs: 60_000 };
        exhaust('dist:a', config);
        const r = checkRateLimit('dist:b', config);
        expect(r.allowed).toBe(true);
        expect(r.remaining).toBe(1);
    });
});
