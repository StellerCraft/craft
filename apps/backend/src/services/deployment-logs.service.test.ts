/**
 * Tests for deploymentLogsService.writeLog() batching behaviour:
 * - batch accumulation up to BATCH_SIZE
 * - timer-based flush after 500ms
 * - ordering by timestamp
 * - backpressure when MAX_QUEUED_BATCHES exceeded
 * - graceful shutdown via flushAll()
 *
 * Uses vi.useFakeTimers() to control the flush interval.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deploymentLogsService } from '@/services/deployment-logs.service';

// Mock shutdown-manager so trackOperation is a no-op
vi.mock('@/lib/shutdown-manager', () => ({
    trackOperation: vi.fn().mockReturnValue(() => {}),
    isDraining: vi.fn().mockReturnValue(false),
    drain: vi.fn().mockResolvedValue(undefined),
    inFlightCount: vi.fn().mockReturnValue(0),
}));

function makeSupabase(insertMock?: ReturnType<typeof vi.fn>) {
    const insert = insertMock ?? vi.fn().mockResolvedValue({ error: null });
    return {
        from: vi.fn().mockReturnValue({ insert }),
        _insert: insert,
    } as any;
}

beforeEach(() => {
    deploymentLogsService._resetBatch();
    vi.useFakeTimers();
});

afterEach(() => {
    deploymentLogsService._resetBatch();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('deploymentLogsService.writeLog() batching', () => {
    it('buffers entries and does not flush before BATCH_SIZE or timer fires', () => {
        const supabase = makeSupabase();

        deploymentLogsService.writeLog(
            { deploymentId: 'dep-1', level: 'info', message: 'msg1' },
            supabase,
        );

        // No flush yet
        expect(supabase._insert).not.toHaveBeenCalled();
    });

    it('flushes automatically when batch reaches default size (50)', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabase = {
            from: vi.fn().mockReturnValue({ insert }),
        } as any;

        for (let i = 0; i < 50; i++) {
            deploymentLogsService.writeLog(
                { deploymentId: 'dep-1', level: 'info', message: `msg${i}`, timestamp: new Date(i).toISOString() },
                supabase,
            );
        }

        // Flush is triggered synchronously at BATCH_SIZE; advance timers to let async writeBatch settle
        await vi.advanceTimersByTimeAsync(0);

        expect(insert).toHaveBeenCalledTimes(1);
        const rows = insert.mock.calls[0][0];
        expect(rows).toHaveLength(50);
    });

    it('flushes after 500ms timer fires even with fewer than batch-size entries', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabase = {
            from: vi.fn().mockReturnValue({ insert }),
        } as any;

        deploymentLogsService.writeLog(
            { deploymentId: 'dep-2', level: 'warn', message: 'partial batch' },
            supabase,
        );

        expect(insert).not.toHaveBeenCalled();

        // Advance timer past flush interval and await async callbacks
        await vi.advanceTimersByTimeAsync(500);

        expect(insert).toHaveBeenCalledTimes(1);
    });

    it('orders batch entries by timestamp ascending', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabase = {
            from: vi.fn().mockReturnValue({ insert }),
        } as any;

        const timestamps = [
            '2024-01-01T00:00:03.000Z',
            '2024-01-01T00:00:01.000Z',
            '2024-01-01T00:00:02.000Z',
        ];

        for (const ts of timestamps) {
            deploymentLogsService.writeLog(
                { deploymentId: 'dep-3', level: 'info', message: `msg at ${ts}`, timestamp: ts },
                supabase,
            );
        }

        await vi.advanceTimersByTimeAsync(500);

        const rows: Array<{ created_at: string }> = insert.mock.calls[0][0];
        const sorted = [...rows].sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        expect(rows).toEqual(sorted);
    });

    it('flushAll() flushes buffered entries immediately', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabase = {
            from: vi.fn().mockReturnValue({ insert }),
        } as any;

        deploymentLogsService.writeLog(
            { deploymentId: 'dep-4', level: 'error', message: 'shutdown flush' },
            supabase,
        );

        const flushPromise = deploymentLogsService.flushAll();
        // flushAll uses setTimeout(resolve, 0) — advance past it
        await vi.advanceTimersByTimeAsync(1);
        await flushPromise;

        expect(insert).toHaveBeenCalledTimes(1);
    });

    it('applies backpressure when MAX_QUEUED_BATCHES (10) is exceeded', async () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const insert = vi
            .fn()
            .mockImplementation(() => new Promise((res) => setTimeout(() => res({ error: null }), 10000)));
        const supabase = {
            from: vi.fn().mockReturnValue({ insert }),
        } as any;

        // Fill up 11 batches (each 50 entries) — 11th triggers backpressure
        for (let batch = 0; batch < 11; batch++) {
            for (let i = 0; i < 50; i++) {
                deploymentLogsService.writeLog(
                    { deploymentId: 'dep-5', level: 'info', message: `b${batch}-m${i}`, timestamp: new Date(i).toISOString() },
                    supabase,
                );
            }
            await vi.advanceTimersByTimeAsync(0);
        }

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('Backpressure'),
        );
    });

    it('sets default timestamp when not provided', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabase = {
            from: vi.fn().mockReturnValue({ insert }),
        } as any;

        const before = new Date().toISOString();
        deploymentLogsService.writeLog(
            { deploymentId: 'dep-6', level: 'info', message: 'no-ts' },
            supabase,
        );

        await vi.advanceTimersByTimeAsync(500);

        const rows: Array<{ created_at: string }> = insert.mock.calls[0][0];
        expect(rows[0].created_at >= before).toBe(true);
    });

    it('uses default stage "build" when stage is not provided', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabase = {
            from: vi.fn().mockReturnValue({ insert }),
        } as any;

        deploymentLogsService.writeLog(
            { deploymentId: 'dep-7', level: 'info', message: 'no-stage' },
            supabase,
        );

        await vi.advanceTimersByTimeAsync(500);

        const rows: Array<{ stage: string }> = insert.mock.calls[0][0];
        expect(rows[0].stage).toBe('build');
    });
});
