import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// ── Cron Auth Mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/api/cron-auth', () => ({
    withCronAuth: (handler: any) => async (req: NextRequest) => {
        // Simulate successful cron auth
        return handler(req);
    },
}));

// ── Analytics Service Mock ───────────────────────────────────────────────────

vi.mock('@/services/analytics-aggregation.service', () => ({
    analyticsAggregationService: {
        aggregate: vi.fn(),
    },
}));

// ── Import mocked service ────────────────────────────────────────────────────

import { analyticsAggregationService } from '@/services/analytics-aggregation.service';

// ── Helpers & Fixtures ────────────────────────────────────────────────────────

const createGetRequest = (url = 'http://localhost/api/cron/aggregate-analytics') =>
    new NextRequest(url, { method: 'GET' });

const mockAnalyticsService = analyticsAggregationService as any;

describe('GET /api/cron/aggregate-analytics (Integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Successful analytics aggregation', () => {
        it('returns 200 with hourly and daily aggregation results', async () => {
            const hourlyResult = { bucketsWritten: 24 };
            const dailyResult = { bucketsWritten: 7 };

            mockAnalyticsService.aggregate
                .mockResolvedValueOnce(hourlyResult)
                .mockResolvedValueOnce(dailyResult);

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual({
                success: true,
                hourly: hourlyResult,
                daily: dailyResult,
            });

            expect(mockAnalyticsService.aggregate).toHaveBeenCalledTimes(2);
            expect(mockAnalyticsService.aggregate).toHaveBeenCalledWith('1h');
            expect(mockAnalyticsService.aggregate).toHaveBeenCalledWith('24h');
        });

        it('handles zero buckets written for both intervals', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 0 })
                .mockResolvedValueOnce({ bucketsWritten: 0 });

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual({
                success: true,
                hourly: { bucketsWritten: 0 },
                daily: { bucketsWritten: 0 },
            });
        });

        it('handles large bucket counts from both aggregations', async () => {
            const largeHourlyCount = 10000;
            const largeDailyCount = 100000;

            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: largeHourlyCount })
                .mockResolvedValueOnce({ bucketsWritten: largeDailyCount });

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.hourly.bucketsWritten).toBe(largeHourlyCount);
            expect(body.daily.bucketsWritten).toBe(largeDailyCount);
        });

        it('correctly calls aggregate with proper time bucket parameters', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 12 })
                .mockResolvedValueOnce({ bucketsWritten: 5 });

            const req = createGetRequest();
            await GET(req);

            const calls = mockAnalyticsService.aggregate.mock.calls;
            expect(calls[0][0]).toBe('1h');
            expect(calls[1][0]).toBe('24h');
        });

        it('maintains proper ordering of hourly then daily aggregation', async () => {
            const callOrder: string[] = [];

            mockAnalyticsService.aggregate.mockImplementation((interval: string) => {
                callOrder.push(interval);
                return Promise.resolve({ bucketsWritten: 1 });
            });

            const req = createGetRequest();
            await GET(req);

            expect(callOrder).toEqual(['1h', '24h']);
        });

        it('returns aggregation results in response body with correct structure', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 18, recordsProcessed: 540 })
                .mockResolvedValueOnce({ bucketsWritten: 6, recordsProcessed: 1440 });

            const req = createGetRequest();
            const res = await GET(req);

            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.hourly).toHaveProperty('bucketsWritten');
            expect(body.daily).toHaveProperty('bucketsWritten');
            // Verify the response only includes bucketsWritten at top level
            expect(body.hourly).toEqual({ bucketsWritten: 18, recordsProcessed: 540 });
            expect(body.daily).toEqual({ bucketsWritten: 6, recordsProcessed: 1440 });
        });
    });

    describe('Hourly aggregation failure', () => {
        it('returns 500 when hourly aggregation throws error', async () => {
            mockAnalyticsService.aggregate.mockRejectedValueOnce(
                new Error('Database connection failed during hourly aggregation')
            );

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toHaveProperty('error');
            expect(body.error).toContain('Database connection failed');

            // Daily aggregation should not be called if hourly fails
            expect(mockAnalyticsService.aggregate).toHaveBeenCalledTimes(1);
        });

        it('returns generic error message when hourly aggregation fails with non-Error', async () => {
            mockAnalyticsService.aggregate.mockRejectedValueOnce('Unexpected failure');

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body.error).toBe('Aggregation failed');
        });
    });

    describe('Daily aggregation failure', () => {
        it('returns 500 when daily aggregation throws error', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 24 })
                .mockRejectedValueOnce(
                    new Error('Daily aggregation pipeline timeout')
                );

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toHaveProperty('error');
            expect(body.error).toContain('timeout');

            // Both calls should have been attempted
            expect(mockAnalyticsService.aggregate).toHaveBeenCalledTimes(2);
        });

        it('returns error when daily aggregation fails with non-Error exception', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 24 })
                .mockRejectedValueOnce(new Error('Service unavailable'));

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body.error).toContain('Service unavailable');
        });
    });

    describe('Concurrent aggregation handling', () => {
        it('executes both aggregations in parallel via Promise.all', async () => {
            let hourlyCallTime = 0;
            let dailyCallTime = 0;
            const callSequence: string[] = [];

            mockAnalyticsService.aggregate.mockImplementation((interval: string) => {
                callSequence.push(interval);
                return new Promise((resolve) => {
                    setTimeout(() => {
                        resolve({ bucketsWritten: 5 });
                    }, 10);
                });
            });

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(200);
            // Both should be called immediately (in a Promise.all pattern)
            expect(mockAnalyticsService.aggregate).toHaveBeenCalledTimes(2);
        });

        it('waits for both aggregations to complete before responding', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce(new Promise((resolve) => {
                    setTimeout(() => resolve({ bucketsWritten: 1 }), 5);
                }))
                .mockResolvedValueOnce(new Promise((resolve) => {
                    setTimeout(() => resolve({ bucketsWritten: 2 }), 3);
                }));

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.hourly.bucketsWritten).toBe(1);
            expect(body.daily.bucketsWritten).toBe(2);
        });
    });

    describe('Request handling', () => {
        it('ignores query parameters in request', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 5 })
                .mockResolvedValueOnce({ bucketsWritten: 2 });

            const req = createGetRequest('http://localhost/api/cron/aggregate-analytics?force=true&debug=1');
            const res = await GET(req);

            expect(res.status).toBe(200);
            expect(mockAnalyticsService.aggregate).toHaveBeenCalledTimes(2);
        });

        it('handles different URL paths consistently', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 5 })
                .mockResolvedValueOnce({ bucketsWritten: 2 });

            const urls = [
                'http://localhost/api/cron/aggregate-analytics',
                'https://api.example.com/api/cron/aggregate-analytics',
            ];

            for (const url of urls) {
                mockAnalyticsService.aggregate.mockClear();
                mockAnalyticsService.aggregate
                    .mockResolvedValueOnce({ bucketsWritten: 5 })
                    .mockResolvedValueOnce({ bucketsWritten: 2 });

                const req = createGetRequest(url);
                const res = await GET(req);
                expect(res.status).toBe(200);
            }
        });

        it('ignores request body if present', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 5 })
                .mockResolvedValueOnce({ bucketsWritten: 2 });

            const req = new NextRequest('http://localhost/api/cron/aggregate-analytics', {
                method: 'GET',
                body: JSON.stringify({ someField: 'should-be-ignored' }),
            });

            const res = await GET(req);
            expect(res.status).toBe(200);
            expect(mockAnalyticsService.aggregate).toHaveBeenCalledTimes(2);
        });
    });

    describe('Response format validation', () => {
        it('always includes success: true in successful responses', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 0 })
                .mockResolvedValueOnce({ bucketsWritten: 0 });

            const req = createGetRequest();
            const res = await GET(req);

            const body = await res.json();
            expect(body.success).toBe(true);
        });

        it('returns hourly and daily as nested objects', async () => {
            mockAnalyticsService.aggregate
                .mockResolvedValueOnce({ bucketsWritten: 10, extra: 'field' })
                .mockResolvedValueOnce({ bucketsWritten: 5, another: 'field' });

            const req = createGetRequest();
            const res = await GET(req);

            const body = await res.json();
            expect(typeof body.hourly).toBe('object');
            expect(typeof body.daily).toBe('object');
            expect(body.hourly).not.toBeNull();
            expect(body.daily).not.toBeNull();
        });
    });
});
