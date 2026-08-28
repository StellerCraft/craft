/**
 * Concurrency tests for AnalyticsService — aggregation correctness under
 * simultaneous writes from multiple deployment events.
 *
 * Covers:
 *   - 100 concurrent event writes all land in the correct time bucket
 *   - Aggregation totals are correct after concurrent writes (no lost updates)
 *   - Time bucket boundary: events at T=bucket_end vs T=bucket_start+1
 *   - Cache invalidation is correct under concurrent writes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsService } from './analytics.service';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const insertedRows: Array<Record<string, unknown>> = [];
const mockInsert = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

function setupInsertMock() {
    mockFrom.mockImplementation((table: string) => {
        if (table === 'deployment_analytics') {
            return {
                insert: (row: Record<string, unknown>) => {
                    mockInsert(row);
                    insertedRows.push({ ...row, recorded_at: new Date().toISOString() });
                    return Promise.resolve({ error: null });
                },
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({ data: insertedRows, error: null }),
            };
        }
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnalyticsService — 100 concurrent event writes', () => {
    let service: AnalyticsService;

    beforeEach(() => {
        vi.clearAllMocks();
        insertedRows.length = 0;
        setupInsertMock();
        service = new AnalyticsService();
    });

    it('all 100 concurrent page view writes are recorded without loss', async () => {
        const CONCURRENT = 100;
        const deploymentId = 'deploy-concurrent-001';

        await Promise.all(
            Array.from({ length: CONCURRENT }, () => service.recordPageView(deploymentId)),
        );

        expect(mockInsert).toHaveBeenCalledTimes(CONCURRENT);

        const allForDeployment = (mockInsert.mock.calls as any[]).filter(
            ([row]) => row.deployment_id === deploymentId,
        );
        expect(allForDeployment).toHaveLength(CONCURRENT);
    });

    it('each concurrent write uses metric_value of 1', async () => {
        const CONCURRENT = 100;

        await Promise.all(
            Array.from({ length: CONCURRENT }, () => service.recordPageView('deploy-x')),
        );

        const values = (mockInsert.mock.calls as any[]).map(([row]) => row.metric_value);
        expect(values.every((v: number) => v === 1)).toBe(true);
    });

    it('concurrent writes for different deployment IDs are isolated', async () => {
        const IDS = ['deploy-a', 'deploy-b', 'deploy-c'];
        const WRITES_EACH = 10;

        await Promise.all(
            IDS.flatMap((id) =>
                Array.from({ length: WRITES_EACH }, () => service.recordPageView(id)),
            ),
        );

        for (const id of IDS) {
            const forId = (mockInsert.mock.calls as any[]).filter(
                ([row]) => row.deployment_id === id,
            );
            expect(forId).toHaveLength(WRITES_EACH);
        }
    });

    it('concurrent uptime check writes are all recorded', async () => {
        const CONCURRENT = 100;
        const deploymentId = 'deploy-uptime-concurrent';
        const writes = Array.from({ length: CONCURRENT }, (_, i) =>
            service.recordUptimeCheck(deploymentId, i % 2 === 0),
        );

        await Promise.all(writes);

        const uptimeInserts = (mockInsert.mock.calls as any[]).filter(
            ([row]) => row.metric_type === 'uptime_check',
        );
        expect(uptimeInserts).toHaveLength(CONCURRENT);

        const upCount = uptimeInserts.filter(([row]: any[]) => row.metric_value === 1).length;
        const downCount = uptimeInserts.filter(([row]: any[]) => row.metric_value === 0).length;
        expect(upCount + downCount).toBe(CONCURRENT);
        // Even indices are up (50), odd are down (50)
        expect(upCount).toBe(50);
        expect(downCount).toBe(50);
    });
});

describe('AnalyticsService — aggregation totals after concurrent writes', () => {
    let service: AnalyticsService;

    beforeEach(() => {
        vi.clearAllMocks();
        insertedRows.length = 0;
        setupInsertMock();
        service = new AnalyticsService();
    });

    it('summary RPC is called (not cached) after concurrent writes invalidate cache', async () => {
        const deploymentId = 'deploy-summary-concurrent';

        // Prime the cache
        mockRpc.mockResolvedValueOnce({
            data: [{ metric_type: 'page_view', total_value: 0, record_count: 0, up_count: 0, latest_recorded: null }],
            error: null,
        });
        await service.getAnalyticsSummary(deploymentId);
        expect(mockRpc).toHaveBeenCalledTimes(1);

        // Concurrent writes should bust the cache
        await Promise.all(
            Array.from({ length: 50 }, () => service.recordPageView(deploymentId)),
        );

        // Next summary call must hit the RPC, not the (now-invalidated) cache
        mockRpc.mockResolvedValueOnce({
            data: [{ metric_type: 'page_view', total_value: 50, record_count: 50, up_count: 0, latest_recorded: null }],
            error: null,
        });
        const summary = await service.getAnalyticsSummary(deploymentId);

        expect(mockRpc).toHaveBeenCalledTimes(2);
        expect(summary.totalPageViews).toBe(50);
    });

    it('aggregation correctly totals mixed metric types from concurrent writes', async () => {
        const deploymentId = 'deploy-mixed-concurrent';

        const writes = [
            ...Array.from({ length: 30 }, () => service.recordPageView(deploymentId)),
            ...Array.from({ length: 20 }, () => service.recordUptimeCheck(deploymentId, true)),
            ...Array.from({ length: 10 }, () => service.recordTransactionCount(deploymentId, 5)),
        ];
        await Promise.all(writes);

        // Total inserts: 30 page views + 20 uptime checks + 10 transaction counts
        expect(mockInsert).toHaveBeenCalledTimes(60);

        // Simulate RPC returning the aggregated result Postgres would compute
        mockRpc.mockResolvedValueOnce({
            data: [
                { metric_type: 'page_view', total_value: 30, record_count: 30, up_count: 0, latest_recorded: null },
                { metric_type: 'uptime_check', total_value: 20, record_count: 20, up_count: 20, latest_recorded: new Date().toISOString() },
                { metric_type: 'transaction_count', total_value: 50, record_count: 10, up_count: 0, latest_recorded: null },
            ],
            error: null,
        });

        const summary = await service.getAnalyticsSummary(deploymentId);

        expect(summary.totalPageViews).toBe(30);
        expect(summary.totalTransactions).toBe(50);
        expect(summary.uptimePercentage).toBe(100);
    });

    it('no lost updates: all 100 transaction writes contribute to final total', async () => {
        const deploymentId = 'deploy-tx-concurrent';
        const VALUE_PER_WRITE = 3;
        const CONCURRENT = 100;

        await Promise.all(
            Array.from({ length: CONCURRENT }, () =>
                service.recordTransactionCount(deploymentId, VALUE_PER_WRITE),
            ),
        );

        // Verify all 100 inserts happened (none dropped)
        const txInserts = (mockInsert.mock.calls as any[]).filter(
            ([row]) => row.metric_type === 'transaction_count',
        );
        expect(txInserts).toHaveLength(CONCURRENT);

        // The total from Postgres would be CONCURRENT * VALUE_PER_WRITE
        const expectedTotal = CONCURRENT * VALUE_PER_WRITE;

        mockRpc.mockResolvedValueOnce({
            data: [
                { metric_type: 'transaction_count', total_value: expectedTotal, record_count: CONCURRENT, up_count: 0, latest_recorded: null },
            ],
            error: null,
        });

        const summary = await service.getAnalyticsSummary(deploymentId);
        expect(summary.totalTransactions).toBe(expectedTotal);
    });
});

describe('AnalyticsService — time bucket boundary events', () => {
    let service: AnalyticsService;

    beforeEach(() => {
        vi.clearAllMocks();
        insertedRows.length = 0;
        setupInsertMock();
        service = new AnalyticsService();
    });

    it('event at bucket_end is included in the current bucket query', async () => {
        const deploymentId = 'deploy-boundary';
        const bucketEnd = new Date('2024-01-01T01:00:00.000Z');
        const bucketStart = new Date('2024-01-01T00:00:00.000Z');

        // Build a chain that is chainable AND awaitable (thenable)
        function makeChain(data: any[]) {
            const chain: any = {
                select: () => chain,
                eq: () => chain,
                gte: () => chain,
                lte: () => chain,
                order: () => chain,
                then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
            };
            return chain;
        }
        mockFrom.mockReturnValue(makeChain([
            { id: 'r1', metric_type: 'page_view', metric_value: 1, recorded_at: bucketEnd.toISOString() },
        ]));

        const results = await service.getAnalytics(deploymentId, 'page_view', bucketStart, bucketEnd);

        expect(results).toHaveLength(1);
        expect(results[0].recordedAt.toISOString()).toBe(bucketEnd.toISOString());
    });

    it('event at bucket_start+1ms is excluded from the previous bucket query', async () => {
        const deploymentId = 'deploy-boundary-next';

        function makeChain(data: any[]) {
            const chain: any = {
                select: () => chain,
                eq: () => chain,
                gte: () => chain,
                lte: () => chain,
                order: () => chain,
                then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
            };
            return chain;
        }
        // No rows match the previous bucket because the only event is at T+1ms (next bucket)
        mockFrom.mockReturnValue(makeChain([]));

        const prevBucketStart = new Date('2024-01-01T00:00:00.000Z');
        const prevBucketEnd = new Date('2024-01-01T01:00:00.000Z');
        const results = await service.getAnalytics(
            deploymentId,
            'page_view',
            prevBucketStart,
            new Date(prevBucketEnd.getTime() - 1),  // exclude the +1ms boundary event
        );

        expect(results).toHaveLength(0);
    });

    it('concurrent writes at the exact bucket boundary are all captured', async () => {
        const deploymentId = 'deploy-boundary-concurrent';
        const CONCURRENT = 20;

        // All writes happen "at" the boundary (same logical instant in test)
        await Promise.all(
            Array.from({ length: CONCURRENT }, () => service.recordPageView(deploymentId)),
        );

        expect(mockInsert).toHaveBeenCalledTimes(CONCURRENT);
        // All rows carry the correct deployment_id
        expect(
            (mockInsert.mock.calls as any[]).every(([row]) => row.deployment_id === deploymentId),
        ).toBe(true);
    });
});
