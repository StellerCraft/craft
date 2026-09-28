import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
    }),
}));

vi.mock('@/services/github-to-vercel-deployment.service', () => ({
    githubToVercelDeploymentService: {
        getRecentDeployments: vi.fn(),
    },
}));

const fakeUser = { id: 'user-123', email: 'test@example.com' };

function makeGetRequest(query: string = '') {
    return new NextRequest(`http://localhost/api/deployments/github${query}`, { method: 'GET' });
}

describe('GET /api/deployments/github', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 400 if repoFullName is missing', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest(), {});
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('repoFullName');
    });

    it('returns 400 if limit is not a number', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=abc'), {});
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('limit');
    });

    it('returns 400 if limit is NaN', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=NaN'), {});
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('limit');
    });

    it('returns 400 if limit is negative', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=-5'), {});
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('limit');
    });

    it('returns 400 if limit is zero', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=0'), {});
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('limit');
    });

    it('returns 400 if limit exceeds maximum (100)', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=101'), {});
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('limit');
        expect(body.error).toContain('100');
    });

    it('returns 400 if limit is not finite (Infinity)', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=Infinity'), {});
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('limit');
    });

    it('accepts default limit when not provided', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo'), {});
        expect(res.status).toBe(200);

        expect(vi.mocked(githubToVercelDeploymentService.getRecentDeployments)).toHaveBeenCalledWith('owner/repo', 10);
    });

    it('accepts valid limit at minimum (1)', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=1'), {});
        expect(res.status).toBe(200);

        expect(vi.mocked(githubToVercelDeploymentService.getRecentDeployments)).toHaveBeenCalledWith('owner/repo', 1);
    });

    it('accepts valid limit at maximum (100)', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=100'), {});
        expect(res.status).toBe(200);

        expect(vi.mocked(githubToVercelDeploymentService.getRecentDeployments)).toHaveBeenCalledWith('owner/repo', 100);
    });

    it('accepts valid limit in middle range', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue([]);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=50'), {});
        expect(res.status).toBe(200);

        expect(vi.mocked(githubToVercelDeploymentService.getRecentDeployments)).toHaveBeenCalledWith('owner/repo', 50);
    });

    it('returns 200 with deployments for valid request', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        const mockDeployments = [
            {
                id: 'dep-1',
                repoFullName: 'owner/repo',
                repoName: 'repo',
                branch: 'main',
                commitSha: 'abc123',
                commitMessage: 'Initial commit',
                pusherName: 'John Doe',
                vercelDeploymentId: 'vercel-1',
                vercelDeploymentUrl: 'https://example.vercel.app',
                status: 'READY',
                createdAt: new Date('2026-09-24'),
                updatedAt: new Date('2026-09-24'),
            },
        ];
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockResolvedValue(mockDeployments);

        const res = await GET(makeGetRequest('?repoFullName=owner/repo&limit=10'), {});
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.deployments).toHaveLength(1);
        expect(body.deployments[0].id).toBe('dep-1');
        expect(body.deployments[0].repoFullName).toBe('owner/repo');
    });

    it('handles service errors with 500 status', async () => {
        const { GET } = await import('./route');
        const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
        vi.mocked(githubToVercelDeploymentService.getRecentDeployments).mockRejectedValue(new Error('Database error'));

        const res = await GET(makeGetRequest('?repoFullName=owner/repo'), {});
        expect(res.status).toBe(500);

        const body = await res.json();
        expect(body.error).toContain('Database error');
    });
});
