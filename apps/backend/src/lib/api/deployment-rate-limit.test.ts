import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    checkDeploymentRateLimit,
    TIER_HOURLY_LIMITS,
    ESCALATION_THRESHOLD,
    ESCALATION_REDUCTION,
    WINDOW_MS,
} from './deployment-rate-limit';

// ── Supabase mock ─────────────────────────────────────────────────────────────

interface MockOptions {
    requestRows?: Array<{ user_id: string; created_at: string }>;
    escalationRow?: { hit_count: number; window_start: string } | null;
    countError?: { message: string } | null;
}

function makeSupabaseMock({ requestRows = [], escalationRow = null, countError = null }: MockOptions = {}) {
    const inserted: Array<Record<string, unknown>> = [];
    const upserts: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    let escalation = escalationRow;

    const client = {
        from(table: string) {
            if (table === 'deployment_rate_limit_requests') {
                return {
                    select(_cols: string, opts?: { count?: string; head?: boolean }) {
                        if (opts?.count === 'exact' && opts?.head) {
                            return {
                                eq(_col: string, userId: string) {
                                    return {
                                        gte(_col2: string, sinceIso: string) {
                                            if (countError) {
                                                return Promise.resolve({ count: null, error: countError });
                                            }
                                            const count = requestRows.filter(
                                                (r) => r.user_id === userId && r.created_at >= sinceIso,
                                            ).length;
                                            return Promise.resolve({ count, error: null });
                                        },
                                    };
                                },
                            };
                        }
                        // oldest-request lookup: select('created_at')
                        return {
                            eq(_col: string, userId: string) {
                                return {
                                    gte(_col2: string, sinceIso: string) {
                                        return {
                                            order() {
                                                return {
                                                    limit() {
                                                        return {
                                                            single() {
                                                                const rows = requestRows
                                                                    .filter(
                                                                        (r) =>
                                                                            r.user_id === userId &&
                                                                            r.created_at >= sinceIso,
                                                                    )
                                                                    .sort((a, b) =>
                                                                        a.created_at.localeCompare(b.created_at),
                                                                    );
                                                                const oldest = rows[0] ?? null;
                                                                return Promise.resolve({
                                                                    data: oldest,
                                                                    error: oldest ? null : { message: 'no rows' },
                                                                });
                                                            },
                                                        };
                                                    },
                                                };
                                            },
                                        };
                                    },
                                };
                            },
                        };
                    },
                    insert(row: Record<string, unknown>) {
                        inserted.push(row);
                        return Promise.resolve({ error: null });
                    },
                };
            }

            if (table === 'deployment_rate_limit_escalations') {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    single() {
                                        return Promise.resolve({ data: escalation, error: null });
                                    },
                                };
                            },
                        };
                    },
                    upsert(row: Record<string, unknown>) {
                        upserts.push(row);
                        escalation = row as typeof escalation;
                        return Promise.resolve({ error: null });
                    },
                    update(patch: Record<string, unknown>) {
                        return {
                            eq() {
                                updates.push(patch);
                                escalation = { ...(escalation as any), ...patch };
                                return Promise.resolve({ error: null });
                            },
                        };
                    },
                };
            }

            throw new Error(`Unexpected table: ${table}`);
        },
    } as unknown as SupabaseClient;

    return { client, inserted, upserts, updates, getEscalation: () => escalation };
}

