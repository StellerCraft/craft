import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeploymentLogBatcher } from './deployment-log-batcher.service';

function makeSupabase(insertError: unknown = null) {
    const insert = vi.fn().mockResolvedValue({ error: insertError });
    const from = vi.fn().mockReturnValue({ insert });
    return { supabase: { from } as any, insert, from };
}

describe('DeploymentLogBatcher', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('flushes a full batch immediately without waiting for timer', async () => {
        const { supabase, insert } = makeSupabase();
        const batcher = new DeploymentLogBatcher(supabase, 2, 5000);

        await batcher.append({ deploymentId: 'd1', level: 'info', message: 'a' });
        expect(insert).not.toHaveBeenCalled();

        await batcher.append({ deploymentId: 'd1', level: 'info', message: 'b' });
        expect(insert).toHaveBeenCalledOnce();
        expect(insert.mock.calls[0][0]).toHaveLength(2);
    });

    it('flushes partial batch after interval', async () => {
        const { supabase, insert } = makeSupabase();
        const batcher = new DeploymentLogBatcher(supabase, 50, 100);

        await batcher.append({ deploymentId: 'd1', level: 'warn', message: 'partial' });
        expect(insert).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();
        expect(insert).toHaveBeenCalledOnce();
    });

    it('orders entries by timestamp within a batch', async () => {
        const { supabase, insert } = makeSupabase();
        const batcher = new DeploymentLogBatcher(supabase, 3, 5000);

        const t1 = '2024-01-01T00:00:03.000Z';
        const t2 = '2024-01-01T00:00:01.000Z';
        const t3 = '2024-01-01T00:00:02.000Z';

        await batcher.append({ deploymentId: 'd1', level: 'info', message: 'c', timestamp: t1 });
        await batcher.append({ deploymentId: 'd1', level: 'info', message: 'a', timestamp: t2 });
        await batcher.append({ deploymentId: 'd1', level: 'info', message: 'b', timestamp: t3 });

        const rows = insert.mock.calls[0][0] as Array<{ created_at: string }>;
        expect(rows.map((r) => r.created_at)).toEqual([t2, t3, t1]);
    });

    it('flushes remaining entries on explicit flush()', async () => {
        const { supabase, insert } = makeSupabase();
        const batcher = new DeploymentLogBatcher(supabase, 50, 60000);

        await batcher.append({ deploymentId: 'd1', level: 'error', message: 'x' });
        expect(insert).not.toHaveBeenCalled();

        await batcher.flush();
        expect(insert).toHaveBeenCalledOnce();
    });

    it('waits for in-flight flushes when pending flushes reach the limit', async () => {
        const { supabase, from } = makeSupabase();
        let resolveInsert!: () => void;
        const blocked = new Promise<void>((res) => { resolveInsert = res; });
        from.mockReturnValue({ insert: vi.fn().mockReturnValue(blocked.then(() => ({ error: null }))) });

        const batcher = new DeploymentLogBatcher({ from } as any, 1, 5000);

        // fill up 10 pending flushes — each append with batchSize=1 triggers a flush
        const appends: Promise<void>[] = [];
        for (let i = 0; i < 11; i++) {
            appends.push(batcher.append({ deploymentId: 'd1', level: 'info', message: `m${i}` }));
        }

        let eleventhSettled = false;
        appends[10].then(() => { eleventhSettled = true; });
        await Promise.resolve();
        expect(eleventhSettled).toBe(false);

        resolveInsert();
        await Promise.all(appends);
        expect(eleventhSettled).toBe(true);
    });

    it('does not double-flush on explicit flush() when timer already fired', async () => {
        const { supabase, insert } = makeSupabase();
        const batcher = new DeploymentLogBatcher(supabase, 50, 10);

        await batcher.append({ deploymentId: 'd1', level: 'info', message: 'once' });
        await vi.runAllTimersAsync();
        await batcher.flush(); // should be a no-op — queue is empty

        expect(insert).toHaveBeenCalledOnce();
    });
});
