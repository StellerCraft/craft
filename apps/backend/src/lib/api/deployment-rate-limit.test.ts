import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    checkDeploymentRateLimit,
    TIER_HOURLY_LIMITS,
    WINDOW_MS,
    ESCALATION_REDUCTION,
} from './deployment-rate-limit';

const NOW = new Date('2026-01-01T00:00:00.000Z').getTime();

type CountResult = { count: number | null; error: unknown };
type EscalationRow = { hit_count: number; window_start: string } | null;
type OldestRow = { created_at: string } | null;

/**
 * Builds a fake Supabase client covering the two tables the module reads and
 * writes: `deployment_rate_limit_requests` (count + oldest-in-window + insert)
 * and `deployment_rate_limit_escalations` (read + upsert/update). The two
 * query shapes on the requests table are distinguished the same way the real
 * PostgREST builder is: a `head: true` select is the count query, otherwise
 * it's the "oldest request" lookup.
 */
function createSupabaseMock(opts: {
    countResult: CountResult;
    oldestRow?: OldestRow;
    escalationRow?: EscalationRow;
}) {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const update = vi.fn(() => ({ eq: updateEq }));

    const from = vi.fn((table: string) => {
        if (table === 'deployment_rate_limit_requests') {
            return {
                select: vi.fn((_cols: string, selectOpts?: { head?: boolean }) => {
                    if (selectOpts?.head) {
                        return {
                            eq: vi.fn(() => ({
                                gte: vi.fn(() => Promise.resolve(opts.countResult)),
                            })),
                        };
                    }
                    return {
                        eq: vi.fn(() => ({
                            gte: vi.fn(() => ({
                                order: vi.fn(() => ({
                                    limit: vi.fn(() => ({
                                        single: vi.fn(() =>
                                            Promise.resolve({ data: opts.oldestRow ?? null })
                                        ),
                                    })),
                                })),
                            })),
                        })),
                    };
                }),
                insert,
            };
        }

        if (table === 'deployment_rate_limit_escalations') {
            return {
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        single: vi.fn(() => Promise.resolve({ data: opts.escalationRow ?? null })),
                    })),
                })),
                upsert,
                update,
            };
        }

        throw new Error(`Unexpected table: ${table}`);
    });

    return { from, insert, upsert, update, updateEq } as unknown as SupabaseClient & {
        insert: typeof insert;
        upsert: typeof upsert;
        update: typeof update;
        updateEq: typeof updateEq;
    };
}

