/**
 * DeploymentUpdateService
 *
 * Handles deployment updates with rollback on failure.
 * 
 * Property 38 (design.md): Failed updates must NOT replace the last known good deployment.
 * When an update fails at any stage, the deployment must rollback to the previous
 * successful state, preserving:
 *   - The active deployment URL
 *   - The deployment configuration
 *   - The status as 'completed' (not 'failed')
 *
 * This service implements a transactional update pattern with automatic rollback.
 */

import { createClient } from '@/lib/supabase/server';
import type { DeploymentStatusType, CustomizationConfig } from '@craft/types';
import type { GeneratedFile } from '@craft/types';
import {
    githubPushService,
    type GitHubCommitReference,
    type GitHubPushService,
} from './github-push.service';
import { parseRepoIdentity } from './github-repository-update.service';

export interface DeploymentUpdate {
    id: string;
    deploymentId: string;
    userId: string;
    newCustomizationConfig: CustomizationConfig;
    status: DeploymentUpdateStatus;
    previousState: DeploymentState | null;
    errorMessage?: string;
    createdAt: Date;
    completedAt?: Date;
}

export type DeploymentUpdateStatus = 
    | 'pending'
    | 'validating'
    | 'generating'
    | 'updating_repo'
    | 'redeploying'
    | 'completed'
    | 'rolled_back'
    | 'failed';

export interface DeploymentState {
    customizationConfig: CustomizationConfig;
    deploymentUrl: string | null;
    vercelDeploymentId: string | null;
    status: DeploymentStatusType;
    repositoryUrl: string | null;
}

export interface UpdateDeploymentRequest {
    deploymentId: string;
    userId: string;
    customizationConfig: CustomizationConfig;
    githubPush?: {
        owner: string;
        repo: string;
        token: string;
        branch: string;
        baseBranch?: string;
        commitMessage?: string;
        generatedFiles: GeneratedFile[];
        authorName?: string;
        authorEmail?: string;
    };
}

export interface UpdateDeploymentResult {
    success: boolean;
    deploymentId: string;
    rolledBack: boolean;
    deploymentUrl?: string;
    commitRef?: GitHubCommitReference;
    errorMessage?: string;
}

interface PipelineExecutionResult {
    success: boolean;
    commitRef?: GitHubCommitReference;
}

export class DeploymentUpdateService {
    constructor(
        private readonly _githubPushService: Pick<GitHubPushService, 'pushGeneratedCode'> = githubPushService
    ) {}

    /**
     * Update a deployment with new customization config.
     * If the update fails, automatically rollback to the previous good state.
     */
    async updateDeployment(request: UpdateDeploymentRequest): Promise<UpdateDeploymentResult> {
        const supabase = createClient();
        const { deploymentId, userId, customizationConfig, githubPush } = request;

        // Create update record
        const updateId = crypto.randomUUID();
        
        try {
            // Step 1: Get current deployment state (the "last known good" state)
            const previousState = await this.getDeploymentState(deploymentId, userId);
            
            if (!previousState) {
                return {
                    success: false,
                    deploymentId,
                    rolledBack: false,
                    errorMessage: 'Deployment not found or access denied',
                };
            }

            // Verify deployment is in completed state (can only update completed deployments)
            if (previousState.status !== 'completed') {
                return {
                    success: false,
                    deploymentId,
                    rolledBack: false,
                    errorMessage: `Cannot update deployment in '${previousState.status}' state`,
                };
            }

            // Create update record with previous state
            await this.createUpdateRecord(updateId, deploymentId, userId, customizationConfig, previousState);

            // Step 2: Validate the new configuration
            await this.validateUpdate(updateId, customizationConfig);

            // Step 3: Simulate update pipeline (in real implementation, this would:
            //         - Generate new code
            //         - Update repository
            //         - Trigger Vercel redeployment
            const pipeline = await this.executeUpdatePipeline(updateId, customizationConfig, githubPush, previousState);

            if (!pipeline.success) {
                throw new Error('Update pipeline failed');
            }

            // Step 4: Update deployment with new config
            await this.finalizeUpdate(deploymentId, customizationConfig);
            await this.markUpdateCompleted(updateId);

            return {
                success: true,
                deploymentId,
                rolledBack: false,
                deploymentUrl: previousState.deploymentUrl ?? undefined,
                commitRef: pipeline.commitRef,
            };

        } catch (error: any) {
            console.error('Deployment update failed, initiating rollback:', error);

            // Step 5: Rollback to previous state
            const rollbackSuccess = await this.rollbackUpdate(updateId, deploymentId);

            return {
                success: false,
                deploymentId,
                rolledBack: rollbackSuccess,
                errorMessage: error.message || 'Deployment update failed',
            };
        }
    }

