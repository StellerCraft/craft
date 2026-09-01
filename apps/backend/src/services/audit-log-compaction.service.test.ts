import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogCompactionService } from './audit-log-compaction.service';

function makeRow(id: string, daysAgo: number) {
    const d = new Date('2024-06-01T00:00:00Z');
    d.setDate(d.getDate() - daysAgo);
    return { id, created_at: d.toISOString(), email: 'user@example.com', ip_address: '1.2.3.4', pii_redacted: false };
}

function makeSupabase({
    rows = [] as ReturnType<typeof makeRow>[],
    fetchError = null as unknown,
    uploadError = null as unknown,
    updateError = null as unknown,
} = {}) {
    const download = vi.fn().mockResolvedValue({
        data: { text: async () => rows.map((r) => JSON.stringify(r)).join('\n') },
        error: null,
    });
    const list = vi.fn().mockResolvedValue({ data: [{ name: 'batch.ndjson' }], error: null });
    const upload = vi.fn().mockResolvedValue({ error: uploadError });
    const storage = { from: vi.fn().mockReturnValue({ upload, list, download }) };

    const update = vi.fn().mockReturnValue({ error: updateError });
    const inFn = vi.fn().mockReturnValue({ error: updateError });
    const eqFn = vi.fn().mockReturnThis();
    const ltFn = vi.fn().mockReturnThis();
    const limitFn = vi.fn().mockResolvedValue({ data: rows, error: fetchError });
    const select = vi.fn().mockReturnValue({ lt: ltFn, eq: eqFn, limit: limitFn });
    ltFn.mockReturnValue({ eq: eqFn });
    eqFn.mockReturnValue({ limit: limitFn });
    const from = vi.fn().mockReturnValue({ select, update: vi.fn().mockReturnValue({ in: inFn }) });

    return { supabase: { from, storage } as any, upload, inFn, list, download };
}

const fixedNow = () => new Date('2024-06-01T00:00:00Z');

