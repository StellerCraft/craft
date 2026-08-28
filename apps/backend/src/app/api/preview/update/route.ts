import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { validateCustomizationConfig } from '@/lib/customization/validate';
import { previewService } from '@/services/preview.service';
<<<<<<< HEAD
import { costEstimationService, PricingTier } from '@/services/billing/cost-estimation.service';
=======
import { costEstimationService } from '@/services/billing/cost-estimation.service';
>>>>>>> d855263 (feat(cost-estimation): implement deployment cost estimation and complexity scoring)
import type { CustomizationConfig, DeepPartial } from '@craft/types';

function mapSubscriptionTier(tier?: string): PricingTier {
    if (tier === 'pro') return 'standard';
    if (tier === 'enterprise') return 'premium';
    return 'basic';
}

/**
 * POST /api/preview/update
 * Updates preview with partial customization changes.
 * Expects { current, changes } where changes is DeepPartial<CustomizationConfig>.
 * Returns minimal update payload with changedFields and optional mockData.
 */
export const POST = withAuth(async (req: NextRequest, { user, supabase }) => {
    let body: { current?: unknown; changes?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.current || !body.changes) {
        return NextResponse.json(
            { error: 'Missing required fields: current, changes' },
            { status: 400 }
        );
    }

    // Validate current config
    const currentValidation = validateCustomizationConfig(body.current);
    if (!currentValidation.valid) {
        return NextResponse.json(
            { error: 'Invalid current customization config', details: currentValidation.errors },
            { status: 422 }
        );
    }

    const current = body.current as CustomizationConfig;
    const changes = body.changes as DeepPartial<CustomizationConfig>;

    try {
        const payload = previewService.updatePreview(current, changes);
<<<<<<< HEAD

        // Fetch user profile to get subscription tier
        const { data: profile } = await supabase
            .from('profiles')
            .select('subscription_tier')
            .eq('id', user.id)
            .single();

        const pricingTier = mapSubscriptionTier(profile?.subscription_tier);
        const estimatedCost = costEstimationService.calculateComplexityScore(
            payload.customization,
            pricingTier
        );

        return NextResponse.json({
            ...payload,
            estimatedCost
=======
        const estimate = costEstimationService.estimateDeploymentCost({
            customizationConfig: payload.customization,
        });

        return NextResponse.json({
            ...payload,
            estimate,
            costEstimate: estimate,
>>>>>>> d855263 (feat(cost-estimation): implement deployment cost estimation and complexity scoring)
        }, { status: 200 });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || 'Failed to update preview' },
            { status: 500 }
        );
    }
});
