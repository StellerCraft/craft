import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// --- Supabase mock ---
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

function makeRequest(url = 'http://localhost/api/admin/analytics') {
    return new NextRequest(url);
}

const routeContext = { params: {} };

function createQueryChain(data: any = null, error: any = null) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data, error }),
    };
    return chain;
}

describe('GET /api/admin/analytics - Integration Tests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.ADMIN_USER_IDS;
    });

    afterEach(() => {
        delete process.env.ADMIN_USER_IDS;
    });

    describe('Authentication & Authorization', () => {
        it('returns 401 when unauthenticated', async () => {
            mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

            const req = makeRequest();
            const res = await GET(req, routeContext);

            expect(res.status).toBe(401);
            expect(await res.json()).toEqual({ error: 'Unauthorized' });
            expect(mockFrom).not.toHaveBeenCalled();
        });

        it('returns 401 when getUser encounters an auth error', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: new Error('Invalid token or session expired'),
            });

            const req = makeRequest();
            const res = await GET(req, routeContext);

            expect(res.status).toBe(401);
            expect(await res.json()).toEqual({ error: 'Unauthorized' });
            expect(mockFrom).not.toHaveBeenCalled();
        });

        it('returns 403 when authenticated user has a non-admin role', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'user-member-1',
                        user_metadata: { role: 'member' },
                    },
                },
                error: null,
            });

            const req = makeRequest();
            const res = await GET(req, routeContext);

            expect(res.status).toBe(403);
            expect(await res.json()).toEqual({ error: 'Forbidden: insufficient role' });
            expect(mockFrom).not.toHaveBeenCalled();
        });

        it('returns 403 when user has no role metadata and is not in ADMIN_USER_IDS', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'user-regular-2',
                        user_metadata: {},
                    },
                },
                error: null,
            });

            const req = makeRequest();
            const res = await GET(req, routeContext);

            expect(res.status).toBe(403);
            expect(await res.json()).toEqual({ error: 'Forbidden: insufficient role' });
            expect(mockFrom).not.toHaveBeenCalled();
        });
    });

    describe('Admin Authorized Analytics Retrieval', () => {
        it('returns aggregated analytics successfully for admin user via user_metadata.role', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'admin-user-1',
                        user_metadata: { role: 'admin' },
                    },
                },
                error: null,
            });

            const mockAnalyticsData = [
                {
                    metric_type: 'page_view',
                    metric_value: 10,
                    recorded_at: '2026-08-01T12:00:00.000Z',
                    deployment_id: 'dep-1',
                },
                {
                    metric_type: 'page_view',
                    metric_value: 15,
                    recorded_at: '2026-08-01T13:00:00.000Z',
                    deployment_id: 'dep-2',
                },
                {
                    metric_type: 'error_count',
                    metric_value: 2,
                    recorded_at: '2026-08-01T14:00:00.000Z',
                    deployment_id: 'dep-1',
                },
            ];

            const queryChain = createQueryChain(mockAnalyticsData, null);
            mockFrom.mockReturnValue(queryChain);

            const req = makeRequest();
            const res = await GET(req, routeContext);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({
                total: 3,
                aggregates: {
                    page_view: 25,
                    error_count: 2,
                },
                rows: mockAnalyticsData,
            });

            expect(mockFrom).toHaveBeenCalledWith('deployment_analytics');
            expect(queryChain.select).toHaveBeenCalledWith(
                'metric_type, metric_value, recorded_at, deployment_id'
            );
            expect(queryChain.order).toHaveBeenCalledWith('recorded_at', { ascending: false });
            expect(queryChain.limit).toHaveBeenCalledWith(1000);
        });

        it('returns aggregated analytics successfully for admin user via ADMIN_USER_IDS fallback', async () => {
            process.env.ADMIN_USER_IDS = 'admin-fallback-1, admin-fallback-2';
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'admin-fallback-1',
                        user_metadata: {},
                    },
                },
                error: null,
            });

            const mockAnalyticsData = [
                {
                    metric_type: 'request_count',
                    metric_value: 100,
                    recorded_at: '2026-08-01T12:00:00.000Z',
                    deployment_id: 'dep-1',
                },
            ];

            const queryChain = createQueryChain(mockAnalyticsData, null);
            mockFrom.mockReturnValue(queryChain);

            const req = makeRequest();
            const res = await GET(req, routeContext);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.total).toBe(1);
            expect(json.aggregates).toEqual({ request_count: 100 });
            expect(json.rows).toEqual(mockAnalyticsData);
        });

        it('handles query parameters: metricType, startDate, and endDate', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'admin-user-1',
                        user_metadata: { role: 'admin' },
                    },
                },
                error: null,
            });

            const queryChain = createQueryChain([], null);
            mockFrom.mockReturnValue(queryChain);

            const startDate = '2026-08-01T00:00:00.000Z';
            const endDate = '2026-08-15T23:59:59.999Z';
            const metricType = 'page_view';

            const req = makeRequest(
                `http://localhost/api/admin/analytics?metricType=${metricType}&startDate=${encodeURIComponent(
                    startDate
                )}&endDate=${encodeURIComponent(endDate)}`
            );
            const res = await GET(req, routeContext);

            expect(res.status).toBe(200);
            expect(queryChain.eq).toHaveBeenCalledWith('metric_type', metricType);
            expect(queryChain.gte).toHaveBeenCalledWith(
                'recorded_at',
                new Date(startDate).toISOString()
            );
            expect(queryChain.lte).toHaveBeenCalledWith(
                'recorded_at',
                new Date(endDate).toISOString()
            );
        });

        it('returns empty aggregates and zero total when no rows are found', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'admin-user-1',
                        user_metadata: { role: 'admin' },
                    },
                },
                error: null,
            });

            const queryChain = createQueryChain([], null);
            mockFrom.mockReturnValue(queryChain);

            const req = makeRequest();
            const res = await GET(req, routeContext);

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({
                total: 0,
                aggregates: {},
                rows: [],
            });
        });

        it('returns 500 when database query encounters an error', async () => {
            mockGetUser.mockResolvedValue({
                data: {
                    user: {
                        id: 'admin-user-1',
                        user_metadata: { role: 'admin' },
                    },
                },
                error: null,
            });

            const queryChain = createQueryChain(null, { message: 'Database connection failure' });
            mockFrom.mockReturnValue(queryChain);

            const req = makeRequest();
            const res = await GET(req, routeContext);

            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json).toEqual({
                error: 'Failed to fetch analytics',
                detail: 'Database connection failure',
            });
        });
    });
});