describe('AuditLogCompactionService', () => {
    it('archives and redacts rows older than retention period', async () => {
        const rows = [makeRow('r1', 100), makeRow('r2', 95)];
        const { supabase, upload, inFn } = makeSupabase({ rows });
        const svc = new AuditLogCompactionService(supabase, { retentionDays: 90, now: fixedNow });

        const result = await svc.compact();

        expect(upload).toHaveBeenCalledOnce();
        // Uploaded NDJSON contains both rows
        const [, body] = upload.mock.calls[0] as [string, string];
        expect(body).toContain('r1');
        expect(body).toContain('r2');

        expect(inFn).toHaveBeenCalledWith('id', ['r1', 'r2']);
        expect(result).toEqual({ archived: 2, redacted: 2, errors: 0 });
    });

    it('returns zeros when no rows are due', async () => {
        const { supabase } = makeSupabase({ rows: [] });
        const svc = new AuditLogCompactionService(supabase, { now: fixedNow });

        const result = await svc.compact();
        expect(result).toEqual({ archived: 0, redacted: 0, errors: 0 });
    });

    it('returns errors when archive upload fails', async () => {
        const rows = [makeRow('r1', 100)];
        const { supabase } = makeSupabase({ rows, uploadError: { message: 'bucket full' } });
        const svc = new AuditLogCompactionService(supabase, { now: fixedNow });

        const result = await svc.compact();
        expect(result.errors).toBeGreaterThan(0);
        expect(result.redacted).toBe(0);
    });

    it('returns errors when fetch fails', async () => {
        const { supabase } = makeSupabase({ fetchError: { message: 'db error' } });
        const svc = new AuditLogCompactionService(supabase, { now: fixedNow });

        const result = await svc.compact();
        expect(result).toEqual({ archived: 0, redacted: 0, errors: 0 });
    });

    it('is idempotent: rows already redacted are not re-processed', async () => {
        // The DB query filters pii_redacted=false; if already redacted, no rows come back
        const { supabase, upload } = makeSupabase({ rows: [] });
        const svc = new AuditLogCompactionService(supabase, { now: fixedNow });

        await svc.compact();
        await svc.compact(); // second run

        expect(upload).not.toHaveBeenCalled();
    });

    it('restores archived events from cold storage', async () => {
        const rows = [makeRow('r1', 100)];
        const { supabase } = makeSupabase({ rows });
        const svc = new AuditLogCompactionService(supabase, { now: fixedNow });

        const restored = await svc.restore('2024-02-21');
        expect(restored).toHaveLength(1);
        expect((restored[0] as any).id).toBe('r1');
    });

    it('zeroes out PII fields (email, ip_address) in the update payload', async () => {
        const rows = [makeRow('r1', 100)];
        const updateIn = vi.fn().mockReturnValue({ error: null });
        const update = vi.fn().mockReturnValue({ in: updateIn });
        const eqFn = vi.fn().mockReturnThis();
        const ltFn = vi.fn().mockReturnThis();
        const limitFn = vi.fn().mockResolvedValue({ data: rows, error: null });
        const select = vi.fn().mockReturnValue({ lt: ltFn, eq: eqFn, limit: limitFn });
        ltFn.mockReturnValue({ eq: eqFn });
        eqFn.mockReturnValue({ limit: limitFn });
        const upload = vi.fn().mockResolvedValue({ error: null });
        const storage = { from: vi.fn().mockReturnValue({ upload }) };
        const from = vi.fn().mockReturnValue({ select, update });
        const supabase = { from, storage } as any;

        const svc = new AuditLogCompactionService(supabase, { now: fixedNow });
        await svc.compact();

        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({ email: null, ip_address: null, pii_redacted: true }),
        );
    });

    it('warns and skips re-archiving rows that failed redaction recently', async () => {
        const rows = [makeRow('r1', 100), makeRow('r2', 99)];
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const failedPayload = JSON.stringify({ ids: ['r1', 'r2'], timestamp: Date.now() - 60_000 });
        const failedDownload = vi.fn().mockResolvedValue({
            data: { text: async () => failedPayload },
            error: null,
        });

        const upload = vi.fn().mockResolvedValue({ error: null });
        const list = vi.fn().mockResolvedValue({ data: [{ name: 'batch.ndjson' }], error: null });
        const storage = { from: vi.fn().mockReturnValue({ upload, list, download: failedDownload }) };

        const update = vi.fn().mockReturnValue({ error: null });
        const inFn = vi.fn().mockReturnValue({ error: null });
        const eqFn = vi.fn().mockReturnThis();
        const ltFn = vi.fn().mockReturnThis();
        const limitFn = vi.fn().mockResolvedValue({ data: rows, error: null });
        const select = vi.fn().mockReturnValue({ lt: ltFn, eq: eqFn, limit: limitFn });
        ltFn.mockReturnValue({ eq: eqFn });
        eqFn.mockReturnValue({ limit: limitFn });
        const from = vi.fn().mockReturnValue({ select, update: vi.fn().mockReturnValue({ in: inFn }) });

        const supabase = { from, storage } as any;
        const svc = new AuditLogCompactionService(supabase, { now: fixedNow });
        const result = await svc.compact();

        expect(result.errors).toBe(2);
        expect(result.archived).toBe(0);
        expect(result.redacted).toBe(0);
        expect(consoleWarn).toHaveBeenCalled();
        expect(upload).not.toHaveBeenCalled();

        consoleWarn.mockRestore();
        consoleError.mockRestore();
    });

    it('re-archives rows after the failed-redaction window expires', async () => {
        const rows = [makeRow('r1', 100)];
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const failedPayload = JSON.stringify({ ids: ['r1'], timestamp: Date.now() - 25 * 60 * 60 * 1000 });
        const failedDownload = vi.fn().mockResolvedValue({
            data: { text: async () => failedPayload },
            error: null,
        });

        const upload = vi.fn().mockResolvedValue({ error: null });
        const list = vi.fn().mockResolvedValue({ data: [{ name: 'batch.ndjson' }], error: null });
        const storage = { from: vi.fn().mockReturnValue({ upload, list, download: failedDownload }) };

        const update = vi.fn().mockReturnValue({ error: null });
        const inFn = vi.fn().mockReturnValue({ error: null });
        const eqFn = vi.fn().mockReturnThis();
        const ltFn = vi.fn().mockReturnThis();
        const limitFn = vi.fn().mockResolvedValue({ data: rows, error: null });
        const select = vi.fn().mockReturnValue({ lt: ltFn, eq: eqFn, limit: limitFn });
        ltFn.mockReturnValue({ eq: eqFn });
        eqFn.mockReturnValue({ limit: limitFn });
        const from = vi.fn().mockReturnValue({ select, update: vi.fn().mockReturnValue({ in: inFn }) });

        const supabase = { from, storage } as any;
        const svc = new AuditLogCompactionService(supabase, { now: fixedNow });
        const result = await svc.compact();

        expect(result.archived).toBe(1);
        expect(result.redacted).toBe(1);
        expect(upload).toHaveBeenCalledOnce();

        consoleWarn.mockRestore();
    });
});
