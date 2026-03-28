import { createClient } from '@/lib/supabase/server';
import { githubService } from './github.service';
import { githubPushService } from './github-push.service';
import { templateGeneratorService } from './template-generator.service';
import type { 
    DeploymentRequest, 
    DeploymentResult, 
    DeploymentStatusType 
} from '@craft/types';

export class DeploymentService {
    async createDeployment(request: DeploymentRequest): Promise<DeploymentResult> {
        const supabase = createClient();
        const deploymentId = crypto.randomUUID();

        // 1. Initial State
        await supabase.from('deployments').insert({
            id: deploymentId,
            user_id: request.userId,
            template_id: request.templateId,
            name: request.repositoryName,
            customization_config: request.customization,
            status: 'pending' as DeploymentStatusType,
            is_active: true,
        });

        this.logProgress(deploymentId, 'pending', 'Deployment started');

        try {
            // 2. Generate Code
            await this.updateStatus(deploymentId, 'generating');
            const generation = await templateGeneratorService.generate({
                templateId: request.templateId,
                customization: request.customization,
                outputPath: `/tmp/craft-${deploymentId}`
            });

            if (!generation.success) {
                throw new Error('Code generation failed');
            }

            // 3. Create Repo
            await this.updateStatus(deploymentId, 'creating_repo');
            const repoConfig = await githubService.createRepository({
                name: request.repositoryName,
                private: true,
                userId: request.userId,
                description: `Created by CRAFT platform`
            });

            const repositoryUrl = repoConfig.repository.url;

            // 4. Push Code
            await this.updateStatus(deploymentId, 'pushing_code');
            const token = process.env.GITHUB_TOKEN || 'mock-token';
            await githubPushService.pushGeneratedCode({
                owner: process.env.GITHUB_ORG || request.userId,
                repo: repoConfig.resolvedName,
                token,
                files: generation.generatedFiles,
                branch: 'main',
                commitMessage: 'Initial deployment via CRAFT'
            });

            // 5. Deploy to Vercel (Simulated per issue description requirements)
            await this.updateStatus(deploymentId, 'deploying');
            const vercelUrl = `https://${repoConfig.resolvedName}.vercel.app`;
            
            // For property testing / mock simulation
            if ((globalThis as any).__VERCEL_DEPLOY_SHOULD_FAIL) {
                throw new Error('Vercel deployment failed');
            }

            // 6. Complete
            await supabase.from('deployments').update({
                status: 'completed' as DeploymentStatusType,
                repository_url: repositoryUrl,
                deployment_url: vercelUrl,
                deployed_at: new Date().toISOString()
            }).eq('id', deploymentId);

            this.logProgress(deploymentId, 'completed', 'Deployment successful');

            return {
                deploymentId,
                repositoryUrl,
                vercelUrl,
                status: { stage: 'completed', url: vercelUrl }
            };

        } catch (error: any) {
            await supabase.from('deployments').update({
                status: 'failed' as DeploymentStatusType,
                error_message: error.message
            }).eq('id', deploymentId);

            this.logProgress(deploymentId, 'failed', `Deployment failed: ${error.message}`);
            
            throw error;
        }
    }

    async deleteDeployment(deploymentId: string, userId: string): Promise<boolean> {
        const supabase = createClient();
        
        // Ensure user owns deployment
        const { data, error } = await supabase.from('deployments')
            .select('id')
            .eq('id', deploymentId)
            .eq('user_id', userId)
            .single();
            
        if (error || !data) {
            return false;
        }

        // Delete from deployments table
        await supabase.from('deployments').delete().eq('id', deploymentId);
        
        // Log deletion (could be in deployment_logs or audits)
        this.logProgress(deploymentId, 'deleted', 'Deployment deleted successfully');
        
        return true;
    }

    private async updateStatus(deploymentId: string, status: DeploymentStatusType) {
        const supabase = createClient();
        await supabase.from('deployments').update({ status }).eq('id', deploymentId);
        this.logProgress(deploymentId, status, `Deployment ${status}`);
    }

    private async logProgress(deploymentId: string, stage: string, message: string) {
        const supabase = createClient();
        await supabase.from('deployment_logs').insert({
            id: crypto.randomUUID(),
            deployment_id: deploymentId,
            stage,
            message,
            log_level: stage === 'failed' ? 'error' : 'info',
            created_at: new Date().toISOString()
        });
    }
}

export const deploymentService = new DeploymentService();
