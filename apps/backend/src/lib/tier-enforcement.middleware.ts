/**
 * Subscription Tier Enforcement Middleware
 *
 * Centralises feature-gate evaluation. Reads the user's current tier fresh
 * from Supabase on every request (not from the JWT cache) so in-flight
 * upgrades are reflected immediately.
 *
 * Usage:
 *   export const GET = withTierEnforcement('pro', handler);
 *
 * Returns 402 Payment Required with an upgrade URL when the user's tier
 * is below the required minimum.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createLogger, resolveCorrelationId } from '@/lib/api/logger';
import type { SubscriptionTier } from '@craft/types';

// ── Tier ordering ─────────────────────────────────────────────────────────────

const TIER_ORDER: Record<SubscriptionTier, number> = {
    free: 0,
    pro: 1,
    enterprise: 2,
};

// ── Feature gate config ───────────────────────────────────────────────────────

/**
 * Declarative map from route-pattern substrings to the minimum required tier.
 * Consumed by callers to know which tier to pass to withTierEnforcement.
 */
export const FEATURE_GATES: Record<string, SubscriptionTier> = {
    '/api/deployments/analytics': 'pro',
    '/api/deployments/domains': 'pro',
    '/api/branding': 'pro',
    '/api/admin': 'enterprise',
};

// ── Middleware ────────────────────────────────────────────────────────────────

type RouteHandler<TParams = {}> = (
    req: NextRequest,
    ctx: { params: TParams }
) => Promise<NextResponse>;

/**
 * Wraps a route handler with a tier check.
 *
 * Re-reads the user's subscription_tier from the profiles table on every
 * invocation to reflect in-flight upgrades within <5 ms (single indexed
 * SELECT on a small row).
 *
 * Returns 401 if unauthenticated.
 * Returns 402 with an upgradeUrl if the user's tier is below requiredTier.
 */
export function withTierEnforcement<TParams = {}>(
    requiredTier: SubscriptionTier,
    handler: RouteHandler<TParams>
): RouteHandler<TParams> {
    return async (req: NextRequest, ctx: { params: TParams }): Promise<NextResponse> => {
        const supabase = createClient();

        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Re-read tier from DB — intentionally not trusting the JWT claim.
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('subscription_tier')
            .eq('id', user.id)
            .single();

        if (profileError) {
            const correlationId = resolveCorrelationId(req);
            const log = createLogger({ correlationId, userId: user.id });
            log.error('Database error during subscription tier lookup; failing closed to free tier', profileError, {
                path: req.nextUrl?.pathname || req.url,
                method: req.method,
                requiredTier,
                errorMessage: profileError.message,
            });
        }

        const userTier = (profile?.subscription_tier ?? 'free') as SubscriptionTier;

        if (TIER_ORDER[userTier] < TIER_ORDER[requiredTier]) {
            return NextResponse.json(
                {
                    error: `This feature requires a ${requiredTier} subscription or higher.`,
                    upgradeUrl: '/pricing',
                },
                { status: 402 }
            );
        }

        return handler(req, ctx);
    };
}
