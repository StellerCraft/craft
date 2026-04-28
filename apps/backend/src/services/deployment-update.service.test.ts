import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomizationConfig } from '@craft/types';
import { createClient } from '@/lib/supabase/server';
import { DeploymentUpdateService } from './deployment-update.service';
import { githubPushService } from './github-push.service';

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

vi.mock('./github-push.service', () => ({
    githubPushService: {
        pushGeneratedCode: vi.fn(),
    },
}));

describe('DeploymentUpdateService', () => {
    let service: DeploymentUpdateService;
    let mockSupabase: any;
    let mockVercelService: any;
    let mockRolloutMonitor: any;

    const mockDeploymentId = 'test-deployment-id';
    const mockUserId = 'test-user-id';
    const mockUpdateId = 'test-update-id';

    const mockConfig: CustomizationConfig = {
        branding: {
            appName: 'Test App',
            primaryColor: '#000000',
            secondaryColor: '#ffffff',
            fontFamily: 'Inter',
        },
        features: {
            enableCharts: true,
            enableTransactionHistory: true,
            enableAnalytics: false,
            enableNotifications: false,
        },
        stellar: {
            network: 'testnet',
            horizonUrl: 'https://horizon-testnet.stellar.org',
        },
    };

    const mockDeploymentRow = {
        name: 'test-app',
        customization_config: { ...mockConfig, branding: { ...mockConfig.branding, appName: 'Old App' } },
        deployment_url: 'https://old-app.vercel.app',
        vercel_project_id: 'vercel-project-id',
        vercel_deployment_id: 'old-vercel-id',
        custom_domain: 'app.example.com',
        repository_url: 'https://github.com/acme/test-app',
        status: 'completed',
    };

    const mockPreviousState = {
        name: mockDeploymentRow.name,
        customizationConfig: mockDeploymentRow.customization_config,
        deploymentUrl: mockDeploymentRow.deployment_url,
        vercelProjectId: mockDeploymentRow.vercel_project_id,
        vercelDeploymentId: mockDeploymentRow.vercel_deployment_id,
        customDomain: mockDeploymentRow.custom_domain,
        repositoryUrl: mockDeploymentRow.repository_url,
        status: mockDeploymentRow.status,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUpdateId as `${string}-${string}-${string}-${string}-${string}`);

        mockSupabase = {
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(),
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
        };

        mockVercelService = {
            triggerDeployment: vi.fn().mockResolvedValue({
                deploymentId: 'new-vercel-id',
                deploymentUrl: 'https://new-app.vercel.app',
                status: 'READY',
            }),
            getDeploymentStatus: vi.fn().mockResolvedValue({
                status: 'ready',
                url: 'https://new-app.vercel.app',
                deploymentId: 'new-vercel-id',
                createdAt: new Date(),
            }),
            listDeploymentAliases: vi.fn().mockResolvedValue([
                { uid: 'alias-1', alias: 'app.example.com' },
            ]),
            assignAliasToDeployment: vi.fn().mockResolvedValue({
                uid: 'alias-1',
                alias: 'app.example.com',
            }),
        };

        mockRolloutMonitor = {
            getCandidateMetrics: vi.fn().mockResolvedValue({
                errorRate: 0.001,
                p99LatencyMs: 120,
            }),
        };

        (createClient as any).mockReturnValue(mockSupabase);

        service = new DeploymentUpdateService(
            githubPushService as any,
            mockVercelService,
            mockRolloutMonitor,
        );

        (globalThis as any).__DEPLOYMENT_UPDATE_SHOULD_FAIL = false;
        (globalThis as any).__DEPLOYMENT_UPDATE_MANUAL_ROLLBACK = false;
    });

    it('successfully updates a deployment via blue-green promotion', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: mockDeploymentRow, error: null });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(true);
        expect(result.rolledBack).toBe(false);
        expect(result.deploymentUrl).toBe('https://new-app.vercel.app');
        expect(mockVercelService.triggerDeployment).toHaveBeenCalledWith(
            'vercel-project-id',
            'acme/test-app',
        );
        expect(mockVercelService.assignAliasToDeployment).toHaveBeenCalledWith(
            'new-vercel-id',
            'app.example.com',
        );

        const canaryUpdates = mockSupabase.update.mock.calls
            .map((call: any[]) => call[0])
            .filter((payload: any) => typeof payload.canary_percent === 'number')
            .map((payload: any) => payload.canary_percent);

        expect(canaryUpdates).toEqual(expect.arrayContaining([0, 5, 25, 50, 100]));
        expect(mockSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({
            canary_percent: 0,
        }));
    });

    it('fails if deployment is not found', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: null, error: new Error('Not found') });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toBe('Deployment not found or access denied');
    });

    it('fails if deployment is not in completed state', async () => {
        mockSupabase.single.mockResolvedValueOnce({
            data: { ...mockDeploymentRow, status: 'pending' },
            error: null,
        });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toBe("Cannot update deployment in 'pending' state");
    });

    it('fails validation if appName is missing and rolls back', async () => {
        mockSupabase.single
            .mockResolvedValueOnce({ data: mockDeploymentRow, error: null })
            .mockResolvedValueOnce({
                data: { previous_state: mockPreviousState },
                error: null,
            });

        const invalidConfig = { ...mockConfig, branding: { ...mockConfig.branding, appName: '' } };
        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: invalidConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(result.errorMessage).toBe('Invalid configuration: appName is required');
    });

    it('rolls back if the pipeline fails before rollout', async () => {
        mockSupabase.single
            .mockResolvedValueOnce({ data: mockDeploymentRow, error: null })
            .mockResolvedValueOnce({
                data: { previous_state: mockPreviousState },
                error: null,
            });
        (globalThis as any).__DEPLOYMENT_UPDATE_SHOULD_FAIL = true;

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(result.errorMessage).toBe('Update pipeline failed');
        expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
            customization_config: mockPreviousState.customizationConfig,
            status: 'completed',
        }));
    });

    it('handles rollback failure gracefully', async () => {
        mockSupabase.single
            .mockResolvedValueOnce({ data: mockDeploymentRow, error: null })
            .mockResolvedValueOnce({ data: null, error: new Error('DB error') });
        (globalThis as any).__DEPLOYMENT_UPDATE_SHOULD_FAIL = true;

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(false);
        expect(result.errorMessage).toBe('Update pipeline failed');
    });

    it('successfully pushes to GitHub when githubPush is provided', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: mockDeploymentRow, error: null });

        const mockCommitRef = { sha: 'test-sha', url: 'https://github.com/test' };
        (githubPushService.pushGeneratedCode as any).mockResolvedValue(mockCommitRef);

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
            githubPush: {
                owner: 'owner',
                repo: 'repo',
                token: 'token',
                branch: 'main',
                generatedFiles: [],
            },
        });

        expect(result.success).toBe(true);
        expect(githubPushService.pushGeneratedCode).toHaveBeenCalled();
        expect(result.commitRef).toEqual(mockCommitRef);
        expect(mockVercelService.triggerDeployment).toHaveBeenCalledWith('vercel-project-id', 'owner/repo');
    });

    it('auto-rolls back on candidate error-rate spike', async () => {
        mockSupabase.single
            .mockResolvedValueOnce({ data: mockDeploymentRow, error: null })
            .mockResolvedValueOnce({
                data: { previous_state: mockPreviousState },
                error: null,
            });
        mockRolloutMonitor.getCandidateMetrics.mockResolvedValueOnce({
            errorRate: 0.08,
            p99LatencyMs: 140,
        });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(result.errorMessage).toContain('Automatic rollback triggered');
        expect(mockVercelService.assignAliasToDeployment).not.toHaveBeenCalled();
    });

    it('supports manual rollback during rollout monitoring', async () => {
        mockSupabase.single
            .mockResolvedValueOnce({ data: mockDeploymentRow, error: null })
            .mockResolvedValueOnce({
                data: { previous_state: mockPreviousState },
                error: null,
            });
        mockRolloutMonitor.getCandidateMetrics.mockResolvedValueOnce({
            errorRate: 0.001,
            p99LatencyMs: 120,
            forceRollback: true,
        });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(result.errorMessage).toContain('Manual rollback requested');
    });

    it('reverts aliases to the previous deployment if alias switch fails mid-promotion', async () => {
        mockSupabase.single
            .mockResolvedValueOnce({ data: mockDeploymentRow, error: null })
            .mockResolvedValueOnce({
                data: { previous_state: mockPreviousState },
                error: null,
            });
        mockVercelService.listDeploymentAliases.mockResolvedValue([
            { uid: 'alias-1', alias: 'app.example.com' },
            { uid: 'alias-2', alias: 'api.example.com' },
        ]);
        mockVercelService.assignAliasToDeployment
            .mockResolvedValueOnce({ uid: 'alias-1', alias: 'app.example.com' })
            .mockRejectedValueOnce(new Error('Vercel alias update failed'))
            .mockResolvedValueOnce({ uid: 'alias-1', alias: 'app.example.com' });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(mockVercelService.assignAliasToDeployment).toHaveBeenNthCalledWith(
            3,
            'old-vercel-id',
            'app.example.com',
        );
    });
});
