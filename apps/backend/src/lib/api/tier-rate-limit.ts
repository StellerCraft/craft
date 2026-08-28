import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitKey, type RateLimitConfig } from './rate-limit';
import { createClient } from '@/lib/supabase/server';

/**
 * Multi-Tier Rate Limiting with Sliding Window
 *
 * Applies different rate limits based on user subscription tier.
 * Sensitive endpoints get stricter limits regardless of tier.
 *
 * Tier Configuration:
 *   - free: 100 req/min general, 10 req/min sensitive
 *   - pro: 1000 req/min general, 100 req/min sensitive
 *   - enterprise: 10000 req/min general, 1000 req/min sensitive
 *
 * Sensitive endpoints: auth, payments, deployments
 *
 * ── Shared store (#1147 audit) ─────────────────────────────────────────────
 *
 * withTierRateLimit delegates to checkRateLimit() from rate-limit.ts. Both
 * middlewares therefore share the same module-level in-memory `store` (a
 * Map<key, timestamps[]>).  Consequently:
 *
 *   - A rejection from withTierRateLimit increments the shared store entry.
 *   - Wrapping the SAME route with BOTH withTierRateLimit AND withRateLimit
 *     (or calling checkRateLimit directly in the same handler) would cause
 *     a rejected request to consume quota in both limiters simultaneously —
 *     double-counting the hit.
 *
 * Audit result (apps/backend/src/app/api — 2026-08-28):
 *   No route currently applies both withTierRateLimit AND withRateLimit /
 *   checkRateLimit to the same request path.  Routes audited:
 *     - auth/signin, auth/signup, auth/reset-password: withRateLimit only
 *     - deployments/route: checkDeploymentRateLimit only (own store)
 *     - payments/checkout: withAuth only, no plain rate limit
 *     - error-reports/route: withRateLimit only
 *   No double-wrapped routes were found.
 *
 * IMPORTANT: To preserve this invariant, do NOT add withRateLimit or a direct
 * checkRateLimit call to any route that already uses withTierRateLimit, and
 * vice-versa.  If quota isolation between the two middlewares is required in
 * the future, introduce a second, independent store (or a namespaced key
 * prefix) before combining them on the same route.
 */

export interface TierRateLimitConfig {
  free: RateLimitConfig;
  pro: RateLimitConfig;
  enterprise: RateLimitConfig;
}

const GENERAL_TIER_LIMITS: TierRateLimitConfig = {
  free: { limit: 100, windowMs: 60 * 1000 },
  pro: { limit: 1000, windowMs: 60 * 1000 },
  enterprise: { limit: 10000, windowMs: 60 * 1000 },
};

const SENSITIVE_TIER_LIMITS: TierRateLimitConfig = {
  free: { limit: 10, windowMs: 60 * 1000 },
  pro: { limit: 100, windowMs: 60 * 1000 },
  enterprise: { limit: 1000, windowMs: 60 * 1000 },
};

/**
 * Identify if an endpoint is sensitive (stricter limits)
 */
function isSensitiveEndpoint(route: string): boolean {
  const sensitivePatterns = [
    'auth',
    'payments',
    'checkout',
    'subscription',
    'deployments/create',
  ];
  return sensitivePatterns.some((pattern) =>
    route.toLowerCase().includes(pattern)
  );
}

/**
 * Get user subscription tier from the database.
 * Anonymous users get 'free' tier.
 */
async function getUserTier(req: NextRequest): Promise<'free' | 'pro' | 'enterprise'> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return 'free';
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', user.id)
      .single();

    return (profile?.subscription_tier ?? 'free') as 'free' | 'pro' | 'enterprise';
  } catch (err) {
    // On any error, fall back to free tier (conservative)
    return 'free';
  }
}

/**
 * Wrap a route handler with tier-based rate limiting.
 * Applies stricter limits to sensitive endpoints.
 *
 * Usage:
 *   export const POST = withTierRateLimit('api/deployments')(handler);
 */
export function withTierRateLimit<TParams = {}>(routeKey: string) {
  return (
    handler: (
      req: NextRequest,
      ctx: { params: TParams }
    ) => Promise<NextResponse>
  ) => {
    return async (req: NextRequest, ctx: { params: TParams }) => {
      if (process.env.RATE_LIMIT_DISABLED === 'true') {
        return handler(req, ctx);
      }

      const tier = await getUserTier(req);
      const isSensitive = isSensitiveEndpoint(routeKey);
      const tierLimits = isSensitive ? SENSITIVE_TIER_LIMITS : GENERAL_TIER_LIMITS;
      const config = tierLimits[tier];

      const key = getRateLimitKey(req, routeKey);
      const result = checkRateLimit(key, config);

      const rateLimitHeaders = {
        'X-RateLimit-Limit': String(config.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
        'X-RateLimit-Tier': tier,
      };

      if (!result.allowed) {
        return NextResponse.json(
          {
            error: 'Too many requests. Please try again later.',
            retryAfterMs: result.retryAfterMs,
            resetAt: result.resetAt,
            tier,
          },
          {
            status: 429,
            headers: {
              ...rateLimitHeaders,
              'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
            },
          }
        );
      }

      const response = await handler(req, ctx);

      Object.entries(rateLimitHeaders).forEach(([k, v]) => response.headers.set(k, v));

      return response;
    };
  };
}
