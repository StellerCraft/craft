/**
 * Integration tests for GET /api/health/drain route and shutdown-manager.ts.
 *
 * Verifies the health drain readiness endpoint correctly reflects:
 *  - Pre-drain state (draining=false, inFlightCount reflects active operations)
 *  - Mid-drain state with in-flight operations (draining=true, inFlightCount > 0)
 *  - Dynamic operation tracking as operations complete during drain
 *  - Drain timeout force-failing stuck deployments and clearing in-flight count
 *  - Post-drain state (draining=true, inFlightCount=0)
 *
 * Issue: Graceful Shutdown Drain Integration Coverage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './route';
import {
    trackOperation,
    inFlightCount,
    isDraining,
    drain,
    registerRealtimeCleanup,
    _resetState,
} from '@/lib/shutdown-manager';

// ── Supabase Mock ─────────────────────────────────────────────────────────────

const mockUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
});

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: () => ({
            update: mockUpdate,
        }),
    }),
}));

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('GET /api/health/drain — integration tests', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        _resetState();
        vi.clearAllMocks();
    });

    afterEach(() => {
        _resetState();
        vi.useRealTimers();
    });

    // ─────────────────────────────────────────────────────────────────────────
    describe('Pre-drain state', () => {
        it('returns draining=false and inFlightCount=0 on an idle server', async () => {
            const response = await GET();
            expect(response.status).toBe(200);

            const body = await response.json();
            expect(body).toEqual({
                inFlightCount: 0,
                draining: false,
            });
        });

        it('reflects registered in-flight operations before drain is initiated', async () => {
            const done = trackOperation('dep-initial-001');

            const response = await GET();
            expect(response.status).toBe(200);

            const body = await response.json();
            expect(body).toEqual({
                inFlightCount: 1,
                draining: false,
            });

            done();
        });

        it('dynamically tracks multiple in-flight operations being added and completed pre-drain', async () => {
            const done1 = trackOperation('dep-101');
            const done2 = trackOperation('dep-102');
            const done3 = trackOperation('dep-103');

            let res = await GET();
            let body = await res.json();
            expect(body.inFlightCount).toBe(3);
            expect(body.draining).toBe(false);

            // Complete one operation
            done2();
            res = await GET();
            body = await res.json();
            expect(body.inFlightCount).toBe(2);
            expect(body.draining).toBe(false);

            // Complete remaining operations
            done1();
            done3();
            res = await GET();
            body = await res.json();
            expect(body.inFlightCount).toBe(0);
            expect(body.draining).toBe(false);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    describe('Mid-drain state (with in-flight operations)', () => {
        it('reflects draining=true and current in-flight count immediately after drain() is initiated', async () => {
            const done1 = trackOperation('dep-mid-001');
            const done2 = trackOperation('dep-mid-002');

            // Initiate drain in the background (will wait for in-flight operations)
            const drainPromise = drain();

            // Mid-drain: draining must be true and operations still tracked
            const response = await GET();
            expect(response.status).toBe(200);

            const body = await response.json();
            expect(body.draining).toBe(true);
            expect(body.inFlightCount).toBe(2);

            // Cleanup: complete operations and let drain finish
            done1();
            done2();
            await vi.advanceTimersByTimeAsync(200);
            await drainPromise;
        });

        it('updates inFlightCount in real-time as operations complete during drain', async () => {
            const done1 = trackOperation('dep-mid-step-1');
            const done2 = trackOperation('dep-mid-step-2');

            const drainPromise = drain();

            // Initial mid-drain state: 2 in flight
            let res = await GET();
            let body = await res.json();
            expect(body.draining).toBe(true);
            expect(body.inFlightCount).toBe(2);

            // First operation completes
            done1();
            res = await GET();
            body = await res.json();
            expect(body.draining).toBe(true);
            expect(body.inFlightCount).toBe(1);

            // Second operation completes
            done2();
            res = await GET();
            body = await res.json();
            expect(body.draining).toBe(true);
            expect(body.inFlightCount).toBe(0);

            // Advance timers so drain loop exits
            await vi.advanceTimersByTimeAsync(200);
            await drainPromise;
        });

        it('reflects inFlightCount=0 and draining=true when drain timeout force-fails stuck operations', async () => {
            // Register an operation that never calls done()
            trackOperation('dep-stuck-001');

            const drainPromise = drain();

            // Before timeout: draining=true, inFlightCount=1
            let res = await GET();
            let body = await res.json();
            expect(body.draining).toBe(true);
            expect(body.inFlightCount).toBe(1);

            // Advance past the 30s drain timeout window
            await vi.advanceTimersByTimeAsync(31_000);
            await drainPromise;

            // After timeout: stuck deployment force-failed, inFlightCount drops to 0
            res = await GET();
            body = await res.json();
            expect(body.draining).toBe(true);
            expect(body.inFlightCount).toBe(0);

            // Verify Supabase update was triggered for the stuck deployment
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'failed',
                    error_message: 'Shutdown: drain timeout',
                }),
            );
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    describe('Post-drain state', () => {
        it('reflects draining=true and inFlightCount=0 when drain() is called with no active operations', async () => {
            expect(isDraining()).toBe(false);
            expect(inFlightCount()).toBe(0);

            await drain();

            const response = await GET();
            expect(response.status).toBe(200);

            const body = await response.json();
            expect(body).toEqual({
                inFlightCount: 0,
                draining: true,
            });
        });

        it('remains in draining=true state across consecutive GET calls post-drain', async () => {
            const done = trackOperation('dep-post-001');
            const drainPromise = drain();

            done();
            await vi.advanceTimersByTimeAsync(200);
            await drainPromise;

            // Consecutive calls should consistently return post-drain status
            for (let i = 0; i < 3; i++) {
                const res = await GET();
                const body = await res.json();
                expect(res.status).toBe(200);
                expect(body).toEqual({
                    inFlightCount: 0,
                    draining: true,
                });
            }
        });

        it('invokes registered realtime cleanups during post-drain transition', async () => {
            const cleanupFn = vi.fn().mockResolvedValue(undefined);
            registerRealtimeCleanup(cleanupFn);

            await drain();

            expect(cleanupFn).toHaveBeenCalledOnce();

            const response = await GET();
            const body = await response.json();
            expect(body).toEqual({
                inFlightCount: 0,
                draining: true,
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    describe('Response contract and headers', () => {
        it('returns JSON content-type with valid schema', async () => {
            const response = await GET();
            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('application/json');

            const body = await response.json();
            expect(typeof body.inFlightCount).toBe('number');
            expect(typeof body.draining).toBe('boolean');
        });
    });
});
