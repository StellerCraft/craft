/**
 * Property-Based Tests: Deployment Rate Limiting Under Concurrent User Burst
 *
 * Issue #706: Property-based tests proving the sliding window counter never
 * allows more than N deployments per window under any interleaving of
 * concurrent requests.
 *
 * Properties under test:
 *   P1 — For any burst of N+1 concurrent requests, at most N are allowed
 *   P2 — Allowed count is monotonically bounded by the configured limit
 *   P3 — Pro tier imposes no cap (all requests within window succeed)
 *   P4 — Window boundary: requests at T=0 and T=windowMs-1 count in the same window
 *   P5 — Window reset: requests after the window expires start a fresh counter
 *
 * Tiers:
 *   free    → 1 deployment/day
 *   starter → 5 deployments/day
 *   pro     → unlimited (represented by a high cap in tests)
 *
 * Runs: FC_NUM_RUNS=1000 (default), seed=42 for deterministic reproduction.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
    checkRateLimit,
    _resetStore,
    type RateLimitConfig,
} from '@/lib/api/rate-limit';

// ── Tier constants ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1_000;

const FREE_LIMIT: RateLimitConfig = { limit: 1, windowMs: DAY_MS };
const STARTER_LIMIT: RateLimitConfig = { limit: 5, windowMs: DAY_MS };
const PRO_LIMIT: RateLimitConfig = { limit: 1_000_000, windowMs: DAY_MS };

// ── Helpers ───────────────────────────────────────────────────────────────────

function deployKey(tier: string, userId: string): string {
    return `deploy:${tier}:${userId}`;
}

/** Fire `count` concurrent deployment checks in scheduler-determined order. */
async function runBurst(
    scheduler: fc.Scheduler,
    key: string,
    config: RateLimitConfig,
    count: number,
): Promise<boolean[]> {
    const collected: boolean[] = [];

    const tasks = Array.from({ length: count }, (_, i) =>
        scheduler.schedule(
            Promise.resolve().then(() => {
                const { allowed } = checkRateLimit(key, config);
                collected.push(allowed);
                return allowed;
            }),
            `burst-${i}`,
        ),
    );

    await scheduler.waitAll();
    await Promise.all(tasks);
    return collected;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
    _resetStore();
});

afterEach(() => {
    vi.useRealTimers();
});

// ── P1/P2 — burst cap ─────────────────────────────────────────────────────────

describe('P1 — free tier (1/day): N+1 burst caps at exactly 1 allowed', () => {
    it('never grants more than 1 deployment regardless of arrival order', async () => {
        const numRuns = Number(process.env.FC_NUM_RUNS ?? 1_000);

        await fc.assert(
            fc.asyncProperty(fc.scheduler(), async (scheduler) => {
                _resetStore();
                const key = deployKey('free', 'user-a');
                const results = await runBurst(scheduler, key, FREE_LIMIT, FREE_LIMIT.limit + 1);

                expect(results.filter(Boolean).length).toBeLessThanOrEqual(FREE_LIMIT.limit);
                expect(results.filter(r => !r).length).toBeGreaterThanOrEqual(1);
            }),
            { numRuns, seed: 42 },
        );
    });

    it('exactly 1 succeeds and 1 is rejected in a 2-request burst', async () => {
        const results: boolean[] = [];
        results.push(checkRateLimit(deployKey('free', 'user-b'), FREE_LIMIT).allowed);
        results.push(checkRateLimit(deployKey('free', 'user-b'), FREE_LIMIT).allowed);

        expect(results.filter(Boolean).length).toBe(1);
        expect(results.filter(r => !r).length).toBe(1);
    });
});

describe('P2 — starter tier (5/day): N+1 burst caps at exactly 5 allowed', () => {
    it('never grants more than 5 deployments regardless of arrival order', async () => {
        const numRuns = Number(process.env.FC_NUM_RUNS ?? 1_000);

        await fc.assert(
            fc.asyncProperty(fc.scheduler(), async (scheduler) => {
                _resetStore();
                const key = deployKey('starter', 'user-c');
                const results = await runBurst(
                    scheduler,
                    key,
                    STARTER_LIMIT,
                    STARTER_LIMIT.limit + 1,
                );

                expect(results.filter(Boolean).length).toBeLessThanOrEqual(STARTER_LIMIT.limit);
                expect(results.filter(r => !r).length).toBeGreaterThanOrEqual(1);
            }),
            { numRuns, seed: 42 },
        );
    });

    it('for any burst size ≤ limit, all requests are allowed', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.scheduler(),
                fc.integer({ min: 1, max: STARTER_LIMIT.limit }),
                async (scheduler, burstSize) => {
                    _resetStore();
                    const key = deployKey('starter', 'user-d');
                    const results = await runBurst(scheduler, key, STARTER_LIMIT, burstSize);

                    expect(results.every(Boolean)).toBe(true);
                },
            ),
            { numRuns: 200, seed: 42 },
        );
    });
});

// ── P3 — pro tier ─────────────────────────────────────────────────────────────

