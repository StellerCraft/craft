/**
 * Property 23 — Deployment Error Capture
 * 
 * REQUIREMENT:
 * For any deployment failure at any stage, error logs should be captured 
 * with full context and displayed to the user.
 * 
 * WHAT THIS TEST SPECIFIES:
 * When the deployment pipeline encounters an error in any of its stages 
 * (generating, creating_repo, pushing_code, or deploying), the system MUST:
 *   1. Update the deployment status to 'failed'.
 *   2. Persist the specific error message in the deployment record.
 *   3. Create a log entry in 'deployment_logs' with:
 *      - Level set to 'error'
 *      - Correct stage identifier
 *      - Error message
 *      - Metadata containing the correlationId for tracing.
 * 
 * Validates: Design document Property 23.
 */

import * as fc from 'fast-check';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeploymentPipelineService } from './deployment-pipeline.service';
import type { CustomizationConfig, DeploymentStatusType } from '@craft/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSupabase = {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ error: null }),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error: null }),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { category: 'dex' }, error: null }),
};

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => mockSupabase,
}));

vi.mock('@/lib/api/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    }),
}));

describe('Property 23 — Deployment Error Capture (Property Test)', () => {
    let service: DeploymentPipelineService;

    // Sub-service mocks
    const mockGenerator = { generate: vi.fn() };
    const mockGitHub = { createRepository: vi.fn() };
    const mockGitHubPush = { pushGeneratedCode: vi.fn() };
    const mockVercel = { createProject: vi.fn(), triggerDeployment: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        service = new DeploymentPipelineService(
            mockGenerator as any,
            mockGitHub as any,
            mockGitHubPush as any,
            mockVercel as any
        );
        
        mockGenerator.generate.mockResolvedValue({ success: true, generatedFiles: [] });
        mockGitHub.createRepository.mockResolvedValue({
            repository: { fullName: 'owner/repo', url: 'https://github.com/owner/repo', defaultBranch: 'main' },
            resolvedName: 'repo'
        });
        mockGitHubPush.pushGeneratedCode.mockResolvedValue({ commitSha: 'abc', fileCount: 0 });
        mockVercel.createProject.mockResolvedValue({ id: 'prj_123', name: 'craft-repo' });
        mockVercel.triggerDeployment.mockResolvedValue({ deploymentId: 'dep_123', deploymentUrl: 'https://url.com' });
    });

    const arbStage = fc.constantFrom<DeploymentStatusType>(
        'generating',
        'creating_repo',
        'pushing_code',
        'deploying'
    );

    const arbErrorMessage = fc.string({ minLength: 5, maxLength: 100 });

    const arbRequest = fc.record({
        userId: fc.uuid(),
        templateId: fc.uuid(),
        name: fc.string({ minLength: 1 }),
        customization: fc.record({
            branding: fc.record({ appName: fc.string() }),
            features: fc.record({ enableCharts: fc.boolean() }),
            stellar: fc.record({ network: fc.constantFrom('mainnet', 'testnet') }),
        }) as fc.Arbitrary<CustomizationConfig>,
    });

    it('Feature: craft-platform, Property 23: should capture errors at any pipeline stage with full context', async () => {
        await fc.assert(
            fc.asyncProperty(
                arbRequest,
                arbStage,
                arbErrorMessage,
                async (request, failedStage, errorMsg) => {
                    setupFailureAtStage(failedStage, errorMsg, {
                        mockGenerator,
                        mockGitHub,
                        mockGitHubPush,
                        mockVercel,
                    });

                    const result = await service.deploy(request);

                    expect(result.success).toBe(false);
                    expect(result.failedStage).toBe(failedStage);
                    expect(result.errorMessage).toContain(errorMsg);
                    expect(result.correlationId).toBeDefined();

                    const deploymentUpdates = mockSupabase.update.mock.calls.filter(
                        (call) => call[0].status === 'failed'
                    );
                    expect(deploymentUpdates.length).toBe(1);
                    expect(deploymentUpdates[0][0].error_message).toContain(errorMsg);

                    const logInserts = mockSupabase.insert.mock.calls.filter(
                        (call) => call[0].level === 'error'
                    );
                    expect(logInserts.length).toBe(1);
                    const errorLog = logInserts[0][0];
                    
                    expect(errorLog.stage).toBe(failedStage);
                    expect(errorLog.message).toContain(errorMsg);
                    expect(errorLog.metadata.correlationId).toBe(result.correlationId);
                }
            ),
            { numRuns: 100 }
        );
    });
});

function setupFailureAtStage(stage: DeploymentStatusType, message: string, mocks: any) {
    switch (stage) {
        case 'generating':
            mocks.mockGenerator.generate.mockResolvedValue({ success: false, errors: [{ message }], generatedFiles: [] });
            break;
        case 'creating_repo':
            mocks.mockGitHub.createRepository.mockRejectedValue(new Error(message));
            break;
        case 'pushing_code':
            mocks.mockGitHubPush.pushGeneratedCode.mockRejectedValue(new Error(message));
            break;
        case 'deploying':
            mocks.mockVercel.createProject.mockRejectedValue(new Error(message));
            break;
    }
}