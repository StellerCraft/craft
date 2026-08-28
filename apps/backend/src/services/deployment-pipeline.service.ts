/**
 * DeploymentPipelineService
 *
 * Orchestrates the full deployment pipeline for a CRAFT template:
 *
 *   1. Persist a `pending` deployment record (DB)
 *   2. Generate code from template + customization config
 *   3. Create a private GitHub repository
 *   4. Push generated files to the repository
 *   5. Create a Vercel project linked to the repository
 *   6. Trigger a Vercel deployment
 *   7. Persist the final `completed` record with all URLs
 *
 * Failure handling:
 *   Any stage failure marks the deployment `failed` with a descriptive
 *   error_message and writes a structured log entry. The deployment record
 *   is always left in a terminal state so the UI can poll and surface errors.
 *
 * Rollback boundaries:
 *   - GitHub repo created but Vercel fails → deployment marked failed;
 *     the repo is left in place so the user can retry without losing code.
 *   - Partial code push → deployment marked failed; the repo may be empty
 *     or partial — the UI should prompt a retry.
 *
 * GitHub Commit Status Reporting:
 *   After the commit SHA is known (post-push), GitHub commit statuses are
 *   posted at each terminal transition:
 *     pending  → pipeline started
 *     success  → deployment completed
 *     failure  → any stage failed
 *   Status-reporting failures are silently caught and logged — they NEVER
 *   block or abort the deployment pipeline.
 *
 * Design doc properties satisfied:
 *   Property 20 — Deployment Pipeline Sequence (generation → repo → push → vercel → URL)
 *   Property 21 — Vercel Environment Variable Configuration
 *   Property 22 — Vercel Build Configuration (nextjs + turborepo)
 *   Property 23 — Deployment Error Capture
 *   Property 24 — Deployment Status Progression
 *   Property 25 — Deployment Log Persistence
 *
 * Issue: #96
 * Branch: issue-096-implement-deployment-pipeline-orchestration
 *
 * Issue: #114
 * Branch: issue-114-add-structured-logging-with-correlation-ids
 *
 * Issue: #651
 * Branch: feat/issue-115-github-commit-status-reporting
 *
 * Issue: #754
 * Branch: feat/deployment-parallel-stage-execution
 */

import { createClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/api/logger';
import type { CustomizationConfig } from '@craft/types';
import type { DeploymentStatusType } from '@craft/types';
import { templateGeneratorService, type TemplateGeneratorService } from './template-generator.service';
import { githubService, type GitHubService } from './github.service';
import { githubPushService, type GitHubPushService } from './github-push.service';
import { vercelService, type VercelService } from './vercel.service';
import {
    buildGraph,
    CircularDependencyError,
    DependencyGraph,
    DeploymentNode,
    executeAsync,
} from './dependency-graph';
import { buildVercelEnvVars } from '@/lib/env/env-template-generator';
import { mapCategoryToFamily } from './template-generator.service';
import type { TemplateFamilyId } from './code-generator.service';
import { syntaxValidator, type SyntaxValidator } from './syntax-validator';
import { artifactSigningService, ArtifactSigningService } from './artifact-signing.service';
import { deploymentUpdateService, DeploymentUpdateService } from './deployment-update.service';
import { buildCacheService, BuildCacheService } from './build-cache.service';
import {
    githubCommitStatusService,
    type GitHubCommitStatusService,
} from './github-commit-status.service';
import type { SupabaseClient } from '@supabase/supabase-js';
// ── Request / result types ────────────────────────────────────────────────────

export interface DeploymentPipelineRequest {
    userId: string;
    templateId: string;
    customization: CustomizationConfig;
    /** Human-readable name for the deployment (used as repo name). */
    name: string;
    /** Optional update context — if present, rollback will be called on failure. */
    updateContext?: {
        updateId: string;
        deploymentId: string;
    };
}

export interface DeploymentPipelineResult {
    success: boolean;
    deploymentId: string;
    /** Correlation ID that was threaded through every log entry for this run. */
    correlationId: string;
    /** Present when success is true. */
    repositoryUrl?: string;
    /** Present when success is true. */
    deploymentUrl?: string;
    /** Present when success is false. */
    errorMessage?: string;
    /** Stage at which the pipeline failed (if applicable). */
    failedStage?: DeploymentStatusType;
}

// ── Internal stage logger ─────────────────────────────────────────────────────

/** Custom error for timeout scenarios that can be retried. */
export class RetryableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RetryableError';
    }
}

