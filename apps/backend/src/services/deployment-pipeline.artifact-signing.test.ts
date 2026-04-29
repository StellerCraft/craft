/**
 * DeploymentPipelineService — Artifact Signing & Verification Tests
 *
 * Covers:
 *   - Valid artifact with correct signature proceeds to push
 *   - Tampered artifact (modified after signing) aborts pipeline
 *   - Missing signature aborts pipeline
 *   - Checksum is present in deployment_logs metadata after successful run
 *
 * Example log metadata written to deployment_logs:
 * // { checksum: "sha256:abc123...", timestamp: "...", deploymentId: "..." }
 *
 * Issue: #496
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./template-generator.service', () => ({
    templateGeneratorService: { generate: vi.fn() },
    mapCategoryToFamily: vi.fn().mockReturnValue('stellar-dex'),
}));

import { DeploymentPipelineService } from './deployment-pipeline.service';
import type { DeploymentPipelineRequest } from './deployment-pipeline.service';
import type { CustomizationConfig } from '@craft/types';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
const mockInsert = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: (table: string) => ({
            insert: mockInsert,
            update: mockUpdate,
            select: () => ({
                eq: () => ({
                    single: () => {
                        if (table === 'templates') {
                            return Promise.resolve({ data: { category: 'dex' }, error: null });
                        }
                        return Promise.resolve({ data: null, error: null });
                    },
                }),
            }),
        }),
        auth: { getUser: vi.fn() },
    }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const customization: CustomizationConfig = {
    branding: {
        appName: 'TestApp',
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

const request: DeploymentPipelineRequest = {
    userId: 'user-123',
    templateId: 'template-abc',
    name: 'my-dex-app',
    customization,
};

// ── Mock factories ────────────────────────────────────────────────────────────

function makeGeneratorMock() {
    return {
        generate: vi.fn().mockResolvedValue({
            success: true,
            generatedFiles: [{ path: 'src/index.ts', content: 'export {}', type: 'code' }],
            errors: [],
        }),
    };
}

function makeSyntaxValidatorMock() {
    return { validate: vi.fn().mockReturnValue({ valid: true, errors: [] }) };
}

function makeGithubMock() {
    return {
        createRepository: vi.fn().mockResolvedValue({
            repository: {
                id: 1,
                url: 'https://github.com/org/my-dex-app',
                cloneUrl: 'https://github.com/org/my-dex-app.git',
                sshUrl: 'git@github.com:org/my-dex-app.git',
                fullName: 'org/my-dex-app',
                defaultBranch: 'main',
                private: true,
            },
            resolvedName: 'my-dex-app',
        }),
    };
}

function makeGithubPushMock() {
    return {
        pushGeneratedCode: vi.fn().mockResolvedValue({
            owner: 'org',
            repo: 'my-dex-app',
            branch: 'main',
            commitSha: 'abc1234',
            treeSha: 'def5678',
            commitUrl: 'https://github.com/org/my-dex-app/commit/abc1234',
            previousCommitSha: '000',
            createdBranch: false,
            fileCount: 1,
        }),
    };
}

function makeVercelMock() {
    return {
        createProject: vi.fn().mockResolvedValue({ id: 'prj_abc', name: 'craft-my-dex-app', url: 'craft-my-dex-app.vercel.app' }),
        triggerDeployment: vi.fn().mockResolvedValue({
            deploymentId: 'dpl_xyz',
            deploymentUrl: 'https://craft-my-dex-app.vercel.app',
            status: 'QUEUED',
        }),
    };
}

/** Signing service that always returns a valid sign/verify pair. */
function makeSigningMock() {
    return {
        signArtifact: vi.fn().mockReturnValue({ checksum: 'sha256:abc123', signature: 'sig-abc' }),
        verifyArtifact: vi.fn().mockReturnValue(true),
    };
}

