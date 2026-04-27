/**
 * Deployment resource cleanup tests
 *
 * Verifies that all resources associated with a deployment are properly
 * cleaned up when a deployment is deleted:
 *   - GitHub repository
 *   - Vercel project
 *   - Database records (deployment + cascaded logs/analytics)
 *
 * Cleanup is best-effort: external service failures must not block DB deletion.
 * Cleanup must also be idempotent: re-running on an already-deleted deployment
 * should not cause errors.
 *
 * Issue: #110
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

// ---------------------------------------------------------------------------
// External service mocks
// ---------------------------------------------------------------------------

const mockDeleteRepository = vi.fn();
const mockDeleteProject = vi.fn();

vi.mock('@/services/github.service', () => ({
    githubService: { deleteRepository: mockDeleteRepository },
}));

vi.mock('@/services/vercel.service', () => ({
    vercelService: { deleteProject: mockDeleteProject },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const owner = { id: 'user-1', email: 'owner@example.com' };
const params = { id: 'dep-1' };

function makeRequest() {
    return new NextRequest('http://localhost/api/deployments/dep-1', { method: 'DELETE' });
}

const baseDeployment = {
    user_id: owner.id,
    repository_url: 'https://github.com/owner/my-repo',
    vercel_project_id: 'prj_abc123',
};

/** Builds a mock that returns the deployment on SELECT then succeeds on DELETE. */
function makeSuccessfulDeleteMock(deployment: typeof baseDeployment) {
    return {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: deployment, error: null }),
            })),
        })),
        delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
        })),
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deployment resource cleanup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: owner }, error: null });
        mockDeleteRepository.mockResolvedValue(undefined);
        mockDeleteProject.mockResolvedValue(undefined);
    });

    // -- GitHub repository cleanup ------------------------------------------

    describe('GitHub repository', () => {
        it('deletes the repository using owner and repo parsed from repository_url', async () => {
            mockFrom.mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment)).mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            await DELETE(makeRequest(), { params });

            expect(mockDeleteRepository).toHaveBeenCalledOnce();
            expect(mockDeleteRepository).toHaveBeenCalledWith('owner', 'my-repo');
        });

        it('skips GitHub cleanup when repository_url is null', async () => {
            const noRepo = { ...baseDeployment, repository_url: null };
            mockFrom.mockReturnValueOnce(makeSuccessfulDeleteMock(noRepo)).mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            await DELETE(makeRequest(), { params });

            expect(mockDeleteRepository).not.toHaveBeenCalled();
        });

        it('continues DB deletion when GitHub cleanup fails (best-effort)', async () => {
            mockDeleteRepository.mockRejectedValue(new Error('GitHub 403 Forbidden'));
            const mockDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
            mockFrom
                .mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment))
                .mockReturnValueOnce({ delete: mockDelete });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            expect(res.status).toBe(200);
            expect(mockDelete).toHaveBeenCalled();
        });

        it('handles already-deleted repository (404) without error', async () => {
            // deleteRepository resolves (not throws) on 404 — idempotent by design
            mockDeleteRepository.mockResolvedValue(undefined);
            mockFrom.mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment)).mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            expect(res.status).toBe(200);
        });
    });

    // -- Vercel project cleanup --------------------------------------------

    describe('Vercel project', () => {
        it('deletes the Vercel project using vercel_project_id', async () => {
            mockFrom.mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment)).mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            await DELETE(makeRequest(), { params });

            expect(mockDeleteProject).toHaveBeenCalledOnce();
            expect(mockDeleteProject).toHaveBeenCalledWith('prj_abc123');
        });

        it('skips Vercel cleanup when vercel_project_id is null', async () => {
            const noVercel = { ...baseDeployment, vercel_project_id: null };
            mockFrom.mockReturnValueOnce(makeSuccessfulDeleteMock(noVercel)).mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            await DELETE(makeRequest(), { params });

            expect(mockDeleteProject).not.toHaveBeenCalled();
        });

        it('continues DB deletion when Vercel cleanup fails (best-effort)', async () => {
            mockDeleteProject.mockRejectedValue(new Error('Vercel 404'));
            const mockDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
            mockFrom
                .mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment))
                .mockReturnValueOnce({ delete: mockDelete });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            expect(res.status).toBe(200);
            expect(mockDelete).toHaveBeenCalled();
        });
    });

    // -- Database record cleanup -------------------------------------------

    describe('database records', () => {
        it('deletes the deployment record after external cleanup', async () => {
            const mockDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
            mockFrom
                .mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment))
                .mockReturnValueOnce({ delete: mockDelete });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            expect(res.status).toBe(200);
            expect(mockDelete).toHaveBeenCalled();
        });

        it('returns 500 when DB deletion fails', async () => {
            mockFrom
                .mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment))
                .mockReturnValueOnce({
                    delete: vi.fn(() => ({
                        eq: vi.fn().mockResolvedValue({ error: { message: 'FK constraint violation' } }),
                    })),
                });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            expect(res.status).toBe(500);
            expect((await res.json()).error).toBe('Failed to delete deployment');
        });

        it('returns 404 when deployment record is already gone (idempotency)', async () => {
            mockFrom.mockReturnValue({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
                    })),
                })),
            });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            // Already deleted → treated as not found, no external calls made
            expect(res.status).toBe(404);
            expect(mockDeleteRepository).not.toHaveBeenCalled();
            expect(mockDeleteProject).not.toHaveBeenCalled();
        });
    });

    // -- Full cleanup (all resources) --------------------------------------

    describe('full resource cleanup', () => {
        it('cleans up all resources and returns success', async () => {
            mockFrom.mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment)).mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ success: true, deploymentId: 'dep-1' });
            expect(mockDeleteRepository).toHaveBeenCalledWith('owner', 'my-repo');
            expect(mockDeleteProject).toHaveBeenCalledWith('prj_abc123');
        });

        it('skips all external cleanup when no provider resources exist', async () => {
            const noProviders = { ...baseDeployment, repository_url: null, vercel_project_id: null };
            mockFrom.mockReturnValueOnce(makeSuccessfulDeleteMock(noProviders)).mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            expect(res.status).toBe(200);
            expect(mockDeleteRepository).not.toHaveBeenCalled();
            expect(mockDeleteProject).not.toHaveBeenCalled();
        });

        it('completes DB deletion even when both external cleanups fail', async () => {
            mockDeleteRepository.mockRejectedValue(new Error('GitHub timeout'));
            mockDeleteProject.mockRejectedValue(new Error('Vercel timeout'));
            const mockDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
            mockFrom
                .mockReturnValueOnce(makeSuccessfulDeleteMock(baseDeployment))
                .mockReturnValueOnce({ delete: mockDelete });
            const { DELETE } = await import('@/app/api/deployments/[id]/route');

            const res = await DELETE(makeRequest(), { params });

            expect(res.status).toBe(200);
            expect(mockDelete).toHaveBeenCalled();
        });
    });
});