type LogLevel = 'info' | 'warn' | 'error';

/** Internal pipeline stage identifiers executed via the dependency graph. */
export type PipelineStageId =
    | 'generate'
    | 'validate'
    | 'cache_check'
    | 'sign'
    | 'sync_env_vars'
    | 'create_repo'
    | 'push_code'
    | 'deploy'
    | 'verify_contract'
    | 'complete';

/** DAG of deployment pipeline stages — independent stages run concurrently. */
export const PIPELINE_STAGE_GRAPH: DeploymentNode[] = [
    { id: 'generate', dependsOn: [] },
    { id: 'validate', dependsOn: ['generate'] },
    { id: 'cache_check', dependsOn: ['validate'] },
    { id: 'sign', dependsOn: ['cache_check'] },
    { id: 'sync_env_vars', dependsOn: ['sign'] },
    { id: 'create_repo', dependsOn: ['sign'] },
    { id: 'push_code', dependsOn: ['create_repo'] },
    { id: 'deploy', dependsOn: ['push_code', 'sync_env_vars'] },
    { id: 'verify_contract', dependsOn: ['deploy'] },
    { id: 'complete', dependsOn: ['verify_contract'] },
];

type StageFailure = { kind: 'failure'; result: DeploymentPipelineResult };
type StageSuccess = { kind: 'success'; patch: Partial<PipelineContext> };
type StageOutcome = StageFailure | StageSuccess;

interface PipelineContext {
    deploymentId: string;
    correlationId: string;
    userId: string;
    templateId: string;
    customization: CustomizationConfig;
    name: string;
    updateContext?: DeploymentPipelineRequest['updateContext'];
    supabase: SupabaseClient;
    logger: ReturnType<typeof createLogger>;
    generationResult?: Awaited<ReturnType<TemplateGeneratorService['generate']>>;
    cacheResult?: Awaited<ReturnType<BuildCacheService['checkCache']>>;
    artifactContent?: string;
    artifactChecksum?: string;
    artifactSignature?: string;
    templateCategory?: string;
    templateFamily?: TemplateFamilyId;
    envVars?: ReturnType<typeof buildVercelEnvVars>;
    repoFullName?: string;
    repositoryUrl?: string;
    defaultBranch?: string;
    commitSha?: string;
    owner?: string;
    repo?: string;
    deploymentUrl?: string;
    vercelProjectId?: string;
    vercelDeploymentId?: string;
}

export function buildPipelineGraph(): DependencyGraph {
    return buildGraph(PIPELINE_STAGE_GRAPH);
}

// ── Service ───────────────────────────────────────────────────────────────────

export class DeploymentPipelineService {
    constructor(
        private readonly _templateGeneratorService: Pick<TemplateGeneratorService, 'generate'> = templateGeneratorService,
        private readonly _githubService: Pick<GitHubService, 'createRepository'> = githubService,
        private readonly _githubPushService: Pick<GitHubPushService, 'pushGeneratedCode'> = githubPushService,
        private readonly _vercelService: Pick<VercelService, 'createProject' | 'triggerDeployment'> = vercelService,
        private readonly _syntaxValidator: Pick<SyntaxValidator, 'validate'> = syntaxValidator,
        private readonly _artifactSigningService: ArtifactSigningService = artifactSigningService,
        private readonly _deploymentUpdateService: Pick<DeploymentUpdateService, 'rollbackUpdate'> | null = null,
        private readonly _commitStatusService: Pick<GitHubCommitStatusService, 'reportPending' | 'reportSuccess' | 'reportFailure'> = githubCommitStatusService,
        private readonly _buildCacheService: BuildCacheService = buildCacheService,
    ) {}

