import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsAggregationService } from '@/services/analytics-aggregation.service';

// ── Supabase mock ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function buildSupabaseMock(opts: {
    cursor: string;
    rows: Row[];
    upsertError?: string;
    updateError?: string;
}) {
    const upserted: Row[][] = [];
    const updated: Row[][] = [];

    const mock = {
        from: (table: string) => {
            if (table === 'rollup_cursors') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => ({
                                data: { last_run_at: opts.cursor },
                                error: null,
                            }),
                        }),
                    }),
                    update: (data: Row) => ({
                        eq: () => {
                            updated.push([data]);
                            return { error: opts.updateError ? { message: opts.updateError } : null };
                        },
                    }),
                };
            }

            if (table === 'deployment_analytics') {
                return {
                    select: () => ({
                        gte: () => ({
                            lt: () => ({
                                order: async () => ({
                                    data: opts.rows,
                                    error: null,
                                }),
                            }),
                        }),
                    }),
                };
            }

            if (table === 'analytics_rollups') {
                return {
                    upsert: (rows: Row[]) => {
                        upserted.push(rows);
                        return { error: opts.upsertError ? { message: opts.upsertError } : null };
                    },
                };
            }

            throw new Error(`Unexpected table: ${table}`);
        },
        _upserted: upserted,
        _updated: updated,
    };

    return mock;
}

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

import * as serverModule from '@/lib/supabase/server';

describe('AnalyticsAggregationService', () => {
    const svc = new AnalyticsAggregationService();
    const createClientMock = vi.mocked(serverModule.createClient);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 0 bucketsWritten when no new rows since cursor', async () => {
        const db = buildSupabaseMock({ cursor: new Date().toISOString(), rows: [] });
        createClientMock.mockReturnValue(db as any);

        const result = await svc.aggregate('1h');
        expect(result.bucketsWritten).toBe(0);
    });

    it('correctly groups rows into hourly buckets', async () => {
        const t0 = new Date('2024-01-01T10:00:00Z');
        const t1 = new Date('2024-01-01T10:30:00Z'); // same hour bucket
        const t2 = new Date('2024-01-01T11:15:00Z'); // next hour bucket

        const rows = [
            { deployment_id: 'dep-1', metric_type: 'page_view', metric_value: 1, recorded_at: t0.toISOString() },
            { deployment_id: 'dep-1', metric_type: 'page_view', metric_value: 1, recorded_at: t1.toISOString() },
            { deployment_id: 'dep-1', metric_type: 'page_view', metric_value: 1, recorded_at: t2.toISOString() },
        ];

        const db = buildSupabaseMock({ cursor: '1970-01-01T00:00:00Z', rows });
        createClientMock.mockReturnValue(db as any);

        const result = await svc.aggregate('1h');
        expect(result.bucketsWritten).toBe(2); // two distinct hourly buckets

        const upserted = db._upserted[0];
        const bucket10 = upserted.find((r) => (r.bucket_start as string).includes('T10:'));
        const bucket11 = upserted.find((r) => (r.bucket_start as string).includes('T11:'));

        expect(bucket10?.record_count).toBe(2);
        expect(bucket11?.record_count).toBe(1);
    });

    it('counts up_count for uptime_check metric', async () => {
        const rows = [
            { deployment_id: 'dep-2', metric_type: 'uptime_check', metric_value: 1, recorded_at: '2024-01-01T10:00:00Z' },
            { deployment_id: 'dep-2', metric_type: 'uptime_check', metric_value: 0, recorded_at: '2024-01-01T10:10:00Z' },
            { deployment_id: 'dep-2', metric_type: 'uptime_check', metric_value: 1, recorded_at: '2024-01-01T10:20:00Z' },
        ];

        const db = buildSupabaseMock({ cursor: '1970-01-01T00:00:00Z', rows });
        createClientMock.mockReturnValue(db as any);

        await svc.aggregate('1h');

        const upserted = db._upserted[0];
        expect(upserted[0].up_count).toBe(2);
        expect(upserted[0].record_count).toBe(3);
    });

    it('is idempotent — running twice with the same rows produces the same upsert payload', async () => {
        const rows = [
            { deployment_id: 'dep-3', metric_type: 'page_view', metric_value: 5, recorded_at: '2024-01-01T08:00:00Z' },
        ];

        const db1 = buildSupabaseMock({ cursor: '1970-01-01T00:00:00Z', rows });
        createClientMock.mockReturnValue(db1 as any);
        await svc.aggregate('24h');

        const db2 = buildSupabaseMock({ cursor: '1970-01-01T00:00:00Z', rows });
        createClientMock.mockReturnValue(db2 as any);
        await svc.aggregate('24h');

        // Both runs produce identical upsert payloads (same bucket keys)
        const keys1 = db1._upserted[0].map((r) => `${r.deployment_id}|${r.metric_type}|${r.bucket_start}`);
        const keys2 = db2._upserted[0].map((r) => `${r.deployment_id}|${r.metric_type}|${r.bucket_start}`);
        expect(keys1).toEqual(keys2);
    });

    it('assigns rows to correct 24h bucket boundaries', async () => {
        const rows = [
            { deployment_id: 'dep-4', metric_type: 'page_view', metric_value: 1, recorded_at: '2024-01-01T23:59:00Z' },
            { deployment_id: 'dep-4', metric_type: 'page_view', metric_value: 1, recorded_at: '2024-01-02T00:01:00Z' },
        ];

        const db = buildSupabaseMock({ cursor: '1970-01-01T00:00:00Z', rows });
        createClientMock.mockReturnValue(db as any);

        const result = await svc.aggregate('24h');
        expect(result.bucketsWritten).toBe(2); // two different day buckets
    });
});
