import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deploymentService } from './deployment.service';
import { createClient } from '@/lib/supabase/server';
import { githubService } from './github.service';
import { githubPushService } from './github-push.service';
import { templateGeneratorService } from './template-generator.service';
import type { DeploymentRequest } from '@craft/types';

// Mock Dependencies
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

vi.mock('./github.service', () => ({
    githubService: {
        createRepository: vi.fn(),
    },
}));

vi.mock('./github-push.service', () => ({
    githubPushService: {
        pushGeneratedCode: vi.fn(),
    },
}));

vi.mock('./template-generator.service', () => ({
    templateGeneratorService: {
        generate: vi.fn(),
    },
}));

describe('DeploymentService', () => {
    let mockSupabase: any;
    
    const mockRequest: DeploymentRequest = {
        userId: 'test-user-id',
        templateId: 'test-template-id',
        repositoryName: 'test-repo',
        customization: {
            branding: { appName: 'Test App', primaryColor: '#000', secondaryColor: '#fff', fontFamily: 'Inter' },
            features: { enableCharts: true, enableTransactionHistory: false, enableAnalytics: false, enableNotifications: false },
            stellar: { network: 'testnet', horizonUrl: 'https://testnet.com' }
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Setup mock Supabase client
        mockSupabase = {
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(),
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnThis(),
            delete: vi.fn().mockReturnThis(),
            then: function(resolve: any) { resolve({ error: null, data: null }); }
        };

        (createClient as any).mockReturnValue(mockSupabase);

        // Reset global fail flags
        (globalThis as any).__VERCEL_DEPLOY_SHOULD_FAIL = false;
    });

    describe('createDeployment', () => {
        it('should successfully create a deployment and progress through all states', async () => {
            // Mock generator
            (templateGeneratorService.generate as any).mockResolvedValue({
                success: true,
                generatedFiles: [{ path: 'index.ts', content: 'console.log("hello");', type: 'code' }],
                errors: []
            });

            // Mock repo creation
            (githubService.createRepository as any).mockResolvedValue({
                repository: { url: 'https://github.com/mock/repo' },
                resolvedName: 'mock-repo'
            });

            // Mock git push
            (githubPushService.pushGeneratedCode as any).mockResolvedValue({
                commitSha: 'mock-sha'
            });

            const result = await deploymentService.createDeployment(mockRequest);

            expect(result.status.stage).toBe('completed');
            expect(result.repositoryUrl).toBe('https://github.com/mock/repo');
            expect(result.vercelUrl).toBe('https://mock-repo.vercel.app');

            // Verify state progression in DB
            const updates = mockSupabase.update.mock.calls
                .filter((call: any) => call[0].status)
                .map((call: any) => call[0].status);
            
            expect(updates).toContain('generating');
            expect(updates).toContain('creating_repo');
            expect(updates).toContain('pushing_code');
            expect(updates).toContain('deploying');
            expect(updates).toContain('completed');

            // Verify log emission
            expect(mockSupabase.from).toHaveBeenCalledWith('deployment_logs');
            const logCalls = mockSupabase.insert.mock.calls
                .filter((call: any) => call[0].stage)
                .map((call: any) => call[0].stage);
            
            expect(logCalls).toContain('pending');
            expect(logCalls).toContain('completed');
        });

        it('should fail and log error if code generation fails', async () => {
            (templateGeneratorService.generate as any).mockResolvedValue({
                success: false,
                generatedFiles: [],
                errors: [{ message: 'Syntax error' }]
            });

            await expect(deploymentService.createDeployment(mockRequest))
                .rejects.toThrow('Code generation failed');

            // Verify status marked as failed
            expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
                status: 'failed',
                error_message: 'Code generation failed'
            }));

            // Verify error logged
            const logCall = mockSupabase.insert.mock.calls
                .find((call: any) => call[0].stage === 'failed')[0];
            
            expect(logCall).toBeDefined();
            expect(logCall.log_level).toBe('error');
            expect(logCall.message).toContain('Code generation failed');
        });

        it('should fail and log error if GitHub repo creation fails', async () => {
            (templateGeneratorService.generate as any).mockResolvedValue({
                success: true,
                generatedFiles: [],
                errors: []
            });

            (githubService.createRepository as any).mockRejectedValue(new Error('GitHub API Error'));

            await expect(deploymentService.createDeployment(mockRequest))
                .rejects.toThrow('GitHub API Error');

            expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
                status: 'failed',
                error_message: 'GitHub API Error'
            }));
        });

        it('should fail and log error if Vercel deploy fails', async () => {
            (templateGeneratorService.generate as any).mockResolvedValue({
                success: true,
                generatedFiles: [],
            });

            (githubService.createRepository as any).mockResolvedValue({
                repository: { url: 'https://github.com/mock/repo' },
                resolvedName: 'mock-repo'
            });

            (githubPushService.pushGeneratedCode as any).mockResolvedValue({});

            // Trigger Vercel failure
            (globalThis as any).__VERCEL_DEPLOY_SHOULD_FAIL = true;

            await expect(deploymentService.createDeployment(mockRequest))
                .rejects.toThrow('Vercel deployment failed');

            expect(mockSupabase.update).toHaveBeenCalledWith(expect.objectContaining({
                status: 'failed'
            }));
        });
    });

    describe('deleteDeployment', () => {
        it('should successfully delete a deployment', async () => {
            // Mock ownership check
            mockSupabase.single.mockResolvedValueOnce({ data: { id: 'test-id' }, error: null });

            const result = await deploymentService.deleteDeployment('test-id', 'test-user-id');

            expect(result).toBe(true);
            expect(mockSupabase.from).toHaveBeenCalledWith('deployments');
            expect(mockSupabase.delete).toHaveBeenCalled();
            expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'test-id');

            // Verify deletion log
            const logCall = mockSupabase.insert.mock.calls
                .find((call: any) => call[0] && call[0].stage === 'deleted');
            
            expect(logCall).toBeDefined();
        });

        it('should return false if deployment belongs to another user or not found', async () => {
            // Mock ownership check failure
            mockSupabase.single.mockResolvedValueOnce({ data: null, error: new Error('Not found') });

            const result = await deploymentService.deleteDeployment('missing-id', 'test-user-id');

            expect(result).toBe(false);
            expect(mockSupabase.delete).not.toHaveBeenCalled();
        });
    });
});