    /**
     * Get the current state of a deployment
     */
    private async getDeploymentState(
        deploymentId: string,
        userId: string
    ): Promise<DeploymentState | null> {
        const supabase = createClient();

        const { data: deployment, error } = await supabase
            .from('deployments')
            .select('customization_config, deployment_url, vercel_deployment_id, status, repository_url')
            .eq('id', deploymentId)
            .eq('user_id', userId)
            .single();

        if (error || !deployment) {
            return null;
        }

        return {
            customizationConfig: deployment.customization_config as CustomizationConfig,
            deploymentUrl: deployment.deployment_url,
            vercelDeploymentId: deployment.vercel_deployment_id,
            status: deployment.status as DeploymentStatusType,
            repositoryUrl: deployment.repository_url ?? null,
        };
    }

    /**
     * Create an update record for tracking
     */
    private async createUpdateRecord(
        updateId: string,
        deploymentId: string,
        userId: string,
        newConfig: CustomizationConfig,
        previousState: DeploymentState
    ): Promise<void> {
        const supabase = createClient();

        await supabase.from('deployment_updates').insert({
            id: updateId,
            deployment_id: deploymentId,
            user_id: userId,
            new_customization_config: newConfig,
            previous_state: previousState,
            status: 'pending',
            created_at: new Date().toISOString(),
        });
    }

    /**
     * Validate the new customization configuration
     */
    private async validateUpdate(
        updateId: string,
        config: CustomizationConfig
    ): Promise<void> {
        // Update status
        await this.updateUpdateStatus(updateId, 'validating');

        // Basic validation
        if (!config.branding?.appName || config.branding.appName.length === 0) {
            throw new Error('Invalid configuration: appName is required');
        }

        if (!config.stellar?.network || !['mainnet', 'testnet'].includes(config.stellar.network)) {
            throw new Error('Invalid configuration: network must be "mainnet" or "testnet"');
        }
    }

    /**
     * Execute the update pipeline (simulated for testing)
     * This can be configured to fail for property testing
     */
    private async executeUpdatePipeline(
        updateId: string,
        config: CustomizationConfig,
        githubPush?: UpdateDeploymentRequest['githubPush'],
        previousState?: DeploymentState
    ): Promise<PipelineExecutionResult> {
        await this.updateUpdateStatus(updateId, 'generating');
        
        // Simulate code generation
        await this.simulateWork();

        await this.updateUpdateStatus(updateId, 'updating_repo');

        let commitRef: GitHubCommitReference | undefined;
        if (githubPush) {
            commitRef = await this._githubPushService.pushGeneratedCode({
                owner: githubPush.owner,
                repo: githubPush.repo,
                token: githubPush.token,
                files: githubPush.generatedFiles,
                branch: githubPush.branch,
                baseBranch: githubPush.baseBranch,
                commitMessage:
                    githubPush.commitMessage ||
                    `chore: update generated workspace (${new Date().toISOString()})`,
                authorName: githubPush.authorName,
                authorEmail: githubPush.authorEmail,
            });
        } else if (previousState?.repositoryUrl) {
            // Auto-resolve owner/repo from the stored repository URL (reuse logic)
            const { owner, repo } = parseRepoIdentity(previousState.repositoryUrl);
            const token = process.env.GITHUB_TOKEN ?? '';
            commitRef = await this._githubPushService.pushGeneratedCode({
                owner,
                repo,
                token,
                files: [],
                branch: 'main',
                commitMessage: `chore: update generated workspace (${new Date().toISOString()})`,
            });
        } else {
            // Preserve simulated behavior for callers that do not opt into GitHub push.
            await this.simulateWork();
        }

        await this.updateUpdateStatus(updateId, 'redeploying');
        
        // Simulate Vercel redeployment
        await this.simulateWork();

        // For property testing, we use a global flag to simulate failures
        // In production, this would be actual pipeline logic
        const shouldFail = (global as any).__DEPLOYMENT_UPDATE_SHOULD_FAIL === true;
        
        if (shouldFail) {
            return { success: false, commitRef };
        }

        return { success: true, commitRef };
    }

