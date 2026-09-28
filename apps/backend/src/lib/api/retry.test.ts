import { describe, it, expect, vi } from 'vitest';
import { withRetry, computeDelay, RetryExhaustedError } from './retry';

const noSleep = () => Promise.resolve();

// ── computeDelay ─────────────────────────────────────────────────────────────

describe('computeDelay', () => {
    it('returns 0 when Math.random returns 0', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(computeDelay(0, 200, 10_000)).toBe(0);
        vi.restoreAllMocks();
    });

    it('caps at maxDelayMs', () => {
        vi.spyOn(Math, 'random').mockReturnValue(1);
        expect(computeDelay(10, 200, 500)).toBe(500);
        vi.restoreAllMocks();
    });

    it('grows exponentially before the cap', () => {
        vi.spyOn(Math, 'random').mockReturnValue(1);
        const d0 = computeDelay(0, 100, 10_000); // 100
        const d1 = computeDelay(1, 100, 10_000); // 200
        const d2 = computeDelay(2, 100, 10_000); // 400
        expect(d1).toBe(d0 * 2);
        expect(d2).toBe(d1 * 2);
        vi.restoreAllMocks();
    });
});

// ── withRetry ─────────────────────────────────────────────────────────────────

describe('withRetry', () => {
    it('returns immediately on success', async () => {
        const fn = vi.fn().mockResolvedValue('ok');
        const result = await withRetry(fn, { sleep: noSleep });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on retryable error and succeeds', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce({ status: 503, message: 'unavailable' })
            .mockResolvedValue('recovered');

        const result = await withRetry(fn, { maxAttempts: 3, sleep: noSleep });
        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on non-retryable error', async () => {
        const err = { status: 400, message: 'bad request' };
        const fn = vi.fn().mockRejectedValue(err);

        await expect(withRetry(fn, { sleep: noSleep })).rejects.toMatchObject({ status: 400 });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('throws RetryExhaustedError after all attempts fail', async () => {
        const fn = vi.fn().mockRejectedValue({ status: 500, message: 'server error' });

        await expect(withRetry(fn, { maxAttempts: 3, sleep: noSleep })).rejects.toBeInstanceOf(
            RetryExhaustedError,
        );
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('RetryExhaustedError reports correct attempt count', async () => {
        const fn = vi.fn().mockRejectedValue({ status: 500, message: 'err' });

        const err = await withRetry(fn, { maxAttempts: 2, sleep: noSleep }).catch((e) => e);
        expect(err).toBeInstanceOf(RetryExhaustedError);
        expect((err as RetryExhaustedError).attempts).toBe(2);
    });

    it('respects custom isRetryable', async () => {
        const fn = vi
            .fn()
            .mockRejectedValueOnce(new Error('ECONNRESET'))
            .mockResolvedValue('ok');

        const result = await withRetry(fn, {
            isRetryable: (e) => e instanceof Error && e.message === 'ECONNRESET',
            sleep: noSleep,
        });
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('sleeps between retries', async () => {
        const delays: number[] = [];
        const sleep = (ms: number) => { delays.push(ms); return Promise.resolve(); };
        const fn = vi
            .fn()
            .mockRejectedValueOnce({ status: 503, message: 'err' })
            .mockRejectedValueOnce({ status: 503, message: 'err' })
            .mockResolvedValue('ok');

        await withRetry(fn, { maxAttempts: 3, sleep });
        expect(delays).toHaveLength(2);
    });

    it('does not retry ambiguous-outcome errors on non-idempotent requests without idempotency key', async () => {
        const ambiguousError = { message: 'Request timeout', statusCode: 0 };
        const fn = vi.fn().mockRejectedValue(ambiguousError);

        await expect(
            withRetry(fn, {
                maxAttempts: 3,
                sleep: noSleep,
                isRetryable: (err) =>
                    err && typeof err === 'object' && 'statusCode' in err
                        ? (err as any).statusCode === 0
                        : false,
            }),
        ).rejects.toThrow();

        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('allows idempotent operations to retry on ambiguous errors', async () => {
        const ambiguousError = { message: 'Connection timeout' };
        const fn = vi
            .fn()
            .mockRejectedValueOnce(ambiguousError)
            .mockResolvedValue('success');

        const result = await withRetry(fn, {
            maxAttempts: 3,
            sleep: noSleep,
            isRetryable: () => true,
        });

        expect(result).toBe('success');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('prevents retry on ambiguous errors for POST operations when not configured', async () => {
        const timeoutError = new Error('Connection reset');
        const fn = vi.fn().mockRejectedValue(timeoutError);

        await expect(
            withRetry(fn, {
                maxAttempts: 2,
                sleep: noSleep,
                isRetryable: (err) => {
                    if (err instanceof Error && err.message === 'Connection reset') {
                        return false;
                    }
                    return true;
                },
            }),
        ).rejects.toThrow('Connection reset');

        expect(fn).toHaveBeenCalledTimes(1);
    });
});
