import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { githubService } from '@/services/github.service';
import { vercelService } from '@/services/vercel.service';
import { resolveIpAddress } from '@/lib/api/logger';

export const GET = withAuth(async (req: NextRequest, { params, user, supabase, log }) => {
    const deploymentId = (params as { id: string }).id;
    const ipAddress = resolveIpAddress(req);

    // Fetch deployment with ownership check — return 404 for both missing and non-owned
    // deployments to prevent existence leakage (issue spec: non-owners receive 404, not 403).
    const { data: deployment, error: fetchError } = await supabase
        .from('deployments')
        .select('*')
        .eq('id', deploymentId)
        .single();

    if (fetchError || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Emit audit log for reading deployment with PII (customization_config may contain env vars)
    log.audit({
        userId: user.id,
        action: 'deployment.read',
        resourceId: deploymentId,
        resourceType: 'deployment',
        ipAddress,
        metadata: {
            fields: ['customization_config'],
        },
    });

    // Build normalized response with deployment metadata, provider identifiers, and URLs
    const response = {
        id: deployment.id,
        name: deployment.name,
        status: deployment.status,
        templateId: deployment.template_id,
        vercelProjectId: deployment.vercel_project_id,
        deploymentUrl: deployment.deployment_url,
        repositoryUrl: deployment.repository_url,
        customizationConfig: deployment.customization_config,
        errorMessage: deployment.error_message,
        timestamps: {
            created: deployment.created_at,
            updated: deployment.updated_at,
            deployed: deployment.deployed_at,
        },
    };

    return NextResponse.json(response);
});

export const DELETE = withAuth(async (req: NextRequest, { params, user, supabase, log }) => {
    const deploymentId = (params as { id: string }).id;
    const ipAddress = resolveIpAddress(req);

    // Fetch deployment with ownership check — return 404 for both missing and non-owned
    // deployments to prevent existence leakage (issue spec: non-owners receive 404, not 403).
    const { data: deployment, error: fetchError } = await supabase
        .from('deployments')
        .select('user_id, repository_url, vercel_project_id')
        .eq('id', deploymentId)
        .single();

    if (fetchError || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Emit audit log for deployment deletion (includes PII via customization_config)
    log.audit({
        userId: user.id,
        action: 'deployment.delete',
        resourceId: deploymentId,
        resourceType: 'deployment',
        ipAddress,
        metadata: {
            repository_url: deployment.repository_url,
            vercel_project_id: deployment.vercel_project_id,
        },
    });

    // Best-effort cleanup of external resources before DB deletion.
    // Errors are logged but don't block the deployment record deletion.

    // Delete GitHub repository if it exists
    if (deployment.repository_url) {
        try {
            // Extract owner/repo from GitHub URL (e.g., https://github.com/owner/repo)
            const urlMatch = deployment.repository_url.match(/github\.com\/([^/]+)\/([^/]+)/);
            if (urlMatch) {
                const [, owner, repo] = urlMatch;
                await githubService.deleteRepository(owner, repo);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            log.error(`GitHub cleanup failed for ${deploymentId}`, error);
            // Continue — DB deletion should succeed regardless
        }
    }

    // Delete Vercel project if it exists
    if (deployment.vercel_project_id) {
        try {
            await vercelService.deleteProject(deployment.vercel_project_id);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Vercel cleanup failed for ${deploymentId}`, error);
            // Continue — DB deletion should succeed regardless
        }
    }

    // Delete deployment record (cascades to deployment_logs and deployment_analytics)
    const { error: deleteError } = await supabase
        .from('deployments')
        .delete()
        .eq('id', deploymentId);

    if (deleteError) {
        log.error(`Database deletion failed for ${deploymentId}`, deleteError);
        return NextResponse.json(
            { error: 'Failed to delete deployment' },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        deploymentId,
    });

  export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }) 
  {
      try {
        const deploymentId = params.id;

    // 1. Fetch the deployment to get the github_repo_id before deleting
    const deployment = await DeploymentService.findById(deploymentId);
    
    if (!deployment) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // 2. Soft-delete the DB row
    await DeploymentService.softDelete(deploymentId);

    // 3. Trigger GitHub Repo Cleanup (Non-fatal)
    if (deployment.github_repo_id) {
      try {
        // Run cleanup asynchronously or await it, but catch errors locally
        await RepositoryCleanupService.cleanup(deployment.github_repo_id);
      } catch (githubError) {
        // Acceptance Criteria: Treat GitHub API errors as non-fatal — log and continue
        console.error(`[Non-Fatal] Failed to cleanup GitHub repo ${deployment.github_repo_id} for deployment ${deploymentId}:`, githubError);
      }
    }

    return NextResponse.json({ success: true, message: 'Deployment deleted' });
  } catch (error) {
    console.error('Failed to delete deployment:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
      }

});
