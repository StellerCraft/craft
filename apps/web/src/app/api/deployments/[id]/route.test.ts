/**
 * Tests for GET /api/deployments/[id] and DELETE /api/deployments/[id]
 *
 * GET covers:
 *   - Authenticated owner fetches deployment → 200 with full details
 *   - Unauthenticated → 401
 *   - Non-owner → 404 (existence leakage prevention)
 *   - Missing deployment → 404
 *   - Completed / failed / null-field variants
 *   - DB error → 404
 *
 * DELETE covers (#99 — deployment deletion flow):
 *   - Authenticated owner deletes → 200 { success, deploymentId }
 *   - Unauthenticated → 401
 *   - Non-owner → 404
 *   - Missing deployment → 404
 *   - GitHub cleanup called when repository_url present
 *   - Vercel cleanup called when vercel_project_id present
 *   - External cleanup errors are swallowed (best-effort)
 *   - DB delete error → 500
 *   - No external calls when provider IDs are null
 *
 * Issues: #99, #107, #110
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
// External service mocks (needed for DELETE)
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

const fakeUser = { id: 'user-1', email: 'user@example.com' };
const params = { id: 'dep-1' };

function makeGetRequest() {
    return new NextRequest('http://localhost/api/deployments/dep-1', { method: 'GET' });
}

function makeDeleteRequest() {
    return new NextRequest('http://localhost/api/deployments/dep-1', { method: 'DELETE' });
}

/**
 * Builds a Supabase `from()` mock that returns the given data for a single-row query.
 * The returned data always has `user_id` set to `userId` (spread last so it wins).
 * Pass `userId = null` to simulate a not-found / DB error response.
 */
function makeOwnershipQuery(userId: string | null, deploymentData: any = null) {
    return {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                    userId === null
                        ? { data: null, error: { message: 'not found' } }
                        // Spread deploymentData first, then override user_id so the
                        // caller-supplied userId always wins (fixes previous bug where
                        // deploymentData.user_id silently overwrote the parameter).
                        : { data: { ...deploymentData, user_id: userId }, error: null },
                ),
            })),
        })),
    };
}

/** Builds a mock that succeeds for the ownership SELECT then succeeds for DELETE. */
function makeDeleteQuery(userId: string | null, deploymentData: any = null) {
    let callCount = 0;
    return {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(
                    userId === null
                        ? { data: null, error: { message: 'not found' } }
                        : { data: { ...deploymentData, user_id: userId }, error: null },
                ),
            })),
        })),
        delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
        })),
    };
}

const baseDeployment = {
    id: 'dep-1',
    user_id: 'user-1',
    name: 'My Deployment',
    status: 'generating',
    template_id: 'template-1',
    vercel_project_id: 'vercel-proj-1',
    deployment_url: null,
    repository_url: 'https://github.com/user/repo',
    customization_config: { theme: 'dark' },
    error_message: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:01:00Z',
    deployed_at: null,
};

const completedDeployment = {
    ...baseDeployment,
    status: 'completed',
    deployment_url: 'https://my-app.vercel.app',
    updated_at: '2024-01-01T00:05:00Z',
    deployed_at: '2024-01-01T00:05:00Z',
};

