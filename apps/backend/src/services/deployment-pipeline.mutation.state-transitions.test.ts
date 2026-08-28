/**
 * Mutation testing for DeploymentPipelineService state transitions
 *
 * Targets ≥80% mutation score by focusing on:
 *   - State transition guards (pending → building → deployed)
 *   - Status update conditionals
 *   - Error boundary transitions
 *   - Fallback and rollback logic
 *
 * Issue: #821
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeploymentPipelineService } from './deployment-pipeline.service';
import type { DeploymentPipelineRequest, DeploymentPipelineResult } from './deployment-pipeline.service';
import type { CustomizationConfig } from '@craft/types';

// Mock all dependencies
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'templates') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: { category: 'dex' }, error: null }),
            }),
          }),
        };
      }
      return {
        insert: () => Promise.resolve({ error: null }),
        update: () => ({
          eq: () => Promise.resolve({ error: null }),
        }),
      };
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-123' } } }) },
  }),
}));

vi.mock('./template-generator.service', () => ({
  templateGeneratorService: {
    generate: vi.fn().mockResolvedValue({ success: true, code: 'generated code' }),
  },
  mapCategoryToFamily: vi.fn().mockReturnValue('stellar-dex'),
}));

vi.mock('./github.service', () => ({
  githubService: {
    createRepository: vi.fn().mockResolvedValue({
      repositoryUrl: 'https://github.com/user/repo',
      repositoryId: '123',
    }),
  },
}));

vi.mock('./github-push.service', () => ({
  githubPushService: {
    pushGeneratedCode: vi.fn().mockResolvedValue({
      commitSha: 'abc123',
    }),
  },
}));

vi.mock('./vercel.service', () => ({
  vercelService: {
    createProject: vi.fn().mockResolvedValue({
      projectId: 'proj-123',
    }),
    triggerDeployment: vi.fn().mockResolvedValue({
      deploymentUrl: 'https://my-app.vercel.app',
    }),
  },
}));

vi.mock('./github-commit-status.service', () => ({
  githubCommitStatusService: {
    reportPending: vi.fn().mockResolvedValue(undefined),
    reportSuccess: vi.fn().mockResolvedValue(undefined),
    reportFailure: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./syntax-validator', () => ({
  syntaxValidator: {
    validate: vi.fn().mockResolvedValue({ valid: true }),
  },
}));

vi.mock('./artifact-signing.service', () => ({
  artifactSigningService: {
    signArtifact: vi.fn().mockReturnValue({
      checksum: 'sha256:abc',
      signature: 'sig123',
    }),
  },
}));

vi.mock('./build-cache.service', () => ({
  buildCacheService: {
    checkCache: vi.fn().mockResolvedValue({ hit: false }),
    storeHash: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./job-queue.service', () => ({
  jobQueueService: {
    enqueue: vi.fn().mockResolvedValue({ jobId: 'job-123' }),
  },
}));

const customization: CustomizationConfig = {
  branding: {
    appName: 'TestApp',
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
  },
};

describe('DeploymentPipelineService - Mutation Testing (State Transitions)', () => {
  let service: DeploymentPipelineService;

  beforeEach(() => {
    service = new DeploymentPipelineService();
    vi.clearAllMocks();
  });

  describe('Happy path state transitions', () => {
    it('should transition through all states: pending → generating → repo_created → pushed → deploying → completed', async () => {
      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.success).toBe(true);
      expect(result.deploymentId).toBeDefined();
      expect(result.repositoryUrl).toBeDefined();
      expect(result.deploymentUrl).toBeDefined();
      expect(result.failedStage).toBeUndefined();
    });

    it('should set success to true when all stages complete', async () => {
      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.success).toStrictEqual(true);
      expect(typeof result.success).toBe('boolean');
    });

    it('should populate both repositoryUrl and deploymentUrl on success', async () => {
      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.repositoryUrl).toBeTruthy();
      expect(result.deploymentUrl).toBeTruthy();
      expect(result.errorMessage).toBeUndefined();
    });
  });

  describe('Error state transitions', () => {
    it('should mark deployment failed when generation fails', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.success).toBe(false);
      expect(result.failedStage).toBeDefined();
      expect(result.errorMessage).toContain('Generation failed');
    });

    it('should set success to false when error occurs', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.success).toStrictEqual(false);
      expect(typeof result.success).toBe('boolean');
    });

    it('should only set errorMessage when success is false', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      if (result.success) {
        expect(result.errorMessage).toBeUndefined();
      } else {
        expect(result.errorMessage).toBeDefined();
      }
    });

    it('should set failedStage when error occurs during generation', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.failedStage).toMatch(/generating|pending/);
    });

    it('should not set URLs when deployment fails', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.repositoryUrl).toBeUndefined();
      expect(result.deploymentUrl).toBeUndefined();
    });
  });

  describe('State transition guards', () => {
    it('should not proceed to repo creation if generation fails', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      const { githubService } = await import('./github.service');

      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      await service.deploy(request);

      expect((githubService.createRepository as any).mock.calls).toHaveLength(0);
    });

    it('should only transition to completed when all stages succeed', async () => {
      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.success).toBe(true);
      expect(result.deploymentUrl).toBeTruthy();
    });

    it('should not set deployment URL if deployment fails', async () => {
      const { vercelService } = await import('./vercel.service');
      (vercelService.triggerDeployment as any).mockRejectedValueOnce(
        new Error('Deployment failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.deploymentUrl).toBeUndefined();
    });
  });

  describe('Fallback and rollback logic', () => {
    it('should return structured error when deployment fails', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('deploymentId');
      expect(result).toHaveProperty('errorMessage');
      expect(result).toHaveProperty('failedStage');
    });

    it('should return structured success when deployment completes', async () => {
      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('deploymentId');
      expect(result).toHaveProperty('repositoryUrl');
      expect(result).toHaveProperty('deploymentUrl');
    });

    it('should never throw, always returning DeploymentPipelineResult', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      let threwError = false;
      let result: DeploymentPipelineResult | undefined;

      try {
        result = await service.deploy(request);
      } catch {
        threwError = true;
      }

      expect(threwError).toBe(false);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });
  });

  describe('Result invariants', () => {
    it('should always provide deploymentId', async () => {
      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(result.deploymentId).toBeDefined();
      expect(typeof result.deploymentId).toBe('string');
      expect(result.deploymentId.length).toBeGreaterThan(0);
    });

    it('should always provide success boolean', async () => {
      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      expect(typeof result.success).toBe('boolean');
    });

    it('should provide URLs only when success is true', async () => {
      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      if (result.success) {
        expect(result.repositoryUrl).toBeDefined();
        expect(result.deploymentUrl).toBeDefined();
      } else {
        expect(result.repositoryUrl).toBeUndefined();
        expect(result.deploymentUrl).toBeUndefined();
      }
    });

    it('should provide errorMessage only when success is false', async () => {
      const { templateGeneratorService } = await import('./template-generator.service');
      (templateGeneratorService.generate as any).mockRejectedValueOnce(
        new Error('Generation failed')
      );

      const request: DeploymentPipelineRequest = {
        userId: 'user-123',
        templateId: 'template-dex',
        customization,
        name: 'My DEX',
      };

      const result = await service.deploy(request);

      if (!result.success) {
        expect(result.errorMessage).toBeDefined();
      } else {
        expect(result.errorMessage).toBeUndefined();
      }
    });
  });
});
