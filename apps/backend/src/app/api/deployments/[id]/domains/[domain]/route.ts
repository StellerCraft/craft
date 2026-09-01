/**
 * DELETE /api/deployments/[id]/domains/[domain]
 *
 * Removes a custom domain from a deployment: deletes it from the Vercel
 * project and clears the custom_domain field in the database when it matches.
 *
 * Authentication & ownership:
 *   Requires a valid session (401) and ownership of the deployment (403).
 *
 * Responses:
 *   200 — Domain removed successfully; includes `aliasesMatched` count
 *   404 — Deployment not found or no Vercel project configured
 *   401 — Not authenticated
 *   403 — Not authorized for this deployment
 *   500 — Unexpected error
 *
 * Feature: domain-deletion
 */

import { NextRequest, NextResponse } from 'next/server';
import { withDeploymentAuth } from '@/lib/api/with-auth';
import { VercelDomainLifecycleService } from '@/services/vercel-domain-lifecycle.service';

const lifecycleService = new VercelDomainLifecycleService();

export const DELETE = withDeploymentAuth<{ id: string; domain: string }>(
    async (_req: NextRequest, { params, supabase }) => {
        const { data: deployment, error } = await supabase
            .from('deployments')
            .select('vercel_project_id, custom_domain')
            .eq('id', params.id)
            .single();

        if (error || !deployment) {
            return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
        }

        if (!deployment.vercel_project_id) {
            return NextResponse.json(
                { error: 'No Vercel project configured for this deployment' },
                { status: 404 },
            );
        }

        const result = await lifecycleService.removeDomainWithCleanup(
            params.domain,
            deployment.vercel_project_id,
        );

        if (!result.success) {
            return NextResponse.json(
                { error: result.partialFailureReason ?? 'Failed to remove domain' },
                { status: 500 },
            );
        }

        // Clear the stored custom_domain if it matches the deleted domain
        if (deployment.custom_domain === params.domain) {
            await supabase
                .from('deployments')
                .update({ custom_domain: null })
                .eq('id', params.id);
        }

        return NextResponse.json({
            domain: params.domain,
            deleted: true,
            aliasesMatched: result.aliasesMatched,
            ...(result.partialFailure && {
                partialFailure: true,
                partialFailureReason: result.partialFailureReason,
            }),
        });
    },
);