const failedDeployment = {
    ...baseDeployment,
    status: 'failed',
    error_message: 'GitHub API rate limit exceeded',
    updated_at: '2024-01-01T00:02:00Z',
};

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe('GET /api/deployments/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 200 with deployment details for authenticated owner', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            id: 'dep-1',
            name: 'My Deployment',
            status: 'generating',
            templateId: 'template-1',
            vercelProjectId: 'vercel-proj-1',
            deploymentUrl: null,
            repositoryUrl: 'https://github.com/user/repo',
            customizationConfig: { theme: 'dark' },
            errorMessage: null,
        });
        expect(body.timestamps).toMatchObject({
            created: '2024-01-01T00:00:00Z',
            updated: '2024-01-01T00:01:00Z',
            deployed: null,
        });
    });

    it('returns 401 for unauthenticated request and leaks no data', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body).not.toHaveProperty('name');
        expect(body).not.toHaveProperty('status');
        expect(body).not.toHaveProperty('timestamps');
    });

    it('returns 404 (not 403) for authenticated non-owner and leaks no data', async () => {
        // deploymentData has user_id 'user-1' but we pass 'other-user' as the
        // ownership query result — the helper now correctly returns other-user.
        mockFrom.mockReturnValue(makeOwnershipQuery('other-user', baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('Deployment not found');
        expect(body).not.toHaveProperty('name');
        expect(body).not.toHaveProperty('status');
        expect(body).not.toHaveProperty('timestamps');
    });

    it('returns 404 when deployment does not exist', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(null));
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('Deployment not found');
    });

    it('returns completed deployment with deployment URL', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, completedDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            status: 'completed',
            deploymentUrl: 'https://my-app.vercel.app',
        });
        expect(body.timestamps.deployed).toBe('2024-01-01T00:05:00Z');
    });

    it('returns failed deployment with error message', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, failedDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
            status: 'failed',
            errorMessage: 'GitHub API rate limit exceeded',
        });
    });

    it('returns null for optional fields when not set', async () => {
        const deploymentWithNulls = {
            ...baseDeployment,
            vercel_project_id: null,
            deployment_url: null,
            repository_url: null,
            customization_config: null,
            error_message: null,
            deployed_at: null,
        };
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, deploymentWithNulls));
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.vercelProjectId).toBeNull();
        expect(body.deploymentUrl).toBeNull();
        expect(body.repositoryUrl).toBeNull();
        expect(body.customizationConfig).toBeNull();
        expect(body.errorMessage).toBeNull();
        expect(body.timestamps.deployed).toBeNull();
    });

    it('returns 404 on database error', async () => {
        mockFrom.mockReturnValue({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
                })),
            })),
        });
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('Deployment not found');
    });

    it('returns all required fields for deployment detail UI', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id, baseDeployment));
        const { GET } = await import('./route');

        const res = await GET(makeGetRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('id');
        expect(body).toHaveProperty('name');
        expect(body).toHaveProperty('status');
        expect(body).toHaveProperty('templateId');
        expect(body).toHaveProperty('vercelProjectId');
        expect(body).toHaveProperty('deploymentUrl');
        expect(body).toHaveProperty('repositoryUrl');
        expect(body).toHaveProperty('customizationConfig');
        expect(body).toHaveProperty('errorMessage');
        expect(body.timestamps).toHaveProperty('created');
        expect(body.timestamps).toHaveProperty('updated');
        expect(body.timestamps).toHaveProperty('deployed');
    });
});

// ---------------------------------------------------------------------------
// DELETE tests — Issue #99: deployment deletion flow
// ---------------------------------------------------------------------------