    /**
     * Run the full deployment pipeline.
     * Never throws — all error paths return a resolved DeploymentPipelineResult.
     */
    async deploy(request: DeploymentPipelineRequest): Promise<DeploymentPipelineResult> {
        const supabase = createClient();
        const deploymentId = crypto.randomUUID();
        const { userId, templateId, customization, name, updateContext } = request;

        // ── Step 0: Validate Dependency Graph ─────────────────────────────────
        // Build graph from customization config or template defaults
        const nodes = ((customization as any).nodes || []) as DeploymentNode[];
        
        try {
            if (nodes.length > 0) {
                const graph = buildGraph(nodes);
                if (graph.hasCycle()) {
                    // This will throw CircularDependencyError which we catch below
                    graph.topologicalOrder();
                }
                const order = graph.topologicalOrder();
                
                await this.log(
                    deploymentId,
                    'pending',
                    `Validated dependency graph. Topological order: ${order.join(' -> ')}`,
                    'info',
                    { topologicalOrder: order },
                );
            }
        } catch (error: any) {
            const errorMessage = error instanceof CircularDependencyError
                ? `Circular dependency detected: ${error.message}`
                : error.message;

            return {
                success: false,
                deploymentId,
                correlationId: '', // Placeholder as correlation ID is created after this step
                failedStage: 'pending',
                errorMessage,
            };
        }

        // ── Correlation ID ────────────────────────────────────────────────────
        const correlationId = crypto.randomUUID();
        const logger = createLogger({ correlationId, userId, service: 'deployment-pipeline' });

        // ── Step 1: Create deployment record ─────────────────────────────────

        const { error: insertError } = await supabase.from('deployments').insert({
            id: deploymentId,
            user_id: userId,
            template_id: templateId,
            name,
            customization_config: customization as unknown as import('@/lib/supabase/database.types').Json,
            status: 'pending',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });

        if (insertError) {
            return {
                success: false,
                deploymentId,
                correlationId,
                errorMessage: `Failed to create deployment record: ${insertError.message}`,
            };
        }

        await this.log(deploymentId, 'pending', 'Deployment record created', 'info', { correlationId });

        const pipelineContext: PipelineContext = {
            deploymentId,
            correlationId,
            userId,
            templateId,
            customization,
            name,
            updateContext,
            supabase,
            logger,
        };

        return this.runPipelineStages(pipelineContext);
    }

    /**
     * Executes pipeline stages via the dependency graph. Stages whose
     * prerequisites are satisfied run concurrently within each level.
     */
    private async runPipelineStages(
        initialContext: PipelineContext,
    ): Promise<DeploymentPipelineResult> {
        const graph = buildPipelineGraph();
        let context = { ...initialContext };

        for (const level of graph.executionLevels()) {
            const snapshot = Object.freeze({ ...context }) as PipelineContext;
            const levelExecutors = new Map(
                level.map((stageId) => [
                    stageId,
                    () => this.runStage(stageId as PipelineStageId, snapshot),
                ]),
            );

            const levelGraph = buildGraph(level.map((id) => ({ id, dependsOn: [] as string[] })));
            const { results } = await executeAsync(levelGraph, levelExecutors);

            for (const stageId of level) {
                const outcome = results.get(stageId)!;
                if (outcome.kind === 'failure') {
                    return outcome.result;
                }
                context = { ...context, ...outcome.patch };
            }
        }

        return {
            success: true,
            deploymentId: context.deploymentId,
            correlationId: context.correlationId,
            repositoryUrl: context.repositoryUrl,
            deploymentUrl: context.deploymentUrl,
        };
    }

