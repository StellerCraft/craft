/**
 * GitHub-to-Vercel Deployment Trigger Service Tests
 *
 * Tests the service that triggers Vercel deployments from GitHub webhooks.
 *
 * Functionality tested:
 *   - Triggering Vercel deployments
 *   - Storing deployment metadata in Supabase
 *   - Syncing deployment status from Vercel API
 *   - Querying deployment metadata
 *
 * Edge cases tested:
 *   - Missing environment variables
 *   - Vercel API failures
 *   - Database failures
 *   - Invalid deployment IDs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubToVercelDeploymentService } from './github-to-vercel-deployment.service';
import type { TriggerDeploymentRequest } from './github-to-vercel-deployment.service';
import { VercelApiError } from './vercel.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockVercelService = {
    triggerDeployment: vi.fn(),
    getDeploymentStatus: vi.fn(),
};

const mockSupabase = {
    from: vi.fn(),
};

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => mockSupabase,
}));

vi.mock('@/lib/api/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
}));

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_PROJECT_ID = 'test-project-id';
});

describe('GitHubToVercelDeploymentService', () => {
    let service: GitHubToVercelDeploymentService;

    beforeEach(() => {
        service = new GitHubToVercelDeploymentService(mockVercelService as any);
    });

    describe('triggerDeployment', () => {
        const request: TriggerDeploymentRequest = {
            repoFullName: 'owner/repo',
            repoName: 'repo',
            branch: 'main',
            commitSha: 'abc123def456',
            commitMessage: 'Test commit',
            pusherName: 'testuser',
        };

        it('triggers Vercel deployment successfully', async () => {
            mockVercelService.triggerDeployment.mockResolvedValue({
                deploymentId: 'dpl_abc123',
                deploymentUrl: 'https://test.vercel.app',
                status: 'QUEUED',
            });

            mockSupabase.from.mockReturnValue({
                insert: vi.fn().mockReturnValue({
                    error: null,
                }),
            });

            const result = await service.triggerDeployment(request);

            expect(result.success).toBe(true);
            expect(result.deploymentId).toBeDefined();
            expect(result.deploymentUrl).toBe('https://test.vercel.app');
            expect(result.status).toBe('QUEUED');
            expect(mockVercelService.triggerDeployment).toHaveBeenCalledWith(
                'test-project-id',
                'owner/repo'
            );
        });

        it('returns error when VERCEL_PROJECT_ID is missing', async () => {
            delete process.env.VERCEL_PROJECT_ID;

            const result = await service.triggerDeployment(request);

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBe('VERCEL_PROJECT_ID is not configured');
            expect(mockVercelService.triggerDeployment).not.toHaveBeenCalled();
        });

        it('returns error when Vercel API fails', async () => {
            mockVercelService.triggerDeployment.mockRejectedValue(
                new Error('Vercel API error')
            );

            const result = await service.triggerDeployment(request);

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBe('Vercel API error');
        });

        it('stores deployment metadata in Supabase', async () => {
            mockVercelService.triggerDeployment.mockResolvedValue({
                deploymentId: 'dpl_abc123',
                deploymentUrl: 'https://test.vercel.app',
                status: 'QUEUED',
            });

            const insertMock = vi.fn().mockReturnValue({ error: null });
            mockSupabase.from.mockReturnValue({ insert: insertMock });

            await service.triggerDeployment(request);

            expect(mockSupabase.from).toHaveBeenCalledWith('github_vercel_deployments');
            expect(insertMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    repo_full_name: 'owner/repo',
                    repo_name: 'repo',
                    branch: 'main',
                    commit_sha: 'abc123def456',
                    commit_message: 'Test commit',
                    pusher_name: 'testuser',
                    vercel_deployment_id: 'dpl_abc123',
                    vercel_deployment_url: 'https://test.vercel.app',
                    status: 'queued',
                })
            );
        });

        it('handles database insert failure gracefully', async () => {
            mockVercelService.triggerDeployment.mockResolvedValue({
                deploymentId: 'dpl_abc123',
                deploymentUrl: 'https://test.vercel.app',
                status: 'QUEUED',
            });

            mockSupabase.from.mockReturnValue({
                insert: vi.fn().mockReturnValue({
                    error: new Error('Database error'),
                }),
            });

            const result = await service.triggerDeployment(request);

            // Should still succeed even if database insert fails
            expect(result.success).toBe(true);
            expect(result.deploymentUrl).toBe('https://test.vercel.app');
        });

        it('maps Vercel status correctly', async () => {
            const statusMap = {
                'QUEUED': 'queued',
                'BUILDING': 'building',
                'READY': 'ready',
                'ERROR': 'error',
                'FAILED': 'failed',
                'CANCELED': 'canceled',
            };

            for (const [vercelStatus, expectedStatus] of Object.entries(statusMap)) {
                mockVercelService.triggerDeployment.mockResolvedValue({
                    deploymentId: 'dpl_abc123',
                    deploymentUrl: 'https://test.vercel.app',
                    status: vercelStatus,
                });

                mockSupabase.from.mockReturnValue({
                    insert: vi.fn().mockReturnValue({ error: null }),
                });

                await service.triggerDeployment(request);

                const insertCall = mockSupabase.from().insert;
                expect(insertCall).toHaveBeenCalledWith(
                    expect.objectContaining({
                        status: expectedStatus,
                    })
                );
            }
        });
    });

    describe('syncDeploymentStatus', () => {
        it('syncs deployment status from Vercel API', async () => {
            mockVercelService.getDeploymentStatus.mockResolvedValue({
                status: 'ready',
                url: 'https://test.vercel.app',
                deploymentId: 'dpl_abc123',
                createdAt: new Date(),
                readyAt: new Date(),
            });

            mockSupabase.from.mockReturnValue({
                update: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                        select: vi.fn().mockReturnValue({
                            single: vi.fn().mockResolvedValue({
                                data: {
                                    id: 'meta-123',
                                    repo_full_name: 'owner/repo',
                                    repo_name: 'repo',
                                    branch: 'main',
                                    commit_sha: 'abc123',
                                    commit_message: 'Test',
                                    pusher_name: 'user',
                                    vercel_deployment_id: 'dpl_abc123',
                                    vercel_deployment_url: 'https://test.vercel.app',
                                    status: 'ready',
                                    created_at: '2024-01-01T00:00:00Z',
                                    updated_at: '2024-01-01T00:00:00Z',
                                },
                                error: null,
                            }),
                        }),
                    }),
                }),
            });

            const result = await service.syncDeploymentStatus('dpl_abc123');

            expect(result).not.toBeNull();
            expect(result?.status).toBe('ready');
            expect(mockVercelService.getDeploymentStatus).toHaveBeenCalledWith('dpl_abc123');
        });

        it('returns null when deployment not found (general error)', async () => {
            mockVercelService.getDeploymentStatus.mockRejectedValue(
                new Error('Some error')
            );

            const result = await service.syncDeploymentStatus('dpl_invalid');

            expect(result).toBeNull();
        });

        it('marks deployment as failed when Vercel returns NOT_FOUND', async () => {
            const notFoundError = new VercelApiError('Deployment not found', 'NOT_FOUND');
            
            mockVercelService.getDeploymentStatus.mockRejectedValue(notFoundError);

            const singleMock = vi.fn().mockResolvedValue({
                data: {
                    id: 'meta-123',
                    status: 'failed',
                    repo_full_name: 'owner/repo',
                    repo_name: 'repo',
                    branch: 'main',
                    commit_sha: 'abc123',
                    vercel_deployment_id: 'dpl_abc123',
                },
                error: null,
            });

            const selectMock = vi.fn().mockReturnValue({ single: singleMock });
            const eqMock = vi.fn().mockReturnValue({ select: selectMock });
            const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
            
            mockSupabase.from.mockImplementation((table: string) => {
                if (table === 'github_vercel_deployments') {
                    return { update: updateMock };
                }
                return {};
            });

            const result = await service.syncDeploymentStatus('dpl_abc123');

            expect(result).not.toBeNull();
            expect(result?.status).toBe('failed');
            expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
                status: 'failed'
            }));
        });

        it('returns null when database update fails', async () => {
            mockVercelService.getDeploymentStatus.mockResolvedValue({
                status: 'ready',
                url: 'https://test.vercel.app',
                deploymentId: 'dpl_abc123',
                createdAt: new Date(),
            });

            mockSupabase.from.mockReturnValue({
                update: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                        select: vi.fn().mockReturnValue({
                            single: vi.fn().mockResolvedValue({
                                data: null,
                                error: new Error('Database error'),
                            }),
                        }),
                    }),
                }),
            });

            const result = await service.syncDeploymentStatus('dpl_abc123');

            expect(result).toBeNull();
        });
    });

    describe('getDeploymentByVercelId', () => {
        it('retrieves deployment metadata by Vercel deployment ID', async () => {
            const mockData = {
                id: 'meta-123',
                repo_full_name: 'owner/repo',
                repo_name: 'repo',
                branch: 'main',
                commit_sha: 'abc123',
                commit_message: 'Test',
                pusher_name: 'user',
                vercel_deployment_id: 'dpl_abc123',
                vercel_deployment_url: 'https://test.vercel.app',
                status: 'ready',
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z',
            };

            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                        single: vi.fn().mockResolvedValue({
                            data: mockData,
                            error: null,
                        }),
                    }),
                }),
            });

            const result = await service.getDeploymentByVercelId('dpl_abc123');

            expect(result).not.toBeNull();
            expect(result?.id).toBe('meta-123');
            expect(result?.repoFullName).toBe('owner/repo');
            expect(result?.vercelDeploymentId).toBe('dpl_abc123');
        });

        it('returns null when deployment not found', async () => {
            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                        single: vi.fn().mockResolvedValue({
                            data: null,
                            error: null,
                        }),
                    }),
                }),
            });

            const result = await service.getDeploymentByVercelId('dpl_invalid');

            expect(result).toBeNull();
        });
    });

    describe('getRecentDeployments', () => {
        it('retrieves recent deployments for a repository', async () => {
            const mockData = [
                {
                    id: 'meta-1',
                    repo_full_name: 'owner/repo',
                    repo_name: 'repo',
                    branch: 'main',
                    commit_sha: 'abc123',
                    commit_message: 'Test 1',
                    pusher_name: 'user',
                    vercel_deployment_id: 'dpl_1',
                    vercel_deployment_url: 'https://test1.vercel.app',
                    status: 'ready',
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z',
                },
                {
                    id: 'meta-2',
                    repo_full_name: 'owner/repo',
                    repo_name: 'repo',
                    branch: 'main',
                    commit_sha: 'def456',
                    commit_message: 'Test 2',
                    pusher_name: 'user',
                    vercel_deployment_id: 'dpl_2',
                    vercel_deployment_url: 'https://test2.vercel.app',
                    status: 'building',
                    created_at: '2024-01-02T00:00:00Z',
                    updated_at: '2024-01-02T00:00:00Z',
                },
            ];

            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue({
                                data: mockData,
                                error: null,
                            }),
                        }),
                    }),
                }),
            });

            const result = await service.getRecentDeployments('owner/repo', 10);

            expect(result).toHaveLength(2);
            expect(result[0].commitSha).toBe('abc123');
            expect(result[1].commitSha).toBe('def456');
        });

        it('returns empty array when no deployments found', async () => {
            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue({
                                data: null,
                                error: null,
                            }),
                        }),
                    }),
                }),
            });

            const result = await service.getRecentDeployments('owner/repo', 10);

            expect(result).toEqual([]);
        });

        it('applies limit parameter', async () => {
            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnValue({
                    eq: vi.fn().mockReturnValue({
                        order: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue({
                                data: [],
                                error: null,
                            }),
                        }),
                    }),
                }),
            });

            await service.getRecentDeployments('owner/repo', 5);

            const limitMock = mockSupabase.from().select().eq().order().limit;
            expect(limitMock).toHaveBeenCalledWith(5);
        });
    });
});
