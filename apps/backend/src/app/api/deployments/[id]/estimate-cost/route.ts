import { NextRequest, NextResponse } from 'next/server';
<<<<<<< HEAD
import { withAuth } from '@/lib/api/with-auth';
import { costEstimationService, PricingTier } from '@/services/billing/cost-estimation.service';

function mapSubscriptionTier(tier?: string): PricingTier {
    if (tier === 'pro') return 'standard';
    if (tier === 'enterprise') return 'premium';
    return 'basic';
}

export const GET = withAuth(async (req: NextRequest, { params, user, supabase, log }) => {
    const deploymentId = (params as { id: string }).id;

    // Fetch deployment
    const { data: deployment, error: fetchError } = await supabase
        .from('deployments')
        .select('*, templates(category)')
        .eq('id', deploymentId)
        .is('deleted_at', null)
        .single();

    if (fetchError || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Fetch user profile to get subscription tier
    const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier')
        .eq('id', user.id)
        .single();

    const pricingTier = mapSubscriptionTier(profile?.subscription_tier);
    const category = (deployment.templates as any)?.category;

    const estimatedCost = costEstimationService.calculateComplexityScore(
        deployment.customization_config,
        pricingTier,
        {
            // Optional: read options if passed via query params
            sorobanInvocations: req.nextUrl.searchParams.has('sorobanInvocations') 
                ? Number(req.nextUrl.searchParams.get('sorobanInvocations')) 
                : undefined,
            vercelComputeUsageSeconds: req.nextUrl.searchParams.has('vercelComputeUsageSeconds')
                ? Number(req.nextUrl.searchParams.get('vercelComputeUsageSeconds'))
                : undefined,
        }
    );

    return NextResponse.json({
        deploymentId,
        estimatedCost,
        pricingTier,
        formula: 'base_cost + N * soroban_invocation_cost + M * feature_cost'
    });
});
=======
import { withDeploymentAuth } from '@/lib/api/with-auth';
import { costEstimationService } from '@/services/billing/cost-estimation.service';

export const GET = withDeploymentAuth(async (req: NextRequest, { params, supabase }) => {
    const deploymentId = params.id;

    const { data: deployment, error } = await supabase
        .from('deployments')
        .select('customization_config, template_id')
        .eq('id', deploymentId)
        .single();

    if (error || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    const estimate = costEstimationService.estimateDeploymentCost({
        customizationConfig: deployment.customization_config ?? undefined,
        sorobanInvocationCount: getSorobanInvocationCount(deployment.customization_config),
        vercelComputeUnits: getComputeUnits(deployment.customization_config),
    });

    return NextResponse.json({
        deploymentId,
        estimate,
        costEstimate: estimate,
    });
});

function getSorobanInvocationCount(customizationConfig: Record<string, any> | null | undefined): number {
    const stellar = customizationConfig?.stellar ?? {};
    const contractAddresses = stellar.contractAddresses ?? {};
    return Object.keys(contractAddresses).length;
}

function getComputeUnits(customizationConfig: Record<string, any> | null | undefined): number {
    const features = customizationConfig?.features ?? {};
    const enabledFeatureCount = Object.values(features).filter(Boolean).length;
    return 0.5 + enabledFeatureCount * 0.25;
}
>>>>>>> d855263 (feat(cost-estimation): implement deployment cost estimation and complexity scoring)