describe('checkDeploymentRateLimit', () => {
    it('allows a request under the tier limit and logs it', async () => {
        const mock = makeSupabaseMock({ requestRows: [] });

        const result = await checkDeploymentRateLimit(mock.client, 'user-1', 'free');

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(TIER_HOURLY_LIMITS.free);
        expect(result.remaining).toBe(TIER_HOURLY_LIMITS.free - 1);
        expect(result.escalated).toBe(false);
        expect(mock.inserted).toHaveLength(1);
        expect(mock.inserted[0]).toMatchObject({ user_id: 'user-1' });
    });

    it('allows the request that reaches exactly one below the limit boundary', async () => {
        const now = Date.now();
        const requestRows = Array.from({ length: TIER_HOURLY_LIMITS.free - 1 }, (_, i) => ({
            user_id: 'user-2',
            created_at: new Date(now - i * 1000).toISOString(),
        }));
        const mock = makeSupabaseMock({ requestRows });

        const result = await checkDeploymentRateLimit(mock.client, 'user-2', 'free');

        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(0);
    });

    it('rejects the request that hits the limit boundary', async () => {
        const now = Date.now();
        const requestRows = Array.from({ length: TIER_HOURLY_LIMITS.free }, (_, i) => ({
            user_id: 'user-3',
            created_at: new Date(now - i * 1000).toISOString(),
        }));
        const mock = makeSupabaseMock({ requestRows });

        const result = await checkDeploymentRateLimit(mock.client, 'user-3', 'free');

        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
        expect(result.limit).toBe(TIER_HOURLY_LIMITS.free);
        expect(mock.inserted).toHaveLength(0);
    });

    it('computes retryAfterSeconds and resetAt from the oldest request in the window on rejection', async () => {
        const now = Date.now();
        const oldestCreatedAt = new Date(now - 10_000).toISOString();
        const requestRows = [
            { user_id: 'user-4', created_at: oldestCreatedAt },
            ...Array.from({ length: TIER_HOURLY_LIMITS.free - 1 }, (_, i) => ({
                user_id: 'user-4',
                created_at: new Date(now - i * 100).toISOString(),
            })),
        ];
        const mock = makeSupabaseMock({ requestRows });

        const result = await checkDeploymentRateLimit(mock.client, 'user-4', 'free');

        expect(result.allowed).toBe(false);
        const expectedResetAt = new Date(oldestCreatedAt).getTime() + WINDOW_MS;
        expect(result.resetAt).toBe(expectedResetAt);
        expect(result.retryAfterSeconds).toBe(Math.max(1, Math.ceil((expectedResetAt - now) / 1000)));
    });

    it('records an escalation hit on rejection', async () => {
        const now = Date.now();
        const requestRows = Array.from({ length: TIER_HOURLY_LIMITS.free }, (_, i) => ({
            user_id: 'user-5',
            created_at: new Date(now - i * 1000).toISOString(),
        }));
        const mock = makeSupabaseMock({ requestRows, escalationRow: null });

        await checkDeploymentRateLimit(mock.client, 'user-5', 'free');

        expect(mock.getEscalation()).toMatchObject({ user_id: 'user-5', hit_count: 1 });
    });

    it('halves the effective limit once escalation threshold is reached', async () => {
        const now = Date.now();
        const mock = makeSupabaseMock({
            requestRows: [],
            escalationRow: {
                hit_count: ESCALATION_THRESHOLD,
                window_start: new Date(now - 1000).toISOString(),
            },
        });

        const result = await checkDeploymentRateLimit(mock.client, 'user-6', 'free');

        expect(result.escalated).toBe(true);
        expect(result.limit).toBe(Math.floor(TIER_HOURLY_LIMITS.free * ESCALATION_REDUCTION));
    });

    it('does not escalate when the escalation window has expired', async () => {
        const now = Date.now();
        const mock = makeSupabaseMock({
            requestRows: [],
            escalationRow: {
                hit_count: ESCALATION_THRESHOLD + 5,
                window_start: new Date(now - WINDOW_MS - 1000).toISOString(),
            },
        });

        const result = await checkDeploymentRateLimit(mock.client, 'user-7', 'free');

        expect(result.escalated).toBe(false);
        expect(result.limit).toBe(TIER_HOURLY_LIMITS.free);
    });

    it('fails open (allows the request) when the count query errors', async () => {
        const mock = makeSupabaseMock({ countError: { message: 'db unavailable' } });

        const result = await checkDeploymentRateLimit(mock.client, 'user-8', 'pro');

        expect(result.allowed).toBe(true);
        expect(result.limit).toBe(TIER_HOURLY_LIMITS.pro);
        expect(result.retryAfterSeconds).toBe(0);
    });

    it('applies the correct per-tier limits', async () => {
        for (const tier of ['free', 'pro', 'enterprise'] as const) {
            const mock = makeSupabaseMock();
            const result = await checkDeploymentRateLimit(mock.client, `user-tier-${tier}`, tier);
            expect(result.limit).toBe(TIER_HOURLY_LIMITS[tier]);
        }
    });
});
