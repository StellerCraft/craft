import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from './with-rate-limit';
import { _resetStore, type RateLimitConfig } from './rate-limit';

const tightConfig: RateLimitConfig = { limit: 2, windowMs: 60_000 };

const makeReq = (ip = '1.2.3.4') =>
    new NextRequest('http://localhost/api/auth/signin', {
        method: 'POST',
        headers: { 'x-forwarded-for': ip },
    });

const okHandler = vi.fn(async () => NextResponse.json({ ok: true }));

describe('withRateLimit', () => {
    beforeEach(() => {
        _resetStore();
        vi.clearAllMocks();
        delete process.env.RATE_LIMIT_DISABLED;
    });

    afterEach(() => {
        delete process.env.RATE_LIMIT_DISABLED;
    });

    it('calls the handler when under the limit', async () => {
        const wrapped = withRateLimit('test:route', tightConfig)(okHandler);
        const res = await wrapped(makeReq(), { params: {} });
        expect(res.status).toBe(200);
        expect(okHandler).toHaveBeenCalledOnce();
    });

    it('returns 429 when the limit is exceeded', async () => {
        const wrapped = withRateLimit('test:route', tightConfig)(okHandler);
        await wrapped(makeReq(), { params: {} });
        await wrapped(makeReq(), { params: {} });

        const res = await wrapped(makeReq(), { params: {} });
        expect(res.status).toBe(429);
        expect(okHandler).toHaveBeenCalledTimes(2);
    });

    it('429 body contains retryAfterMs and resetAt', async () => {
        const wrapped = withRateLimit('test:route', tightConfig)(okHandler);
        await wrapped(makeReq(), { params: {} });
        await wrapped(makeReq(), { params: {} });

        const res = await wrapped(makeReq(), { params: {} });
        const body = await res.json();
        expect(body.retryAfterMs).toBeGreaterThan(0);
        expect(body.resetAt).toBeGreaterThan(Date.now());
        expect(body.error).toBeDefined();
    });

    it('429 response includes Retry-After and X-RateLimit-* headers', async () => {
        const wrapped = withRateLimit('test:route', tightConfig)(okHandler);
        await wrapped(makeReq(), { params: {} });
        await wrapped(makeReq(), { params: {} });

        const res = await wrapped(makeReq(), { params: {} });
        expect(res.headers.get('Retry-After')).toBeDefined();
        expect(res.headers.get('X-RateLimit-Limit')).toBe('2');
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
        expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    it('attaches X-RateLimit-* headers to successful responses', async () => {
        const wrapped = withRateLimit('test:route', tightConfig)(okHandler);
        const res = await wrapped(makeReq(), { params: {} });
        expect(res.headers.get('X-RateLimit-Limit')).toBe('2');
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('1');
    });

    it('limits are scoped per IP', async () => {
        const wrapped = withRateLimit('test:route', tightConfig)(okHandler);
        await wrapped(makeReq('1.1.1.1'), { params: {} });
        await wrapped(makeReq('1.1.1.1'), { params: {} });

        // Different IP should still be allowed.
        const res = await wrapped(makeReq('2.2.2.2'), { params: {} });
        expect(res.status).toBe(200);
    });

    it('bypasses rate limiting when RATE_LIMIT_DISABLED=true', async () => {
        process.env.RATE_LIMIT_DISABLED = 'true';
        const wrapped = withRateLimit('test:route', tightConfig)(okHandler);

        // Exceed the limit — should still pass through.
        for (let i = 0; i < 5; i++) {
            const res = await wrapped(makeReq(), { params: {} });
            expect(res.status).toBe(200);
        }
        expect(okHandler).toHaveBeenCalledTimes(5);
    });
});