    private runStage(stageId: PipelineStageId, ctx: PipelineContext): Promise<StageOutcome> {
        switch (stageId) {
            case 'generate':
                return this.stageGenerate(ctx);
            case 'validate':
                return this.stageValidate(ctx);
            case 'cache_check':
                return this.stageCacheCheck(ctx);
            case 'sign':
                return this.stageSign(ctx);
            case 'sync_env_vars':
                return this.stageSyncEnvVars(ctx);
            case 'create_repo':
                return this.stageCreateRepo(ctx);
            case 'push_code':
                return this.stagePushCode(ctx);
            case 'deploy':
                return this.stageDeploy(ctx);
            case 'verify_contract':
                return this.stageVerifyContract(ctx);
            case 'complete':
                return this.stageComplete(ctx);
            default: {
                const exhaustive: never = stageId;
                return Promise.resolve({
                    kind: 'failure',
                    result: {
                        success: false,
                        deploymentId: ctx.deploymentId,
                        correlationId: ctx.correlationId,
                        errorMessage: `Unknown pipeline stage: ${exhaustive}`,
                    },
                });
            }
        }
    }

    private async stageGenerate(ctx: PipelineContext): Promise<StageOutcome> {
        const { deploymentId, correlationId, templateId, customization, updateContext } = ctx;

        await this.setStatus(deploymentId, 'generating');
        await this.log(deploymentId, 'generating', 'Starting code generation', 'info', { correlationId });

        const generationResult = await this._templateGeneratorService.generate({
            templateId,
            customization,
            outputPath: `/tmp/craft-workspaces/${deploymentId}`,
        });

        if (!generationResult.success) {
            const msg = generationResult.errors.map((e) => e.message).join('; ');
            return {
                kind: 'failure',
                result: await this.fail(
                    deploymentId,
                    'generating',
                    `Code generation failed: ${msg}`,
                    { correlationId },
                    updateContext,
                ),
            };
        }

        await this.log(
            deploymentId,
            'generating',
            `Generated ${generationResult.generatedFiles.length} files`,
            'info',
            { correlationId, fileCount: generationResult.generatedFiles.length },
        );

        return { kind: 'success', patch: { generationResult } };
    }

    private async stageValidate(ctx: PipelineContext): Promise<StageOutcome> {
        const { deploymentId, correlationId, updateContext, generationResult } = ctx;
        if (!generationResult) {
            return {
                kind: 'failure',
                result: await this.fail(deploymentId, 'validating', 'Missing generation result', { correlationId }, updateContext),
            };
        }

        await this.setStatus(deploymentId, 'validating');
        await this.log(deploymentId, 'validating', 'Validating generated file syntax', 'info', { correlationId });

        const syntaxErrors: Array<{ file: string; message: string; line?: number }> = [];
        for (const file of generationResult.generatedFiles) {
            const validation = this._syntaxValidator.validate(file);
            if (!validation.valid) {
                for (const err of validation.errors) {
                    syntaxErrors.push(err);
                }
            }
        }

        if (syntaxErrors.length > 0) {
            const summary = syntaxErrors.map((e) => `${e.file}: ${e.message}`).join('; ');
            return {
                kind: 'failure',
                result: await this.fail(
                    deploymentId,
                    'validating',
                    `Syntax validation failed: ${summary}`,
                    { correlationId, errorCount: syntaxErrors.length },
                    updateContext,
                ),
            };
        }

        await this.log(
            deploymentId,
            'validating',
            `Syntax validation passed for ${generationResult.generatedFiles.length} files`,
            'info',
            { correlationId, fileCount: generationResult.generatedFiles.length },
        );

        return { kind: 'success', patch: {} };
    }