describe('checkDeploymentRateLimit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('allows a request under the limit and logs it', async () => {
        const supabase = createSupabaseMock({
            countResult: { count: 5, error: null },
            escalationRow: null,
        });

        const result = await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(TIER_HOURLY_LIMITS.free);
        expect(result.remaining).toBe(TIER_HOURLY_LIMITS.free - 5 - 1);
        expect(result.escalated).toBe(false);
        expect(supabase.insert).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: 'user-1' })
        );
    });

    it('allows the request that reaches exactly one below the limit (boundary)', async () => {
        const supabase = createSupabaseMock({
            countResult: { count: TIER_HOURLY_LIMITS.free - 1, error: null },
            escalationRow: null,
        });

        const result = await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(0);
    });

    it('rejects a request at the limit boundary and returns the fields used for rate-limit headers', async () => {
        const oldestCreatedAt = new Date(NOW - 30 * 60 * 1_000).toISOString(); // 30 min into the window
        const supabase = createSupabaseMock({
            countResult: { count: TIER_HOURLY_LIMITS.free, error: null },
            oldestRow: { created_at: oldestCreatedAt },
            escalationRow: null,
        });

        const result = await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        // These fields map directly onto the response headers the caller sets:
        // X-RateLimit-Limit <- limit, X-RateLimit-Remaining <- remaining (0),
        // X-RateLimit-Reset <- resetAt, Retry-After <- retryAfterSeconds.
        expect(result.allowed).toBe(false);
        expect(result.limit).toBe(TIER_HOURLY_LIMITS.free);
        expect(result.remaining).toBe(0);
        expect(result.resetAt).toBe(new Date(oldestCreatedAt).getTime() + WINDOW_MS);
        expect(result.retryAfterSeconds).toBe(
            Math.ceil((result.resetAt - NOW) / 1_000)
        );
        expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('does not log a request that is rejected', async () => {
        const supabase = createSupabaseMock({
            countResult: { count: TIER_HOURLY_LIMITS.free, error: null },
            oldestRow: { created_at: new Date(NOW).toISOString() },
            escalationRow: null,
        });

        await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        expect(supabase.insert).not.toHaveBeenCalled();
    });

    it('retryAfterSeconds is always at least 1 even when the window resets almost immediately', async () => {
        const supabase = createSupabaseMock({
            countResult: { count: TIER_HOURLY_LIMITS.free, error: null },
            oldestRow: { created_at: new Date(NOW - WINDOW_MS + 100).toISOString() },
            escalationRow: null,
        });

        const result = await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it.each([
        ['free', TIER_HOURLY_LIMITS.free],
        ['pro', TIER_HOURLY_LIMITS.pro],
        ['enterprise', TIER_HOURLY_LIMITS.enterprise],
    ] as const)('uses the %s tier limit of %d requests/hour', async (tier, limit) => {
        const supabase = createSupabaseMock({
            countResult: { count: 0, error: null },
            escalationRow: null,
        });

        const result = await checkDeploymentRateLimit(supabase, 'user-1', tier);

        expect(result.limit).toBe(limit);
    });

    it('halves the effective limit once the user has been escalated', async () => {
        const supabase = createSupabaseMock({
            countResult: { count: 4, error: null },
            escalationRow: { hit_count: 3, window_start: new Date(NOW).toISOString() },
        });

        const result = await checkDeploymentRateLimit(supabase, 'user-1', 'free');
        const expectedLimit = Math.floor(TIER_HOURLY_LIMITS.free * ESCALATION_REDUCTION);

        expect(result.escalated).toBe(true);
        expect(result.limit).toBe(expectedLimit);
        // 4 requests already made against a reduced limit of 5 -> still allowed, 0 remaining after this one.
        expect(result.allowed).toBe(expectedLimit > 4);
    });

    it('ignores an escalation row whose window has expired', async () => {
        const expiredWindowStart = new Date(NOW - WINDOW_MS - 60_000).toISOString();
        const supabase = createSupabaseMock({
            countResult: { count: 4, error: null },
            escalationRow: { hit_count: 5, window_start: expiredWindowStart },
        });

        const result = await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        expect(result.escalated).toBe(false);
        expect(result.limit).toBe(TIER_HOURLY_LIMITS.free);
    });

    it('fails open (allows the request) when the count query errors', async () => {
        const supabase = createSupabaseMock({
            countResult: { count: null, error: new Error('db unavailable') },
            escalationRow: null,
        });

        const result = await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(TIER_HOURLY_LIMITS.free);
        expect(supabase.insert).not.toHaveBeenCalled();
    });

    it('starts a fresh escalation record via upsert on the first rejection', async () => {
        const supabase = createSupabaseMock({
            countResult: { count: TIER_HOURLY_LIMITS.free, error: null },
            oldestRow: { created_at: new Date(NOW).toISOString() },
            escalationRow: null,
        });

        await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        expect(supabase.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ user_id: 'user-1', hit_count: 1 })
        );
        expect(supabase.update).not.toHaveBeenCalled();
    });

    it('increments an existing, still-active escalation record via update', async () => {
        const supabase = createSupabaseMock({
            countResult: { count: TIER_HOURLY_LIMITS.free, error: null },
            oldestRow: { created_at: new Date(NOW).toISOString() },
            escalationRow: { hit_count: 1, window_start: new Date(NOW).toISOString() },
        });

        await checkDeploymentRateLimit(supabase, 'user-1', 'free');

        expect(supabase.update).toHaveBeenCalledWith(
            expect.objectContaining({ hit_count: 2 })
        );
        expect(supabase.upsert).not.toHaveBeenCalled();
    });
});