/** Signing service whose verifyArtifact always returns false (tampered / missing). */
function makeFailingVerifyMock() {
    return {
        signArtifact: vi.fn().mockReturnValue({ checksum: 'sha256:abc123', signature: 'sig-abc' }),
        verifyArtifact: vi.fn().mockReturnValue(false),
    };
}

// ── Helper ────────────────────────────────────────────────────────────────────

function getLogInserts(): any[] {
    return mockInsert.mock.calls
        .map((call: any[]) => call[0])
        .filter((p: any) => p.deployment_id && p.stage && p.message);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeploymentPipelineService — artifact signing & verification (#496)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockInsert.mockResolvedValue({ error: null });
        mockUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    });

    it('valid artifact with correct signature proceeds to push', async () => {
        const signingMock = makeSigningMock();
        const pushMock = makeGithubPushMock();

        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            pushMock,
            makeVercelMock(),
            makeSyntaxValidatorMock(),
            signingMock,
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(true);
        expect(signingMock.signArtifact).toHaveBeenCalledOnce();
        expect(signingMock.verifyArtifact).toHaveBeenCalledOnce();
        expect(pushMock.pushGeneratedCode).toHaveBeenCalledOnce();
    });

    it('tampered artifact (verifyArtifact returns false) aborts pipeline before push', async () => {
        const pushMock = makeGithubPushMock();

        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            pushMock,
            makeVercelMock(),
            makeSyntaxValidatorMock(),
            makeFailingVerifyMock(),
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('Artifact verification failed');
        expect(pushMock.pushGeneratedCode).not.toHaveBeenCalled();
    });

    it('missing signature (verifyArtifact returns false) aborts pipeline', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(),
            makeSyntaxValidatorMock(),
            makeFailingVerifyMock(),
        );

        const result = await svc.deploy(request);

        expect(result.success).toBe(false);
        expect(result.failedStage).toBe('pushing_code');
    });

    it('checksum is present in deployment_logs metadata after successful run', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(),
            makeSyntaxValidatorMock(),
            makeSigningMock(),
        );

        await svc.deploy(request);

        // Find the log entry that carries the checksum in metadata
        // Example: { checksum: "sha256:abc123...", timestamp: "...", deploymentId: "..." }
        const checksumLog = getLogInserts().find(
            (l: any) => l.metadata?.checksum !== undefined,
        );

        expect(checksumLog).toBeDefined();
        expect(checksumLog.metadata.checksum).toBe('sha256:abc123');
    });

    it('signing stage appears between validating and creating_repo in status sequence', async () => {
        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(),
            makeSyntaxValidatorMock(),
            makeSigningMock(),
        );

        await svc.deploy(request);

        const statusUpdates = mockUpdate.mock.calls
            .map((call: any[]) => call[0])
            .filter((p: any) => p.status)
            .map((p: any) => p.status);

        const valIdx = statusUpdates.indexOf('validating');
        const signIdx = statusUpdates.indexOf('signing');
        const repoIdx = statusUpdates.indexOf('creating_repo');

        expect(signIdx).not.toBe(-1);
        expect(valIdx).toBeLessThan(signIdx);
        expect(signIdx).toBeLessThan(repoIdx);
    });

    it('verifyArtifact is called with the same content and credentials produced by signArtifact', async () => {
        const signingMock = makeSigningMock();

        const svc = new DeploymentPipelineService(
            makeGeneratorMock(),
            makeGithubMock(),
            makeGithubPushMock(),
            makeVercelMock(),
            makeSyntaxValidatorMock(),
            signingMock,
        );

        await svc.deploy(request);

        const signCall = signingMock.signArtifact.mock.calls[0];
        const verifyCall = signingMock.verifyArtifact.mock.calls[0];

        // Same artifact content passed to both
        expect(verifyCall[0]).toBe(signCall[0]);
        // Checksum and signature from signArtifact forwarded to verifyArtifact
        expect(verifyCall[1]).toBe('sha256:abc123');
        expect(verifyCall[2]).toBe('sig-abc');
    });
});