    /**
     * Finalize the update by updating the deployment record
     */
    private async finalizeUpdate(
        deploymentId: string,
        config: CustomizationConfig
    ): Promise<void> {
        const supabase = createClient();

        await supabase
            .from('deployments')
            .update({
                customization_config: config,
                status: 'completed',
                updated_at: new Date().toISOString(),
            })
            .eq('id', deploymentId);
    }

    /**
     * Rollback to the previous deployment state.
     * Idempotent — calling it on an already-rolled-back record is a no-op.
     */
    async rollbackUpdate(
        updateId: string,
        deploymentId: string
    ): Promise<boolean> {
        try {
            const supabase = createClient();

            // Get the previous state from the update record
            const { data: updateRecord } = await supabase
                .from('deployment_updates')
                .select('previous_state, status')
                .eq('id', updateId)
                .single();

            // Idempotency: already rolled back — no-op
            if (updateRecord?.status === 'rolled_back') {
                return true;
            }

            if (!updateRecord?.previous_state) {
                console.error('No previous state found for rollback');
                return false;
            }

            const previousState = updateRecord.previous_state as DeploymentState;

            // Restore the deployment to its previous state
            await supabase
                .from('deployments')
                .update({
                    customization_config: previousState.customizationConfig,
                    deployment_url: previousState.deploymentUrl,
                    vercel_deployment_id: previousState.vercelDeploymentId,
                    status: 'completed', // Ensure it's back to completed state
                    error_message: null, // Clear any error messages
                    updated_at: new Date().toISOString(),
                })
                .eq('id', deploymentId);

            // Mark the update as rolled back
            await this.updateUpdateStatus(updateId, 'rolled_back');

            console.log(`Successfully rolled back deployment ${deploymentId}`);
            return true;
        } catch (error: any) {
            console.error('Rollback failed:', error);
            await this.updateUpdateStatus(updateId, 'failed');
            return false;
        }
    }

    /**
     * Update the status of an update record
     */
    private async updateUpdateStatus(
        updateId: string,
        status: DeploymentUpdateStatus
    ): Promise<void> {
        const supabase = createClient();

        await supabase
            .from('deployment_updates')
            .update({
                status,
                updated_at: new Date().toISOString(),
            })
            .eq('id', updateId);
    }

    /**
     * Mark an update as completed
     */
    private async markUpdateCompleted(updateId: string): Promise<void> {
        const supabase = createClient();

        await supabase
            .from('deployment_updates')
            .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', updateId);
    }

    /**
     * Simulate async work (for pipeline simulation)
     */
    private async simulateWork(): Promise<void> {
        // In real implementation, this would be actual work
        // For testing, we just yield to the event loop
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * Get update history for a deployment
     */
    async getUpdateHistory(deploymentId: string): Promise<Array<{
        id: string;
        status: DeploymentUpdateStatus;
        rolledBack: boolean;
        errorMessage?: string;
        createdAt: Date;
        completedAt?: Date;
    }>> {
        const supabase = createClient();

        const { data, error } = await supabase
            .from('deployment_updates')
            .select('id, status, error_message, created_at, completed_at')
            .eq('deployment_id', deploymentId)
            .order('created_at', { ascending: false });

        if (error) {
            return [];
        }

        return (data || []).map((record: any) => ({
            id: record.id,
            status: record.status as DeploymentUpdateStatus,
            rolledBack: record.status === 'rolled_back',
            errorMessage: record.error_message ?? undefined,
            createdAt: new Date(record.created_at),
            completedAt: record.completed_at ? new Date(record.completed_at) : undefined,
        }));
    }
}

// Export singleton instance
export const deploymentUpdateService = new DeploymentUpdateService();
