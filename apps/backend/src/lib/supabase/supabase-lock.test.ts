import { describe, it, expect, vi, beforeEach } from 'vitest';
import { acquireAdvisoryLock, releaseAdvisoryLock } from './supabase-lock';

vi.mock('./server', () => ({
    createClient: vi.fn(),
}));

import { createClient } from './server';

describe('supabase-lock', () => {
    let mockRpc: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockRpc = vi.fn().mockResolvedValue({ data: true, error: null });
        (createClient as any).mockReturnValue({ rpc: mockRpc });
    });

    describe('hashKey determinism', () => {
        it('produces the same lock id for the same key', async () => {
            await acquireAdvisoryLock('my-unique-key', 1000);
            await acquireAdvisoryLock('my-unique-key', 1000);

            const lockIds = mockRpc.mock.calls.map((call: any) => call[1].lock_id);
            expect(lockIds[0]).toBe(lockIds[1]);
        });

        it('produces distinct lock ids for distinct realistic keys', async () => {
            await acquireAdvisoryLock('deployment-pipeline-user-123', 1000);
            await acquireAdvisoryLock('vercel-sync-service-customer-456', 1000);

            const lockIds = mockRpc.mock.calls.map((call: any) => call[1].lock_id);
            expect(lockIds[0]).not.toBe(lockIds[1]);
        });
    });

    describe('acquireAdvisoryLock', () => {
        it('returns true immediately when the lock is acquired on first try', async () => {
            const result = await acquireAdvisoryLock('lock-key', 5000);

            expect(result).toBe(true);
            expect(mockRpc).toHaveBeenCalledWith('pg_try_advisory_lock', { lock_id: expect.any(Number) });
            expect(mockRpc).toHaveBeenCalledTimes(1);
        });

        it('polls and returns true when lock is acquired after retry', async () => {
            mockRpc
                .mockResolvedValueOnce({ data: false, error: null })
                .mockResolvedValueOnce({ data: true, error: null });

            const result = await acquireAdvisoryLock('lock-key', 5000);

            expect(result).toBe(true);
            expect(mockRpc).toHaveBeenCalledTimes(2);
        });

        it('returns false when timeout expires before lock is acquired', async () => {
            mockRpc.mockResolvedValue({ data: false, error: null });

            const result = await acquireAdvisoryLock('lock-key', 100);

            expect(result).toBe(false);
        });

        it('throws a descriptive error when the rpc returns an error', async () => {
            mockRpc.mockResolvedValue({ data: null, error: { message: 'connection lost' } });

            await expect(acquireAdvisoryLock('lock-key', 5000)).rejects.toThrow(
                'Advisory lock error: connection lost'
            );
        });
    });

    describe('releaseAdvisoryLock', () => {
        it('calls pg_advisory_unlock with the same lock id', async () => {
            mockRpc.mockResolvedValue({ data: null, error: null });

            await releaseAdvisoryLock('lock-key');

            expect(mockRpc).toHaveBeenCalledWith('pg_advisory_unlock', { lock_id: expect.any(Number) });
        });
    });
});
