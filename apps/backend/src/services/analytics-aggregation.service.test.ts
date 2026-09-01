import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsAggregationService, analyticsAggregationService } from './analytics-aggregation.service';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: mockFrom,
    }),
}));

describe('AnalyticsAggregationService', () => {
    let service: AnalyticsAggregationService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AnalyticsAggregationService();
    });

    describe('aggregate() - Happy Paths', () => {
        it('aggregates 1h raw analytics rows into buckets and advances cursor', async () => {
            const cursorSelectChain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { last_run_at: '2024-01-15T10:00:00.000Z' },
                    error: null,
                }),
            };

            const rowsSelectChain = {
                select: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: [
                        {
                            deployment_id: 'dep-1',
                            metric_type: 'page_views',
                            metric_value: 10,
                            recorded_at: '2024-01-15T10:15:00.000Z',
                        },
                        {
                            deployment_id: 'dep-1',
                            metric_type: 'page_views',
                            metric_value: 15,
                            recorded_at: '2024-01-15T10:45:00.000Z',
                        },
                        {
                            deployment_id: 'dep-1',
                            metric_type: 'uptime_check',
                            metric_value: 1,
                            recorded_at: '2024-01-15T10:20:00.000Z',
                        },
                        {
                            deployment_id: 'dep-1',
                            metric_type: 'uptime_check',
                            metric_value: 0,
                            recorded_at: '2024-01-15T10:50:00.000Z',
                        },
                        {
                            deployment_id: 'dep-2',
                            metric_type: 'page_views',
                            metric_value: 5,
                            recorded_at: '2024-01-15T10:30:00.000Z',
                        },
                    ],
                    error: null,
                }),
            };

            const upsertChain = {
                upsert: vi.fn().mockResolvedValue({ error: null }),
            };

            const updateCursorChain = {
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            };

            mockFrom.mockImplementation((table: string) => {
                if (table === 'rollup_cursors') {
                    return {
                        ...cursorSelectChain,
                        ...updateCursorChain,
                    };
                }
                if (table === 'deployment_analytics') {
                    return rowsSelectChain;
                }
                if (table === 'analytics_rollups') {
                    return upsertChain;
                }
                throw new Error(`Unexpected table: ${table}`);
            });

            const result = await service.aggregate('1h');

            expect(result).toEqual({ bucketsWritten: 3 });

            // Verify rollup_cursors query
            expect(mockFrom).toHaveBeenCalledWith('rollup_cursors');
            expect(cursorSelectChain.select).toHaveBeenCalledWith('last_run_at');
            expect(cursorSelectChain.eq).toHaveBeenCalledWith('granularity', '1h');

            // Verify deployment_analytics query
            expect(mockFrom).toHaveBeenCalledWith('deployment_analytics');
            expect(rowsSelectChain.select).toHaveBeenCalledWith(
                'deployment_id, metric_type, metric_value, recorded_at'
            );
            expect(rowsSelectChain.gte).toHaveBeenCalledWith(
                'recorded_at',
                '2024-01-15T10:00:00.000Z'
            );

            // Verify analytics_rollups upsert payload
            expect(mockFrom).toHaveBeenCalledWith('analytics_rollups');
            expect(upsertChain.upsert).toHaveBeenCalledTimes(1);
            const [upsertRows, upsertOptions] = upsertChain.upsert.mock.calls[0];

            expect(upsertOptions).toEqual({
                onConflict: 'deployment_id,metric_type,granularity,bucket_start',
            });

            expect(upsertRows).toHaveLength(3);

            const dep1PageView = upsertRows.find(
                (r: any) => r.deployment_id === 'dep-1' && r.metric_type === 'page_views'
            );
            expect(dep1PageView).toBeDefined();
            expect(dep1PageView.total_value).toBe(25);
            expect(dep1PageView.record_count).toBe(2);
            expect(dep1PageView.up_count).toBe(0);
            expect(dep1PageView.granularity).toBe('1h');
            expect(dep1PageView.bucket_start).toBe('2024-01-15T10:00:00.000Z');

            const dep1Uptime = upsertRows.find(
                (r: any) => r.deployment_id === 'dep-1' && r.metric_type === 'uptime_check'
            );
            expect(dep1Uptime).toBeDefined();
            expect(dep1Uptime.total_value).toBe(1);
            expect(dep1Uptime.record_count).toBe(2);
            expect(dep1Uptime.up_count).toBe(1);

            const dep2PageView = upsertRows.find(
                (r: any) => r.deployment_id === 'dep-2' && r.metric_type === 'page_views'
            );
            expect(dep2PageView).toBeDefined();
            expect(dep2PageView.total_value).toBe(5);
            expect(dep2PageView.record_count).toBe(1);

            // Verify cursor updated
            expect(updateCursorChain.update).toHaveBeenCalledWith(
                expect.objectContaining({ last_run_at: expect.any(String) })
            );
            expect(updateCursorChain.eq).toHaveBeenCalledWith('granularity', '1h');
        });

        it('aggregates 24h granularity correctly over full day buckets', async () => {
            const cursorSelectChain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { last_run_at: '2024-01-15T00:00:00.000Z' },
                    error: null,
                }),
            };

            const rowsSelectChain = {
                select: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: [
                        {
                            deployment_id: 'dep-1',
                            metric_type: 'requests',
                            metric_value: 100,
                            recorded_at: '2024-01-15T02:00:00.000Z',
                        },
                        {
                            deployment_id: 'dep-1',
                            metric_type: 'requests',
                            metric_value: 200,
                            recorded_at: '2024-01-15T22:30:00.000Z',
                        },
                    ],
                    error: null,
                }),
            };

            const upsertChain = {
                upsert: vi.fn().mockResolvedValue({ error: null }),
            };

            const updateCursorChain = {
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            };

            mockFrom.mockImplementation((table: string) => {
                if (table === 'rollup_cursors') {
                    return { ...cursorSelectChain, ...updateCursorChain };
                }
                if (table === 'deployment_analytics') return rowsSelectChain;
                if (table === 'analytics_rollups') return upsertChain;
                throw new Error(`Unexpected table: ${table}`);
            });

            const result = await service.aggregate('24h');

            expect(result).toEqual({ bucketsWritten: 1 });
            const [upsertRows] = upsertChain.upsert.mock.calls[0];
            expect(upsertRows[0].granularity).toBe('24h');
            expect(upsertRows[0].bucket_start).toBe('2024-01-15T00:00:00.000Z');
            expect(upsertRows[0].total_value).toBe(300);
            expect(upsertRows[0].record_count).toBe(2);
        });
    });

    describe('Bucket Boundary Edge Cases', () => {
        it('correctly categorizes timestamps exactly on, before, and after bucket boundaries', async () => {
            const cursorSelectChain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { last_run_at: '2024-01-15T00:00:00.000Z' },
                    error: null,
                }),
            };

            const rowsSelectChain = {
                select: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: [
                        // 1 millisecond before 01:00 -> belongs to 00:00 bucket
                        {
                            deployment_id: 'dep-boundary',
                            metric_type: 'event',
                            metric_value: 1,
                            recorded_at: '2024-01-15T00:59:59.999Z',
                        },
                        // Exactly on 01:00:00.000 -> belongs to 01:00 bucket
                        {
                            deployment_id: 'dep-boundary',
                            metric_type: 'event',
                            metric_value: 2,
                            recorded_at: '2024-01-15T01:00:00.000Z',
                        },
                        // 1 millisecond after 01:00 -> belongs to 01:00 bucket
                        {
                            deployment_id: 'dep-boundary',
                            metric_type: 'event',
                            metric_value: 4,
                            recorded_at: '2024-01-15T01:00:00.001Z',
                        },
                    ],
                    error: null,
                }),
            };

            const upsertChain = {
                upsert: vi.fn().mockResolvedValue({ error: null }),
            };

            const updateCursorChain = {
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            };

            mockFrom.mockImplementation((table: string) => {
                if (table === 'rollup_cursors') {
                    return { ...cursorSelectChain, ...updateCursorChain };
                }
                if (table === 'deployment_analytics') return rowsSelectChain;
                if (table === 'analytics_rollups') return upsertChain;
                throw new Error(`Unexpected table: ${table}`);
            });

            const result = await service.aggregate('1h');

            expect(result).toEqual({ bucketsWritten: 2 });
            const [upsertRows] = upsertChain.upsert.mock.calls[0];

            const bucket0 = upsertRows.find((r: any) => r.bucket_start === '2024-01-15T00:00:00.000Z');
            const bucket1 = upsertRows.find((r: any) => r.bucket_start === '2024-01-15T01:00:00.000Z');

            expect(bucket0).toBeDefined();
            expect(bucket0.total_value).toBe(1);
            expect(bucket0.record_count).toBe(1);

            expect(bucket1).toBeDefined();
            expect(bucket1.total_value).toBe(6);
            expect(bucket1.record_count).toBe(2);
        });
    });

    describe('Empty Input Handling', () => {
        it('returns bucketsWritten: 0 and does not upsert or advance cursor when no rows exist', async () => {
            const cursorSelectChain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { last_run_at: '2024-01-15T00:00:00.000Z' },
                    error: null,
                }),
            };

            const rowsSelectChain = {
                select: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: [],
                    error: null,
                }),
            };

            const upsertChain = {
                upsert: vi.fn().mockResolvedValue({ error: null }),
            };

            const updateCursorChain = {
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({ error: null }),
            };

            mockFrom.mockImplementation((table: string) => {
                if (table === 'rollup_cursors') {
                    return { ...cursorSelectChain, ...updateCursorChain };
                }
                if (table === 'deployment_analytics') return rowsSelectChain;
                if (table === 'analytics_rollups') return upsertChain;
                throw new Error(`Unexpected table: ${table}`);
            });

            const result = await service.aggregate('1h');

            expect(result).toEqual({ bucketsWritten: 0 });
            expect(upsertChain.upsert).not.toHaveBeenCalled();
            expect(updateCursorChain.update).not.toHaveBeenCalled();
        });

        it('returns bucketsWritten: 0 when rows is null', async () => {
            const cursorSelectChain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { last_run_at: '2024-01-15T00:00:00.000Z' },
                    error: null,
                }),
            };

            const rowsSelectChain = {
                select: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                }),
            };

            const upsertChain = {
                upsert: vi.fn().mockResolvedValue({ error: null }),
            };

            mockFrom.mockImplementation((table: string) => {
                if (table === 'rollup_cursors') return cursorSelectChain;
                if (table === 'deployment_analytics') return rowsSelectChain;
                if (table === 'analytics_rollups') return upsertChain;
                throw new Error(`Unexpected table: ${table}`);
            });

            const result = await service.aggregate('1h');
            expect(result).toEqual({ bucketsWritten: 0 });
            expect(upsertChain.upsert).not.toHaveBeenCalled();
        });
    });

    describe('Error Propagation', () => {
        it('throws error when reading rollup cursor fails', async () => {
            mockFrom.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'relation rollup_cursors does not exist' },
                }),
            });

            await expect(service.aggregate('1h')).rejects.toThrow(
                'Failed to read rollup cursor: relation rollup_cursors does not exist'
            );
        });

        it('throws error when fetching deployment analytics rows fails', async () => {
            const cursorSelectChain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { last_run_at: '2024-01-15T00:00:00.000Z' },
                    error: null,
                }),
            };

            const rowsSelectChain = {
                select: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'connection timeout' },
                }),
            };

            mockFrom.mockImplementation((table: string) => {
                if (table === 'rollup_cursors') return cursorSelectChain;
                if (table === 'deployment_analytics') return rowsSelectChain;
                throw new Error(`Unexpected table: ${table}`);
            });

            await expect(service.aggregate('1h')).rejects.toThrow(
                'Failed to fetch analytics rows: connection timeout'
            );
        });

        it('throws error when upserting rollups fails', async () => {
            const cursorSelectChain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { last_run_at: '2024-01-15T00:00:00.000Z' },
                    error: null,
                }),
            };

            const rowsSelectChain = {
                select: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: [
                        {
                            deployment_id: 'dep-1',
                            metric_type: 'p95',
                            metric_value: 42,
                            recorded_at: '2024-01-15T00:10:00.000Z',
                        },
                    ],
                    error: null,
                }),
            };

            const upsertChain = {
                upsert: vi.fn().mockResolvedValue({
                    error: { message: 'unique constraint violation' },
                }),
            };

            mockFrom.mockImplementation((table: string) => {
                if (table === 'rollup_cursors') return cursorSelectChain;
                if (table === 'deployment_analytics') return rowsSelectChain;
                if (table === 'analytics_rollups') return upsertChain;
                throw new Error(`Unexpected table: ${table}`);
            });

            await expect(service.aggregate('1h')).rejects.toThrow(
                'Failed to upsert rollups: unique constraint violation'
            );
        });

        it('throws error when advancing rollup cursor fails', async () => {
            const cursorSelectChain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { last_run_at: '2024-01-15T00:00:00.000Z' },
                    error: null,
                }),
            };

            const rowsSelectChain = {
                select: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: [
                        {
                            deployment_id: 'dep-1',
                            metric_type: 'p95',
                            metric_value: 42,
                            recorded_at: '2024-01-15T00:10:00.000Z',
                        },
                    ],
                    error: null,
                }),
            };

            const upsertChain = {
                upsert: vi.fn().mockResolvedValue({ error: null }),
            };

            const updateCursorChain = {
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockResolvedValue({
                    error: { message: 'database locked' },
                }),
            };

            mockFrom.mockImplementation((table: string) => {
                if (table === 'rollup_cursors') {
                    return { ...cursorSelectChain, ...updateCursorChain };
                }
                if (table === 'deployment_analytics') return rowsSelectChain;
                if (table === 'analytics_rollups') return upsertChain;
                throw new Error(`Unexpected table: ${table}`);
            });

            await expect(service.aggregate('1h')).rejects.toThrow(
                'Failed to advance rollup cursor: database locked'
            );
        });
    });

    describe('Singleton export', () => {
        it('exports a singleton instance of AnalyticsAggregationService', () => {
            expect(analyticsAggregationService).toBeInstanceOf(AnalyticsAggregationService);
        });
    });
});
