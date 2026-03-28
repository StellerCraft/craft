import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks — mirror the pattern from deployments/[id]/repository/route.test.ts
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetLogs = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

vi.mock('@/services/deployment-logs.service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/deployment-logs.service')>();
    return {
        ...actual,
        deploymentLogsService: { getLogs: mockGetLogs },
    };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeUser = { id: 'user-1', email: 'user@example.com' };
const params = { id: 'dep-1' };

function makeRequest(search = '') {
    return new NextRequest(`http://localhost/api/deployments/dep-1/logs${search}`);
}

function makeOwnershipQuery(userId: string | null) {
    return {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                    userId === null
                        ? { data: null, error: { message: 'not found' } }
                        : { data: { user_id: userId }, error: null },
                ),
            })),
        })),
    };
}

const fakeLogs = [
    { id: 'log-1', deploymentId: 'dep-1', timestamp: '2024-01-01T00:00:00Z', level: 'info', message: 'started' },
    { id: 'log-2', deploymentId: 'dep-1', timestamp: '2024-01-01T00:01:00Z', level: 'warn', message: 'slow' },
];

const fakePagination = { page: 1, limit: 50, total: 2, hasNextPage: false };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/deployments/[id]/logs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    // 1. Authenticated owner fetches logs → 200 with paginated log array
    it('returns 200 with paginated log array for authenticated owner', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id));
        mockGetLogs.mockResolvedValue({ data: fakeLogs, pagination: fakePagination });
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data).toHaveLength(2);
        expect(body.data[0]).toMatchObject({ id: 'log-1', deploymentId: 'dep-1', level: 'info' });
        expect(body.pagination).toMatchObject({ page: 1, limit: 50, total: 2, hasNextPage: false });
    });

    // 2. Unauthenticated request → 401, no deployment data leaked
    it('returns 401 for unauthenticated request and leaks no data', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body).not.toHaveProperty('data');
        expect(body).not.toHaveProperty('pagination');
        expect(mockGetLogs).not.toHaveBeenCalled();
    });

    // 3. Authenticated but non-owner → 404 (not 403), no log data
    it('returns 404 (not 403) for authenticated non-owner and leaks no data', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery('other-user'));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('Deployment not found');
        expect(body).not.toHaveProperty('data');
        expect(mockGetLogs).not.toHaveBeenCalled();
    });

    // 4. Valid owner, deployment not found → 404
    it('returns 404 when deployment does not exist', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(null));
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('Deployment not found');
        expect(mockGetLogs).not.toHaveBeenCalled();
    });

    // 5. Valid request, no logs exist → 200 with data: []
    it('returns 200 with empty data array when deployment has no logs', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id));
        mockGetLogs.mockResolvedValue({ data: [], pagination: { page: 1, limit: 50, total: 0, hasNextPage: false } });
        const { GET } = await import('./route');

        const res = await GET(makeRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.data).toEqual([]);
        expect(body.pagination.total).toBe(0);
    });

    // 6. limit exceeds 200 → 200 capped at 200 results
    it('caps limit at 200 server-side', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id));
        mockGetLogs.mockResolvedValue({ data: fakeLogs, pagination: { page: 1, limit: 200, total: 2, hasNextPage: false } });
        const { GET } = await import('./route');

        const res = await GET(makeRequest('?limit=999'), { params });

        expect(res.status).toBe(200);
        // Verify getLogs was called with limit capped at 200
        expect(mockGetLogs).toHaveBeenCalledWith(
            'dep-1',
            expect.objectContaining({ limit: 200 }),
            expect.anything(),
        );
    });

    // 7. order=desc returns logs newest-first → 200 in correct order
    it('passes order=desc to the service', async () => {
        const descLogs = [
            { id: 'log-2', deploymentId: 'dep-1', timestamp: '2024-01-01T00:01:00Z', level: 'warn', message: 'slow' },
            { id: 'log-1', deploymentId: 'dep-1', timestamp: '2024-01-01T00:00:00Z', level: 'info', message: 'started' },
        ];
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id));
        mockGetLogs.mockResolvedValue({ data: descLogs, pagination: fakePagination });
        const { GET } = await import('./route');

        const res = await GET(makeRequest('?order=desc'), { params });

        expect(res.status).toBe(200);
        expect(mockGetLogs).toHaveBeenCalledWith(
            'dep-1',
            expect.objectContaining({ order: 'desc' }),
            expect.anything(),
        );
        const body = await res.json();
        expect(body.data[0].id).toBe('log-2');
    });

    // 8. since filter excludes older logs → 200 with filtered results
    it('passes since filter to the service', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id));
        mockGetLogs.mockResolvedValue({ data: [fakeLogs[1]], pagination: { page: 1, limit: 50, total: 1, hasNextPage: false } });
        const { GET } = await import('./route');

        const since = '2024-01-01T00:00:30Z';
        const res = await GET(makeRequest(`?since=${since}`), { params });

        expect(res.status).toBe(200);
        expect(mockGetLogs).toHaveBeenCalledWith(
            'dep-1',
            expect.objectContaining({ since }),
            expect.anything(),
        );
        const body = await res.json();
        expect(body.data).toHaveLength(1);
    });

    // 9. level=error returns only error logs → 200 with filtered results
    it('passes level filter to the service', async () => {
        const errorLog = { id: 'log-3', deploymentId: 'dep-1', timestamp: '2024-01-01T00:02:00Z', level: 'error', message: 'failed' };
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id));
        mockGetLogs.mockResolvedValue({ data: [errorLog], pagination: { page: 1, limit: 50, total: 1, hasNextPage: false } });
        const { GET } = await import('./route');

        const res = await GET(makeRequest('?level=error'), { params });

        expect(res.status).toBe(200);
        expect(mockGetLogs).toHaveBeenCalledWith(
            'dep-1',
            expect.objectContaining({ level: 'error' }),
            expect.anything(),
        );
        const body = await res.json();
        expect(body.data[0].level).toBe('error');
    });

    // 10. Invalid order param value → 400
    it('returns 400 for invalid order param value', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id));
        const { GET } = await import('./route');

        const res = await GET(makeRequest('?order=random'), { params });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Invalid query parameters');
        expect(mockGetLogs).not.toHaveBeenCalled();
    });
});
