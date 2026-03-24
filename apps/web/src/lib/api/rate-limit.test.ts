import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { checkRateLimit, getRateLimitKey, _resetStore, type RateLimitConfig } from './rate-limit';

const config: RateLimitConfig = { limit: 3, windowMs: 60_000 };

describe('checkRateLimit', () => {
    beforeEach(() => _resetStore());
    afterEach(() => vi.useRealTimers());

    it('allows requests under the limit', () => {
        const r1 = checkRateLimit('key1', config);
        expect(r1.allowed).toBe(true);
        expect(r1.remaining).toBe(2);

        const r2 = checkRateLimit('key1', config);
        expect(r2.allowed).toBe(true);
        expect(r2.remaining).toBe(1);
    });

    it('blocks the request that exceeds the limit', () => {
        checkRateLimit('key2', config);
        checkRateLimit('key2', config);
        checkRateLimit('key2', config);

        const r = checkRateLimit('key2', config);
        expect(r.allowed).toBe(false);
        expect(r.remaining).toBe(0);
    });

    it('returns retryAfterMs > 0 when blocked', () => {
        checkRateLimit('key3', config);
        checkRateLimit('key3', config);
        checkRateLimit('key3', config);

        const r = checkRateLimit('key3', config);
        expect(r.retryAfterMs).toBeGreaterThan(0);
        expect(r.resetAt).toBeGreaterThan(Date.now());
    });

    it('resets after the window expires', () => {
        vi.useFakeTimers();

        checkRateLimit('key4', config);
        checkRateLimit('key4', config);
        checkRateLimit('key4', config);

        // Advance past the window.
        vi.advanceTimersByTime(config.windowMs + 1);

        const r = checkRateLimit('key4', config);
        expect(r.allowed).toBe(true);
        expect(r.remaining).toBe(2);
    });

    it('tracks keys independently', () => {
        checkRateLimit('keyA', config);
        checkRateLimit('keyA', config);
        checkRateLimit('keyA', config);

        // keyB is unaffected.
        const r = checkRateLimit('keyB', config);
        expect(r.allowed).toBe(true);
    });

    it('remaining is 0 (not negative) when blocked', () => {
        for (let i = 0; i < 5; i++) checkRateLimit('key5', config);
        const r = checkRateLimit('key5', config);
        expect(r.remaining).toBe(0);
    });
});

describe('getRateLimitKey', () => {
    const makeReq = (headers: Record<string, string | null>) => ({
        headers: { get: (name: string) => headers[name] ?? null },
    });

    it('uses x-forwarded-for first', () => {
        const req = makeReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
        expect(getRateLimitKey(req, 'auth:signin')).toBe('auth:signin:1.2.3.4');
    });

    it('falls back to x-real-ip', () => {
        const req = makeReq({ 'x-forwarded-for': null, 'x-real-ip': '9.9.9.9' });
        expect(getRateLimitKey(req, 'auth:signin')).toBe('auth:signin:9.9.9.9');
    });

    it('falls back to "unknown" when no IP header present', () => {
        const req = makeReq({ 'x-forwarded-for': null, 'x-real-ip': null });
        expect(getRateLimitKey(req, 'auth:signin')).toBe('auth:signin:unknown');
    });

    it('scopes key by route', () => {
        const req = makeReq({ 'x-forwarded-for': '1.1.1.1' });
        expect(getRateLimitKey(req, 'auth:signin')).not.toBe(getRateLimitKey(req, 'auth:signup'));
    });
});
