import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeploymentUpdateService } from './deployment-update.service';
import { createClient } from '@/lib/supabase/server';
import { githubPushService } from './github-push.service';
import type { CustomizationConfig } from '@craft/types';

// Mock Supabase
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

// Mock GitHub Push Service
vi.mock('./github-push.service', () => ({
    githubPushService: {
        pushGeneratedCode: vi.fn(),
    },
}));

// Mock Vercel Service
vi.mock('./vercel.service', () => {
    const VercelServiceMock = vi.fn().mockImplementation(() => ({
        assignAlias: vi.fn().mockResolvedValue(undefined),
    }));
    return { VercelService: VercelServiceMock };
});

describe('DeploymentUpdateService', () => {
    let service: DeploymentUpdateService;
    let mockSupabase: any;

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

    const mockPreviousState = {
        customization_config: { ...mockConfig, branding: { ...mockConfig.branding, appName: 'Old App' } },
        deployment_url: 'https://old-app.vercel.app',
        vercel_deployment_id: 'old-vercel-id',
        status: 'completed',
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock crypto.randomUUID
        vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUpdateId as `${string}-${string}-${string}-${string}-${string}`);

        // Setup mock Supabase client
        mockSupabase = {
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(),
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
        };

        (createClient as any).mockReturnValue(mockSupabase);

        service = new DeploymentUpdateService(githubPushService as any);

        // Reset the global failure flag
        (globalThis as any).__DEPLOYMENT_UPDATE_SHOULD_FAIL = false;
        (globalThis as any).__CANARY_ERROR_RATE = 0;
        (globalThis as any).__CANARY_LATENCY = 100;
        (globalThis as any).__MANUAL_ROLLBACK = false;
    });

    it('should successfully update a deployment', async () => {
        // Step 1: Mock getDeploymentState
        mockSupabase.single.mockResolvedValueOnce({ data: mockPreviousState, error: null });

        // Step 4: Mock finalizeUpdate and markUpdateCompleted
        mockSupabase.single.mockResolvedValueOnce({ data: { previous_state: mockPreviousState }, error: null });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(true);
        expect(result.rolledBack).toBe(false);
        expect(result.deploymentUrl).toBe(mockPreviousState.deployment_url);

        // Verify Supabase calls
        expect(mockSupabase.from).toHaveBeenCalledWith('deployments');
        expect(mockSupabase.from).toHaveBeenCalledWith('deployment_updates');
        
        // Verify state progression logs
        const statusUpdates = mockSupabase.update.mock.calls
            .filter((call: any) => call[0].status)
            .map((call: any) => call[0].status);
        
        expect(statusUpdates).toContain('validating');
        expect(statusUpdates).toContain('generating');
        expect(statusUpdates).toContain('updating_repo');
        expect(statusUpdates).toContain('redeploying');
        expect(statusUpdates).toContain('completed');
    });

    it('should fail if deployment is not found', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: null, error: new Error('Not found') });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toBe('Deployment not found or access denied');
    });

    it('should fail if deployment is not in "completed" state', async () => {
        mockSupabase.single.mockResolvedValueOnce({ 
            data: { ...mockPreviousState, status: 'pending' }, 
            error: null 
        });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toBe("Cannot update deployment in 'pending' state");
    });

    it('should fail validation if appName is missing', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: mockPreviousState, error: null });

        // Rollback path: fetch previous_state from deployment_updates
        mockSupabase.single.mockResolvedValueOnce({
            data: {
                previous_state: {
                    customizationConfig: mockPreviousState.customization_config,
                    deploymentUrl: mockPreviousState.deployment_url,
                    vercelDeploymentId: mockPreviousState.vercel_deployment_id,
                    status: mockPreviousState.status,
                    repositoryUrl: null,
                },
            },
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

    it('should rollback if update pipeline fails', async () => {
        // Step 1: Mock getDeploymentState
        mockSupabase.single.mockResolvedValueOnce({ data: mockPreviousState, error: null });
        
        // Mock rollback state fetch — previous_state is stored with camelCase keys (DeploymentState)
        mockSupabase.single.mockResolvedValueOnce({ 
            data: {
                previous_state: {
                    customizationConfig: mockPreviousState.customization_config,
                    deploymentUrl: mockPreviousState.deployment_url,
                    vercelDeploymentId: mockPreviousState.vercel_deployment_id,
                    status: mockPreviousState.status,
                    repositoryUrl: null,
                },
            }, 
            error: null 
        });

        // Trigger pipeline failure
        (globalThis as any).__DEPLOYMENT_UPDATE_SHOULD_FAIL = true;

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(result.errorMessage).toBe('Update pipeline failed');

        // Verify rollback happened - should restore previous state
        expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
            customization_config: mockPreviousState.customization_config,
            status: 'completed'
        }));
    });

    it('should handle rollback failure gracefully', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: mockPreviousState, error: null });
        
        // Mock rollback state fetch to fail — no previous_state found
        mockSupabase.single.mockResolvedValueOnce({ data: null, error: new Error('DB error') });

        (globalThis as any).__DEPLOYMENT_UPDATE_SHOULD_FAIL = true;

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(false);
        // When previous_state is not found, rollback returns false without marking as failed
        expect(result.errorMessage).toBe('Update pipeline failed');
    });

    it('should successfully push to GitHub if githubPush is provided', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: mockPreviousState, error: null });
        
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
            }
        });

        expect(result.success).toBe(true);
        expect(githubPushService.pushGeneratedCode).toHaveBeenCalled();
        expect(result.commitRef).toEqual(mockCommitRef);
    });

    it('should successfully promote a deployment using rollout strategy', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: mockPreviousState, error: null });
        mockSupabase.single.mockResolvedValueOnce({ data: { previous_state: mockPreviousState }, error: null });

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(true);
        expect(result.rolledBack).toBe(false);
        
        // Verify canary percentages were updated in sequence: 5, 25, 50, 100
        const canaryUpdates = mockSupabase.update.mock.calls
            .filter((call: any) => call[0].canary_percent !== undefined)
            .map((call: any) => call[0].canary_percent);
        
        expect(canaryUpdates).toContain(5);
        expect(canaryUpdates).toContain(25);
        expect(canaryUpdates).toContain(50);
        expect(canaryUpdates).toContain(100);
    });

    it('should auto-rollback on error rate spike', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: mockPreviousState, error: null });
        mockSupabase.single.mockResolvedValueOnce({ 
            data: {
                previous_state: {
                    customizationConfig: mockPreviousState.customization_config,
                    deploymentUrl: mockPreviousState.deployment_url,
                    vercelDeploymentId: mockPreviousState.vercel_deployment_id,
                    status: mockPreviousState.status,
                    repositoryUrl: null,
                },
            }, 
            error: null 
        });

        // Set error rate to 10% (above threshold)
        (globalThis as any).__CANARY_ERROR_RATE = 0.1;

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(result.errorMessage).toMatch(/auto-rollback triggered/i);
    });

    it('should execute manual rollback when requested by operator', async () => {
        mockSupabase.single.mockResolvedValueOnce({ data: mockPreviousState, error: null });
        mockSupabase.single.mockResolvedValueOnce({ 
            data: {
                previous_state: {
                    customizationConfig: mockPreviousState.customization_config,
                    deploymentUrl: mockPreviousState.deployment_url,
                    vercelDeploymentId: mockPreviousState.vercel_deployment_id,
                    status: mockPreviousState.status,
                    repositoryUrl: null,
                },
            }, 
            error: null 
        });

        // Trigger manual rollback
        (globalThis as any).__MANUAL_ROLLBACK = true;

        const result = await service.updateDeployment({
            deploymentId: mockDeploymentId,
            userId: mockUserId,
            customizationConfig: mockConfig,
        });

        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
        expect(result.errorMessage).toMatch(/manual rollback triggered/i);
    });
});