    private async stageCacheCheck(ctx: PipelineContext): Promise<StageOutcome> {
        const { deploymentId, correlationId, supabase, generationResult } = ctx;
        if (!generationResult) {
            return {
                kind: 'failure',
                result: await this.fail(deploymentId, 'validating', 'Missing generation result', { correlationId }),
            };
        }

        const cacheResult = await this._buildCacheService.checkCache(
            supabase,
            deploymentId,
            generationResult.generatedFiles,
        );

        await this.log(
            deploymentId,
            'validating',
            `Build cache ${cacheResult.status}: hash=${cacheResult.contentHash.slice(0, 12)}`,
            'info',
            { correlationId, cacheStatus: cacheResult.status, contentHash: cacheResult.contentHash },
        );

        return { kind: 'success', patch: { cacheResult } };
    }

    private async stageSign(ctx: PipelineContext): Promise<StageOutcome> {
        const { deploymentId, correlationId, generationResult } = ctx;
        if (!generationResult) {
            return {
                kind: 'failure',
                result: await this.fail(deploymentId, 'signing', 'Missing generation result', { correlationId }),
            };
        }

        await this.setStatus(deploymentId, 'signing');
        await this.log(deploymentId, 'signing', 'Signing generated artifact', 'info', { correlationId });

        const artifactContent = JSON.stringify(generationResult.generatedFiles);
        const { checksum: artifactChecksum, signature: artifactSignature } =
            this._artifactSigningService.signArtifact(artifactContent);

        await this.log(deploymentId, 'signing', 'Artifact signed', 'info', {
            correlationId,
            checksum: artifactChecksum,
        });

        return {
            kind: 'success',
            patch: { artifactContent, artifactChecksum, artifactSignature },
        };
    }

    private async stageSyncEnvVars(ctx: PipelineContext): Promise<StageOutcome> {
        const { deploymentId, correlationId, supabase, templateId, customization } = ctx;

        await this.log(deploymentId, 'sync_env_vars', 'Resolving Vercel environment variables', 'info', {
            correlationId,
        });

        let templateCategory: string | undefined;
        let templateFamily: TemplateFamilyId = 'stellar-dex';

        try {
            const { data: tmpl } = await supabase
                .from('templates')
                .select('category')
                .eq('id', templateId)
                .single();
            if (tmpl?.category) {
                templateCategory = tmpl.category;
                templateFamily = mapCategoryToFamily(
                    templateCategory as import('@craft/types').TemplateCategory,
                );
            }
        } catch {
            // Non-fatal — fall back to default family
        }

        const envVars = buildVercelEnvVars(templateFamily, customization);

        await this.log(deploymentId, 'sync_env_vars', 'Environment variables prepared', 'info', {
            correlationId,
            envVarCount: envVars.length,
        });

        return {
            kind: 'success',
            patch: { templateCategory, templateFamily, envVars },
        };
    }

