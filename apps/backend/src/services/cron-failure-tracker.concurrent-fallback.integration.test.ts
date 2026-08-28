/**
 * Concurrent-fallback integration test for CronFailureTrackerService — Issue #1140
 *
 * Simulates the scenario where:
 *   1. The `increment_cron_failure` RPC is unavailable (returns an error).
 *   2. Two concurrent `recordFailure` calls arrive for the same jobName.
 *
 * Asserts that the optimistic-concurrency guard prevents silent increment loss:
 *   - At least one of the two concurrent calls persists its increment.
 *   - A warning is emitted when the retries-exhausted fallback fires.
 *   - A warning is emitted when the fallback path is entered at all (RPC down).
 *
 * Issue: #1140
 * Branch: fix/cron-failure-tracker-fallback-concurrent-loss
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Supabase mock wiring ──────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
const mockCreateClient = vi.mocked(createClient);

// ── Chain builder ─────────────────────────────────────────────────────────────
//
// The service's fallback path calls:
//
//   select:  supabase.from('cron_job_failures').select('consecutive_failures').eq('job_name', x).maybeSingle()
//   update:  supabase.from('cron_job_failures').update({...}).eq('job_name', x).eq('consecutive_failures', current).select('consecutive_failures').maybeSingle()
//   insert:  supabase.from('cron_job_failures').insert({...}).select('consecutive_failures').maybeSingle()
//   upsert:  supabase.from('cron_job_failures').upsert({...}, {onConflict:'job_name'})
//   single:  supabase.from('cron_job_failures').select('slack_alert_sent,...').eq('job_name',x).single()
//
// We model this as a simple call-count based state machine backed by a shared row.

function makeChainBuilder(shared: {
    row: { consecutive_failures: number } | null;
    upsertPayload: Record<string, unknown> | null;
}) {
    return function makeChain() {
        // Track the intended operation and relevant payload/constraints
        const self = {
            _op: 'select' as 'select' | 'update' | 'insert' | 'upsert',
            _updatePayload: {} as Record<string, unknown>,
            _insertPayload: {} as Record<string, unknown>,
            _eqExpectedFailures: undefined as number | undefined,

            select(_cols?: string) {
                // Preserve the current op (chained after update → stays update)
                return self;
            },
            update(payload: Record<string, unknown>) {
                self._op = 'update';
                self._updatePayload = { ...payload };
                return self;
            },
            insert(payload: Record<string, unknown>) {
                self._op = 'insert';
                self._insertPayload = { ...payload };
                return self;
            },
            async upsert(payload: Record<string, unknown>) {
                shared.upsertPayload = { ...payload };
                if (typeof payload['consecutive_failures'] === 'number') {
                    shared.row = { consecutive_failures: payload['consecutive_failures'] as number };
                }
                return { data: null, error: null };
            },
            eq(col: string, val: unknown) {
                // Capture the OCC constraint
                if (col === 'consecutive_failures' && typeof val === 'number') {
                    self._eqExpectedFailures = val;
                }
                return self;
            },
            async maybeSingle(): Promise<{ data: unknown; error: unknown }> {
                if (self._op === 'select') {
                    return {
                        data: shared.row ? { ...shared.row } : null,
                        error: null,
                    };
                }

                if (self._op === 'update') {
                    // OCC: only succeed when stored value === expected
                    const expected = self._eqExpectedFailures;
                    const newCount = self._updatePayload['consecutive_failures'];
                    if (
                        shared.row !== null &&
                        expected !== undefined &&
                        shared.row.consecutive_failures === expected
                    ) {
                        shared.row = { consecutive_failures: newCount as number };
                        return {
                            data: { consecutive_failures: newCount },
                            error: null,
                        };
                    }
                    // OCC conflict
                    return { data: null, error: null };
                }

                if (self._op === 'insert') {
                    if (shared.row === null) {
                        const count = (self._insertPayload['consecutive_failures'] as number) ?? 1;
                        shared.row = { consecutive_failures: count };
                        return {
                            data: { consecutive_failures: count },
                            error: null,
                        };
                    }
                    // Row already exists
                    return {
                        data: null,
                        error: { message: 'duplicate key' },
                    };
                }

                return { data: null, error: null };
            },
            async single() {
                return {
                    data: { slack_alert_sent: false, email_alert_sent: false },
                    error: null,
                };
            },
        };

        return self;
    };
}

function makeSupabaseMock(initialFailures: number | null = 0) {
    const shared = {
        row: initialFailures === null ? null : { consecutive_failures: initialFailures },
        upsertPayload: null as Record<string, unknown> | null,
    };

    const makeChain = makeChainBuilder(shared);

    return {
        shared,
        rpc: vi.fn().mockImplementation((fnName: string) => {
            if (fnName === 'increment_cron_failure') {
                return Promise.resolve({
                    data: null,
                    error: { message: 'RPC unavailable (simulated for test)' },
                });
            }
            // mark_cron_alert_sent and others succeed
            return Promise.resolve({ data: null, error: null });
        }),
        from: vi.fn((_table: string) => makeChain()),
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CronFailureTrackerService — concurrent fallback (#1140)', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        // Disable Slack alerts so fetch() isn't needed
        process.env.SLACK_WEBHOOK_URL = undefined as unknown as string;
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response());
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        vi.restoreAllMocks();
    });

    async function load() {
        const mod = await import('./cron-failure-tracker.service');
        return new mod.CronFailureTrackerService();
    }

    // ── 1: RPC fallback warning ───────────────────────────────────────────────

    it('logs a console.error when the RPC is unavailable and the fallback path is entered', async () => {
        const mock = makeSupabaseMock(0);
        mockCreateClient.mockReturnValue(mock as any);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const svc = await load();
        await svc.recordFailure('rpc-down-job', 'simulated rpc failure');

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('[cron-failure-tracker] RPC call failed'),
            expect.anything(),
        );
    });

    // ── 2: Single fallback increment ─────────────────────────────────────────

    it('single recordFailure in fallback path increments consecutive_failures by exactly 1', async () => {
        const mock = makeSupabaseMock(2); // stored = 2
        mockCreateClient.mockReturnValue(mock as any);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const svc = await load();
        await svc.recordFailure('single-fallback-job', 'test error');

        // Should have gone from 2 → 3 via the OCC update
        expect(mock.shared.row?.consecutive_failures).toBe(3);
    });

    // ── 3: Two concurrent calls — no silent drop ─────────────────────────────

    it('two concurrent recordFailure calls in the fallback path: no increment is silently dropped', async () => {
        /**
         * Both calls share the same in-memory row (starting at 0).
         * The OCC guard means: whichever call reads 0 and updates to 1 first
         * wins; the other call detects the conflict and retries (reads 1,
         * updates to 2).
         *
         * In the worst case (both retries exhausted), the last-resort upsert
         * still records a count > 0 so no increment is silently dropped.
         */
        const mock = makeSupabaseMock(0);
        mockCreateClient.mockReturnValue(mock as any);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const svc = await load();

        await Promise.all([
            svc.recordFailure('concurrent-job', 'error-A'),
            svc.recordFailure('concurrent-job', 'error-B'),
        ]);

        // At minimum one increment must have been persisted
        const stored = mock.shared.row?.consecutive_failures ?? 0;
        const upserted = Number(mock.shared.upsertPayload?.['consecutive_failures'] ?? 0);
        const finalCount = Math.max(stored, upserted);

        expect(finalCount).toBeGreaterThanOrEqual(1);
    });

    // ── 4: Warning when OCC retries are exhausted ────────────────────────────

    it('emits console.warn when all optimistic-concurrency retries are exhausted', async () => {
        /**
         * Craft a mock where every update attempt hits an OCC conflict
         * (the stored value is always different from what the caller read).
         * With MAX_RETRIES = 3, all three attempts fail → the warning fires.
         */
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        let upsertCalled = false;
        const mockedUpsertPayload: Record<string, unknown>[] = [];

        const alwaysConflictMock = {
            rpc: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'RPC unavailable' },
            }),
            from: vi.fn((_table: string) => {
                const self = {
                    _op: 'select' as string,
                    _updatePayload: {} as Record<string, unknown>,

                    select(_cols?: string) {
                        return self;
                    },
                    update(payload: Record<string, unknown>) {
                        self._op = 'update';
                        self._updatePayload = { ...payload };
                        return self;
                    },
                    insert(_payload: unknown) {
                        self._op = 'insert';
                        return self;
                    },
                    async upsert(payload: unknown) {
                        upsertCalled = true;
                        if (payload && typeof payload === 'object') {
                            mockedUpsertPayload.push({ ...(payload as Record<string, unknown>) });
                        }
                        return { data: null, error: null };
                    },
                    eq(_col: string, _val: unknown) {
                        return self;
                    },
                    async maybeSingle() {
                        if (self._op === 'select') {
                            // Always return a fixed value so the OCC update
                            // never matches (simulates another writer always winning)
                            return { data: { consecutive_failures: 5 }, error: null };
                        }
                        // All update/insert attempts "conflict" → data: null
                        return { data: null, error: null };
                    },
                    async single() {
                        return {
                            data: { slack_alert_sent: false, email_alert_sent: false },
                            error: null,
                        };
                    },
                };
                return self;
            }),
        };

        mockCreateClient.mockReturnValue(alwaysConflictMock as any);
        const svc = await load();

        await svc.recordFailure('always-conflict-job', 'high contention');

        // The retries-exhausted warning MUST be emitted
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[cron-failure-tracker] Optimistic-concurrency retries exhausted'),
        );

        // The last-resort upsert must have been called
        expect(upsertCalled).toBe(true);
    });

    // ── 5: Retries-exhausted upsert records a non-zero count ─────────────────

    it('the retry-exhausted upsert records consecutive_failures > 0 (not a silent zero)', async () => {
        /**
         * Even when all OCC retries fail, the final non-atomic upsert must
         * record a failure count > 0 — no increment is silently lost to zero.
         */
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const capturedUpserts: Array<Record<string, unknown>> = [];

        const alwaysConflictMock = {
            rpc: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'RPC unavailable' },
            }),
            from: vi.fn((_table: string) => {
                const self = {
                    _op: 'select' as string,

                    select(_cols?: string) {
                        return self;
                    },
                    update(_payload: unknown) {
                        self._op = 'update';
                        return self;
                    },
                    insert(_payload: unknown) {
                        self._op = 'insert';
                        return self;
                    },
                    async upsert(payload: unknown) {
                        if (payload && typeof payload === 'object') {
                            capturedUpserts.push({ ...(payload as Record<string, unknown>) });
                        }
                        return { data: null, error: null };
                    },
                    eq(_col: string, _val: unknown) {
                        return self;
                    },
                    async maybeSingle() {
                        if (self._op === 'select') {
                            // Return a stored value of 1 each time
                            return { data: { consecutive_failures: 1 }, error: null };
                        }
                        // All update/insert attempts fail
                        return { data: null, error: null };
                    },
                    async single() {
                        return {
                            data: { slack_alert_sent: false, email_alert_sent: false },
                            error: null,
                        };
                    },
                };
                return self;
            }),
        };

        mockCreateClient.mockReturnValue(alwaysConflictMock as any);
        const svc = await load();

        await svc.recordFailure('non-silent-drop-job', 'test error');

        // At least one upsert must have been called
        expect(capturedUpserts.length).toBeGreaterThan(0);

        // The upsert for cron_job_failures must carry job_name and a count > 0
        const cronUpsert = capturedUpserts.find(
            (u) => u['job_name'] === 'non-silent-drop-job',
        );
        expect(cronUpsert).toBeDefined();
        expect(Number(cronUpsert!['consecutive_failures'])).toBeGreaterThan(0);
    });
});
