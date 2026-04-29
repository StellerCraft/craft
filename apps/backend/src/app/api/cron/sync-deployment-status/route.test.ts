import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'test-cron-secret';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => mockSupabase,
}));

vi.mock('@/services/github-to-vercel-deployment.service', () => ({
    githubToVercelDeploymentService: {
        syncDeploymentStatus: vi.fn(),
    },
}));

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
});

describe('GET /api/cron/sync-deployment-status', () => {
    it('returns 401 for invalid cron secret', async () => {
        const request = new NextRequest('http://localhost:4001/api/cron/sync-deployment-status', {
            method: 'GET',
            headers: {
                authorization: 'Bearer wrong-secret',
            },
        });

        const response = await GET(request);
        expect(response.status).toBe(401);
    });

    it('returns 200 with synced: 0 when no stale deployments found', async () => {
        mockSupabase.from.mockReturnThis();
        mockSupabase.select.mockReturnThis();
        mockSupabase.eq.mockReturnThis();
        mockSupabase.lt.mockResolvedValue({ data: [], error: null });

        const request = new NextRequest('http://localhost:4001/api/cron/sync-deployment-status', {
            method: 'GET',
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
            },
        });

        const response = await GET(request);
        expect(response.status).toBe(200);
        
        const data = await response.json();
        expect(data).toEqual({ synced: 0, failed: 0 });
    });

    it('syncs stale deployments and returns counts', async () => {
        const staleDeployments = [
            { vercel_deployment_id: 'v1' },
            { vercel_deployment_id: 'v2' },
            { vercel_deployment_id: 'v3' },
        ];

        mockSupabase.lt.mockResolvedValue({ data: staleDeployments, error: null });

        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.syncDeploymentStatus)
            .mockResolvedValueOnce({ id: 'd1' } as any) // success
            .mockResolvedValueOnce(null) // failure
            .mockResolvedValueOnce({ id: 'd3' } as any); // success

        const request = new NextRequest('http://localhost:4001/api/cron/sync-deployment-status', {
            method: 'GET',
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
            },
        });

        const response = await GET(request);
        expect(response.status).toBe(200);
        
        const data = await response.json();
        expect(data).toEqual({ synced: 2, failed: 1 });
        
        expect(githubToVercelDeploymentService.syncDeploymentStatus).toHaveBeenCalledTimes(3);
    });

    it('handles database fetch error', async () => {
        mockSupabase.lt.mockResolvedValue({ data: null, error: { message: 'DB Error' } });

        const request = new NextRequest('http://localhost:4001/api/cron/sync-deployment-status', {
            method: 'GET',
            headers: {
                authorization: `Bearer ${CRON_SECRET}`,
            },
        });

        const response = await GET(request);
        expect(response.status).toBe(500);
    });
});
