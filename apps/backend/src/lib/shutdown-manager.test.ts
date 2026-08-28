/**
 * Tests for shutdown-manager.ts — graceful deployment drain.
 *
 * Uses fake timers to control the drain timeout window and dynamic imports
 * so each describe block gets a fresh module instance with clean state.
 *
 * Issue: #XXX — Graceful Shutdown Drain
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: () => ({
            update: mockUpdate,
        }),
    }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

async function importModule() {
    return await import('./shutdown-manager');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('shutdown-manager — core functions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('isDraining returns false initially', async () => {
        const mod = await importModule();
        expect(mod.isDraining()).toBe(false);
    });

    it('trackOperation adds to inFlight and returns a done callback', async () => {
        const mod = await importModule();
        expect(mod.inFlightCount()).toBe(0);

        const done = mod.trackOperation('deploy-1');
        expect(mod.inFlightCount()).toBe(1);

        done();
        expect(mod.inFlightCount()).toBe(0);
    });

    it('inFlightCount returns correct count for multiple operations', async () => {
        const mod = await importModule();

        const done1 = mod.trackOperation('a');
        const done2 = mod.trackOperation('b');
        const done3 = mod.trackOperation('c');
        expect(mod.inFlightCount()).toBe(3);

        done2();
        expect(mod.inFlightCount()).toBe(2);

        done1();
        done3();
        expect(mod.inFlightCount()).toBe(0);
    });

    it('registerRealtimeCleanup stores callbacks invoked by unsubscribeAll', async () => {
        const mod = await importModule();

        const cleanup1 = vi.fn().mockResolvedValue(undefined);
        const cleanup2 = vi.fn().mockResolvedValue(undefined);

        mod.registerRealtimeCleanup(cleanup1);
        mod.registerRealtimeCleanup(cleanup2);

        await mod.unsubscribeAll();

        expect(cleanup1).toHaveBeenCalledOnce();
        expect(cleanup2).toHaveBeenCalledOnce();
    });

    it('unsubscribeAll swallows errors from individual cleanups', async () => {
        const mod = await importModule();

        const good = vi.fn().mockResolvedValue(undefined);
        const bad = vi.fn().mockRejectedValue(new Error('cleanup failed'));

        mod.registerRealtimeCleanup(good);
        mod.registerRealtimeCleanup(bad);
        mod.registerRealtimeCleanup(good);

        await expect(mod.unsubscribeAll()).resolves.toBeUndefined();
        expect(good).toHaveBeenCalledTimes(2);
        expect(bad).toHaveBeenCalledOnce();
    });
});

describe('shutdown-manager — drain', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('drain completes immediately when no operations are in-flight', async () => {
        const mod = await importModule();

        expect(mod.isDraining()).toBe(false);
        await mod.drain();
        // After drain completes, draining flag is set
    });

    it('drain sets draining flag and waits for in-flight operations to complete', async () => {
        const mod = await importModule();

        const done = mod.trackOperation('deploy-1');

        const drainPromise = mod.drain();

        // Before timers advance, drain is waiting
        expect(mod.isDraining()).toBe(true);

        // Complete the in-flight operation
        done();

        // Advance past one poll cycle so drain re-checks inFlight.size
        await vi.advanceTimersByTimeAsync(200);

        await drainPromise;
    });

    it('forceFailStuckDeployments updates stuck deployments to failed', async () => {
        const mod = await importModule();

        mod.trackOperation('stuck-deploy-1');
        mod.trackOperation('stuck-deploy-2');

        await mod.forceFailStuckDeployments();

        expect(mockUpdate).toHaveBeenCalled();
        const updateArg = mockUpdate.mock.calls[0][0];
        expect(updateArg.status).toBe('failed');
        expect(updateArg.error_message).toBe('Shutdown: drain timeout');
    });

    it('drain calls forceFailStuckDeployments when timeout expires with in-flight ops', async () => {
        const mod = await importModule();

        // Register an operation that never completes
        mod.trackOperation('stuck-deploy');

        const drainPromise = mod.drain();

        // Fast forward past the 30s drain timeout
        await vi.advanceTimersByTimeAsync(31_000);

        await drainPromise;

        // The stuck deployment should have been force-failed
        expect(mod.inFlightCount()).toBe(0);
        expect(mockUpdate).toHaveBeenCalled();
        const updateArg = mockUpdate.mock.calls[0][0];
        expect(updateArg.status).toBe('failed');
        expect(updateArg.error_message).toBe('Shutdown: drain timeout');
    });

    it('drain calls unsubscribeAll after force-failing stuck deployments', async () => {
        const mod = await importModule();

        const cleanup = vi.fn().mockResolvedValue(undefined);
        mod.registerRealtimeCleanup(cleanup);

        mod.trackOperation('stuck-deploy');

        const drainPromise = mod.drain();
        await vi.advanceTimersByTimeAsync(31_000);
        await drainPromise;

        expect(cleanup).toHaveBeenCalledOnce();
    });
});