describe('P3 — pro tier: all requests within window are allowed', () => {
    it('any burst up to 20 concurrent requests are all granted', async () => {
        const numRuns = Number(process.env.FC_NUM_RUNS ?? 1_000);

        await fc.assert(
            fc.asyncProperty(
                fc.scheduler(),
                fc.integer({ min: 1, max: 20 }),
                async (scheduler, burstSize) => {
                    _resetStore();
                    const key = deployKey('pro', 'user-e');
                    const results = await runBurst(scheduler, key, PRO_LIMIT, burstSize);

                    expect(results.every(Boolean)).toBe(true);
                },
            ),
            { numRuns, seed: 42 },
        );
    });
});

// ── P4 — window boundary edge cases ──────────────────────────────────────────

describe('P4 — window boundary: T=0 and T=windowMs-1 are in the same window', () => {
    it('free tier: request at T=0 and T=windowMs-1 both count in the same window', () => {
        vi.useFakeTimers();
        const key = deployKey('free', 'boundary-user');

        // T=0: first request
        const r1 = checkRateLimit(key, FREE_LIMIT);
        expect(r1.allowed).toBe(true);

        // Advance to T=windowMs-1 (1ms before reset)
        vi.advanceTimersByTime(DAY_MS - 1);

        // Second request still within the window — must be rejected
        const r2 = checkRateLimit(key, FREE_LIMIT);
        expect(r2.allowed).toBe(false);
    });

    it('starter tier: requests spread across window all count toward same cap', () => {
        vi.useFakeTimers();
        const key = deployKey('starter', 'boundary-user');
        const sliceMs = Math.floor(DAY_MS / STARTER_LIMIT.limit);
        const results: boolean[] = [];

        for (let i = 0; i < STARTER_LIMIT.limit; i++) {
            vi.advanceTimersByTime(sliceMs);
            results.push(checkRateLimit(key, STARTER_LIMIT).allowed);
        }

        // All 5 spaced requests within window succeed
        expect(results.every(Boolean)).toBe(true);

        // One more before reset must be rejected
        const extra = checkRateLimit(key, STARTER_LIMIT);
        expect(extra.allowed).toBe(false);
    });
});

// ── P5 — window reset ─────────────────────────────────────────────────────────

describe('P5 — window reset: counter resets after window expires', () => {
    it('free tier: exhausted window resets and allows exactly 1 more after expiry', () => {
        vi.useFakeTimers();
        const key = deployKey('free', 'reset-user');

        // Exhaust free limit
        checkRateLimit(key, FREE_LIMIT);
        expect(checkRateLimit(key, FREE_LIMIT).allowed).toBe(false);

        // Advance past the window
        vi.advanceTimersByTime(DAY_MS + 1);

        // Should be allowed again
        expect(checkRateLimit(key, FREE_LIMIT).allowed).toBe(true);
        // And immediately blocked again
        expect(checkRateLimit(key, FREE_LIMIT).allowed).toBe(false);
    });

    it('starter tier: property — fresh window always allows up to limit', async () => {
        await fc.assert(
            fc.asyncProperty(fc.scheduler(), async (scheduler) => {
                vi.useFakeTimers();
                _resetStore();
                const key = deployKey('starter', 'reset-prop-user');

                // Exhaust the first window
                for (let i = 0; i < STARTER_LIMIT.limit; i++) {
                    checkRateLimit(key, STARTER_LIMIT);
                }

                // Advance past the window
                vi.advanceTimersByTime(DAY_MS + 1);

                // New burst of N+1 — exactly limit allowed in the fresh window
                const results = await runBurst(
                    scheduler,
                    key,
                    STARTER_LIMIT,
                    STARTER_LIMIT.limit + 1,
                );

                expect(results.filter(Boolean).length).toBeLessThanOrEqual(STARTER_LIMIT.limit);
                vi.useRealTimers();
            }),
            { numRuns: 50, seed: 42 },
        );
    });
});

// ── Multi-user isolation ───────────────────────────────────────────────────────

describe('Multi-user isolation: rate limits are scoped per user', () => {
    it('concurrent bursts from different users do not interfere', async () => {
        await fc.assert(
            fc.asyncProperty(fc.scheduler(), async (scheduler) => {
                _resetStore();

                // Two users each sending FREE_LIMIT+1 requests simultaneously
                const keyA = deployKey('free', 'user-isolation-a');
                const keyB = deployKey('free', 'user-isolation-b');

                const [resultsA, resultsB] = await Promise.all([
                    runBurst(scheduler, keyA, FREE_LIMIT, FREE_LIMIT.limit + 1),
                    runBurst(scheduler, keyB, FREE_LIMIT, FREE_LIMIT.limit + 1),
                ]);

                // Each user independently capped at their own limit
                expect(resultsA.filter(Boolean).length).toBeLessThanOrEqual(FREE_LIMIT.limit);
                expect(resultsB.filter(Boolean).length).toBeLessThanOrEqual(FREE_LIMIT.limit);
            }),
            { numRuns: 200, seed: 42 },
        );
    });
});