describe('DELETE /api/deployments/[id]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
        mockDeleteRepository.mockResolvedValue(undefined);
        mockDeleteProject.mockResolvedValue(undefined);
    });

    // 1. Happy path — owner deletes a deployment with both GitHub and Vercel resources
    it('returns 200 with success and deploymentId for authenticated owner', async () => {
        mockFrom
            .mockReturnValueOnce(makeOwnershipQuery(fakeUser.id, baseDeployment))
            .mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
        const { DELETE } = await import('./route');

        const res = await DELETE(makeDeleteRequest(), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toEqual({ success: true, deploymentId: 'dep-1' });
    });

    // 2. Unauthenticated → 401
    it('returns 401 for unauthenticated request', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { DELETE } = await import('./route');

        const res = await DELETE(makeDeleteRequest(), { params });

        expect(res.status).toBe(401);
    });

    // 3. Non-owner → 404 (existence leakage prevention)
    it('returns 404 for authenticated non-owner', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery('other-user', baseDeployment));
        const { DELETE } = await import('./route');

        const res = await DELETE(makeDeleteRequest(), { params });

        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('Deployment not found');
    });

    // 4. Deployment not found → 404
    it('returns 404 when deployment does not exist', async () => {
        mockFrom.mockReturnValue(makeOwnershipQuery(null));
        const { DELETE } = await import('./route');

        const res = await DELETE(makeDeleteRequest(), { params });

        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('Deployment not found');
    });

    // 5. GitHub repository is deleted when repository_url is present
    it('calls deleteRepository with owner and repo extracted from repository_url', async () => {
        mockFrom
            .mockReturnValueOnce(makeOwnershipQuery(fakeUser.id, baseDeployment))
            .mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
        const { DELETE } = await import('./route');

        await DELETE(makeDeleteRequest(), { params });

        expect(mockDeleteRepository).toHaveBeenCalledWith('user', 'repo');
    });

    // 6. Vercel project is deleted when vercel_project_id is present
    it('calls deleteProject with vercel_project_id', async () => {
        mockFrom
            .mockReturnValueOnce(makeOwnershipQuery(fakeUser.id, baseDeployment))
            .mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
        const { DELETE } = await import('./route');

        await DELETE(makeDeleteRequest(), { params });

        expect(mockDeleteProject).toHaveBeenCalledWith('vercel-proj-1');
    });

    // 7. GitHub cleanup failure is swallowed — DB deletion still proceeds
    it('proceeds with DB deletion even when GitHub cleanup throws', async () => {
        mockDeleteRepository.mockRejectedValue(new Error('GitHub 404'));
        const mockDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
        mockFrom
            .mockReturnValueOnce(makeOwnershipQuery(fakeUser.id, baseDeployment))
            .mockReturnValueOnce({ delete: mockDelete });
        const { DELETE } = await import('./route');

        const res = await DELETE(makeDeleteRequest(), { params });

        expect(res.status).toBe(200);
        expect(mockDelete).toHaveBeenCalled();
    });

    // 8. Vercel cleanup failure is swallowed — DB deletion still proceeds
    it('proceeds with DB deletion even when Vercel cleanup throws', async () => {
        mockDeleteProject.mockRejectedValue(new Error('Vercel 404'));
        const mockDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
        mockFrom
            .mockReturnValueOnce(makeOwnershipQuery(fakeUser.id, baseDeployment))
            .mockReturnValueOnce({ delete: mockDelete });
        const { DELETE } = await import('./route');

        const res = await DELETE(makeDeleteRequest(), { params });

        expect(res.status).toBe(200);
        expect(mockDelete).toHaveBeenCalled();
    });

    // 9. DB delete error → 500
    it('returns 500 when database deletion fails', async () => {
        mockFrom
            .mockReturnValueOnce(makeOwnershipQuery(fakeUser.id, baseDeployment))
            .mockReturnValueOnce({
                delete: vi.fn(() => ({
                    eq: vi.fn().mockResolvedValue({ error: { message: 'FK constraint' } }),
                })),
            });
        const { DELETE } = await import('./route');

        const res = await DELETE(makeDeleteRequest(), { params });

        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('Failed to delete deployment');
    });

    // 10. No external calls when both provider IDs are null
    it('skips GitHub and Vercel cleanup when provider IDs are null', async () => {
        const noProviders = {
            ...baseDeployment,
            repository_url: null,
            vercel_project_id: null,
        };
        mockFrom
            .mockReturnValueOnce(makeOwnershipQuery(fakeUser.id, noProviders))
            .mockReturnValueOnce({
                delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
            });
        const { DELETE } = await import('./route');

        const res = await DELETE(makeDeleteRequest(), { params });

        expect(res.status).toBe(200);
        expect(mockDeleteRepository).not.toHaveBeenCalled();
        expect(mockDeleteProject).not.toHaveBeenCalled();
    });
});
