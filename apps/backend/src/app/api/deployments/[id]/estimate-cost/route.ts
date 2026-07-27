import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '../../../../../lib/api/with-auth';
import { costEstimationService, type PricingTier } from '../../../../../services/billing/cost-estimation.service';
import type { CustomizationConfig } from '@craft/types';

export const GET = withAuth(async (req: NextRequest, { params, user, supabase }) => {
    const deploymentId = (params as { id: string }).id;
    const searchParams = (req as any).nextUrl?.searchParams ?? new URL((req as any).url || 'http://localhost', 'http://localhost').searchParams;
    const tierParam = searchParams.get('tier');
    const tier = (tierParam === 'basic' || tierParam === 'standard' || tierParam === 'premium'
        ? tierParam
        : 'standard') as PricingTier;

    const vercelComputeHoursParam = searchParams.get('vercelComputeHours');
    const vercelComputeHours = vercelComputeHoursParam ? Number(vercelComputeHoursParam) : 0;

    const { data: deployment, error: fetchError } = await supabase
        .from('deployments')
        .select('user_id, customization_config')
        .eq('id', deploymentId)
        .is('deleted_at', null)
        .single();

    if (fetchError || !deployment) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    if (deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    const customizationConfig = deployment.customization_config as CustomizationConfig;
    const estimate = costEstimationService.estimateDeploymentCost({
        customizationConfig,
        tier,
        vercelComputeHours: Number.isFinite(vercelComputeHours) ? vercelComputeHours : 0,
    });

    return NextResponse.json({
        deploymentId,
        tier,
        estimate,
    });
});