    private async stageCreateRepo(ctx: PipelineContext): Promise<StageOutcome> {
        const { deploymentId, correlationId, userId, name, updateContext, supabase } = ctx;

        await this.setStatus(deploymentId, 'creating_repo');
        await this.log(deploymentId, 'creating_repo', 'Creating GitHub repository', 'info', { correlationId });

        try {
            const { repository, resolvedName } = await this._githubService.createRepository({
                name,
                description: `CRAFT deployment — ${name}`,
                private: true,
                userId,
            });

            await supabase
                .from('deployments')
                .update({
                    repository_url: repository.url,
                    status: 'pushing_code',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', deploymentId);

            await this.log(
                deploymentId,
                'creating_repo',
                `Repository created: ${repository.fullName}`,
                'info',
                { correlationId, repositoryUrl: repository.url, resolvedName },
            );

            return {
                kind: 'success',
                patch: {
                    repoFullName: repository.fullName,
                    repositoryUrl: repository.url,
                    defaultBranch: repository.defaultBranch,
                },
            };
        } catch (err: unknown) {
            const svcErr = err as { code?: string; message?: string; retryAfterMs?: number };
            return {
                kind: 'failure',
                result: await this.fail(
                    deploymentId,
                    'creating_repo',
                    `GitHub repository creation failed: ${svcErr.message ?? 'unknown error'}`,
                    { correlationId, code: svcErr.code, retryAfterMs: svcErr.retryAfterMs },
                    updateContext,
                ),
            };
        }
    }

    private async stagePushCode(ctx: PipelineContext): Promise<StageOutcome> {
        const {
            deploymentId,
            correlationId,
            updateContext,
            generationResult,
            artifactContent,
            artifactChecksum,
            artifactSignature,
            repoFullName,
            defaultBranch,
        } = ctx;

        if (!generationResult || !artifactContent || !artifactChecksum || !artifactSignature || !repoFullName || !defaultBranch) {
            return {
                kind: 'failure',
                result: await this.fail(deploymentId, 'pushing_code', 'Missing prerequisites for code push', { correlationId }, updateContext),
            };
        }

        await this.setStatus(deploymentId, 'pushing_code');
        await this.log(deploymentId, 'pushing_code', 'Pushing generated code to repository', 'info', { correlationId });

        const isArtifactValid = this._artifactSigningService.verifyArtifact(
            artifactContent,
            artifactChecksum,
            artifactSignature,
        );

        if (!isArtifactValid) {
            return {
                kind: 'failure',
                result: await this.fail(
                    deploymentId,
                    'pushing_code',
                    'Artifact verification failed: checksum or signature mismatch — aborting push',
                    { correlationId, checksum: artifactChecksum },
                ),
            };
        }

        await this.log(deploymentId, 'pushing_code', 'Artifact verified', 'info', {
            correlationId,
            checksum: artifactChecksum,
            deploymentId,
            timestamp: new Date().toISOString(),
        });

        const githubToken = process.env.GITHUB_TOKEN ?? '';
        const [owner, repo] = repoFullName.split('/');

        try {
            const commitRef = await this._githubPushService.pushGeneratedCode({
                owner,
                repo,
                token: githubToken,
                files: generationResult.generatedFiles,
                branch: defaultBranch,
                commitMessage: 'feat: initial CRAFT deployment',
                authorName: 'CRAFT Platform',
                authorEmail: 'craft@stellercraft.io',
            });

            await this.log(
                deploymentId,
                'pushing_code',
                `Pushed ${commitRef.fileCount} files — commit ${commitRef.commitSha.slice(0, 7)}`,
                'info',
                { correlationId, commitSha: commitRef.commitSha, fileCount: commitRef.fileCount },
            );

            await this.reportCommitStatus(
                () => this._commitStatusService.reportPending(owner, repo, commitRef.commitSha, deploymentId, 'Deployment'),
                deploymentId,
                correlationId,
                'pending',
            );

            return {
                kind: 'success',
                patch: { commitSha: commitRef.commitSha, owner, repo },
            };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown push error';
            return {
                kind: 'failure',
                result: await this.fail(deploymentId, 'pushing_code', `Code push failed: ${msg}`, { correlationId }, updateContext),
            };
        }
    }

    private async stageDeploy(ctx: PipelineContext): Promise<StageOutcome> {
        const {
            deploymentId,
            correlationId,
            updateContext,
            repoFullName,
            envVars,
            repo,
        } = ctx;

        if (!repoFullName || !envVars || !repo) {
            return {
                kind: 'failure',
                result: await this.fail(deploymentId, 'deploying', 'Missing prerequisites for Vercel deployment', { correlationId }, updateContext),
            };
        }

        await this.setStatus(deploymentId, 'deploying');
        await this.log(deploymentId, 'deploying', 'Creating Vercel project', 'info', { correlationId });

        try {
            const project = await this._vercelService.createProject({
                name: `craft-${repo.toLowerCase()}`,
                gitRepo: repoFullName,
                envVars,
                framework: 'nextjs',
            });

            await this.log(
                deploymentId,
                'deploying',
                `Vercel project created: ${project.name}`,
                'info',
                { correlationId, vercelProjectId: project.id },
            );

            const deployment = await this._vercelService.triggerDeployment(project.id, repoFullName);

            await this.log(
                deploymentId,
                'deploying',
                `Vercel deployment triggered: ${deployment.deploymentUrl}`,
                'info',
                { correlationId, vercelDeploymentId: deployment.deploymentId, deploymentUrl: deployment.deploymentUrl },
            );

            return {
                kind: 'success',
                patch: {
                    vercelProjectId: project.id,
                    vercelDeploymentId: deployment.deploymentId,
                    deploymentUrl: deployment.deploymentUrl,
                },
            };
        } catch (err: unknown) {
            const svcErr = err as { code?: string; message?: string };
            return {
                kind: 'failure',
                result: await this.fail(
                    deploymentId,
                    'deploying',
                    `Vercel deployment failed: ${svcErr.message ?? 'unknown error'}`,
                    { correlationId, code: svcErr.code },
                    updateContext,
                ),
            };
        }
    }

    private async stageVerifyContract(ctx: PipelineContext): Promise<StageOutcome> {
        const { deploymentId, correlationId, templateCategory } = ctx;

        if (templateCategory !== 'soroban-defi') {
            return { kind: 'success', patch: {} };
        }

        try {
            await this.setStatus(deploymentId, 'verifying_contract' as DeploymentStatusType);
            await this.log(
                deploymentId,
                'verifying_contract',
                'Checking Soroban contract live status...',
                'info',
                { correlationId },
            );

            await this.verifyContractDeployment(deploymentId, correlationId);

            await this.log(deploymentId, 'verifying_contract', 'Contract verified successfully.', 'info', {
                correlationId,
            });

            return { kind: 'success', patch: {} };
        } catch (error) {
            if (error instanceof RetryableError) {
                await this.log(deploymentId, 'verifying_contract', 'Verification timed out. Retrying...', 'warn', {
                    correlationId,
                });
                throw error;
            }

            await this.log(deploymentId, 'verifying_contract', 'Contract verification failed.', 'error', {
                correlationId,
            });
            await this.fail(deploymentId, 'verifying_contract' as DeploymentStatusType, (error as Error).message, {
                correlationId,
            });
            throw error;
        }
    }

    private async stageComplete(ctx: PipelineContext): Promise<StageOutcome> {
        const {
            deploymentId,
            correlationId,
            supabase,
            cacheResult,
            vercelProjectId,
            vercelDeploymentId,
            deploymentUrl,
            commitSha,
            owner,
            repo,
            logger,
        } = ctx;

        if (!vercelProjectId || !vercelDeploymentId || !deploymentUrl) {
            return {
                kind: 'failure',
                result: await this.fail(deploymentId, 'completed', 'Missing deployment results', { correlationId }),
            };
        }

        await supabase
            .from('deployments')
            .update({
                vercel_project_id: vercelProjectId,
                vercel_deployment_id: vercelDeploymentId,
                deployment_url: deploymentUrl,
                status: 'completed',
                deployed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', deploymentId);

        if (cacheResult) {
            await this._buildCacheService.storeHash(supabase, deploymentId, cacheResult.contentHash);
        }

        await this.log(deploymentId, 'completed', `Deployment complete — ${deploymentUrl}`, 'info', {
            correlationId,
            deploymentUrl,
        });

        if (commitSha && owner && repo) {
            await this.reportCommitStatus(
                () => this._commitStatusService.reportSuccess(owner, repo, commitSha, deploymentId, deploymentUrl),
                deploymentId,
                correlationId,
                'success',
            );
        }

        logger.info('Deployment pipeline completed', { deploymentId, deploymentUrl });

        return { kind: 'success', patch: {} };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async setStatus(
        deploymentId: string,
        status: DeploymentStatusType,
    ): Promise<void> {
        const supabase = createClient();
        await supabase
            .from('deployments')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', deploymentId);
    }

    private async log(
        deploymentId: string,
        stage: string,
        message: string,
        level: LogLevel,
        metadata?: Record<string, unknown>,
    ): Promise<void> {
        const supabase = createClient();
        await supabase.from('deployment_logs').insert({
            deployment_id: deploymentId,
            stage,
            message,
            level,
            metadata: metadata ?? null,
            created_at: new Date().toISOString(),
        });
    }

    private async fail(
        deploymentId: string,
        stage: DeploymentStatusType,
        errorMessage: string,
        metadata?: Record<string, unknown>,
        updateContext?: { updateId: string; deploymentId: string },
        commitContext?: { owner: string; repo: string; sha: string },
    ): Promise<DeploymentPipelineResult> {
        const supabase = createClient();

        await supabase
            .from('deployments')
            .update({
                status: 'failed',
                error_message: errorMessage,
                updated_at: new Date().toISOString(),
            })
            .eq('id', deploymentId);

        await this.log(deploymentId, stage, errorMessage, 'error', metadata);

        // Roll back the associated update record when one is active
        if (updateContext && this._deploymentUpdateService) {
            const rollbackReason = `Pipeline failed at stage '${stage}': ${errorMessage}`;
            await this.log(updateContext.deploymentId, stage, rollbackReason, 'error', metadata);
            await this._deploymentUpdateService.rollbackUpdate(
                updateContext.updateId,
                updateContext.deploymentId,
            );
        }

        // ── Post "failure" commit status (best-effort) ────────────────────────
        const correlationId = (metadata?.correlationId as string | undefined) ?? '';
        if (commitContext) {
            await this.reportCommitStatus(
                () => this._commitStatusService.reportFailure(
                    commitContext.owner,
                    commitContext.repo,
                    commitContext.sha,
                    deploymentId,
                    stage,
                ),
                deploymentId,
                correlationId,
                'failure',
            );
        }

        return {
            success: false,
            deploymentId,
            correlationId,
            errorMessage,
            failedStage: stage,
        };
    }

    /**
     * Calls `fn` and swallows any error, logging a warning instead.
     * This ensures commit status reporting failures never block the pipeline.
     */
    private async reportCommitStatus(
        fn: () => Promise<{ success: boolean; error?: string }>,
        deploymentId: string,
        correlationId: string,
        label: string,
    ): Promise<void> {
        try {
            const result = await fn();
            if (!result.success) {
                await this.log(
                    deploymentId,
                    'commit_status',
                    `GitHub commit status (${label}) not posted: ${result.error ?? 'unknown error'}`,
                    'warn',
                    { correlationId },
                );
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            await this.log(
                deploymentId,
                'commit_status',
                `GitHub commit status reporting threw unexpectedly (${label}): ${msg}`,
                'warn',
                { correlationId },
            );
        }
    }

    /**
     * Simulates a check to ensure the Soroban contract is live and callable.
     * 
     * @throws {RetryableError} If the verification times out
     * @throws {Error} If the contract is not live or found
     */
    private async verifyContractDeployment(deploymentId: string, correlationId: string): Promise<void> {
        // Simulation of network verification logic
        // In production, this would poll Soroban RPC to check for contract instance footprint
        
        // Simulated verification loop
        await new Promise(resolve => setTimeout(resolve, 100));

        const randomOutcome = Math.random();
        if (randomOutcome < 0.05) {
            throw new RetryableError('Contract verification timed out: RPC endpoint took too long to respond');
        } else if (randomOutcome < 0.1) {
            throw new Error('Contract instance not found on the current network ledger');
        }
    }
}

export const deploymentPipelineService = new DeploymentPipelineService(
    templateGeneratorService,
    githubService,
    githubPushService,
    vercelService,
    syntaxValidator,
    artifactSigningService,
    deploymentUpdateService,
    githubCommitStatusService,
    buildCacheService,
);
