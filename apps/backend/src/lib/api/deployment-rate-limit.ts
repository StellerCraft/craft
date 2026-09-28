/**
 * Supabase-backed sliding window rate limiter, generalized for reuse across
 * expensive/abuse-prone operations (deployment creation today; bulk domain
 * attachment, repository re-push, etc. tomorrow).
 *
 * Algorithm
 * ─────────
 * Each request is logged as a row in `deployment_rate_limit_requests`.
 * To check the limit, we count rows in the last windowMs for that key.
 * This is a true sliding window — no fixed epoch alignment.
 *
 * Escalation
 * ──────────
 * When a caller is rejected, their hit count is incremented in
 * `deployment_rate_limit_escalations`. If they accumulate ≥ 3 rejections
 * within the same window their effective limit is halved for the next window.
 *
 * Per-operation isolation
 * ────────────────────────
 * Both tables are keyed per-operation, not just per-user: the row key is
 * `<keyPrefix>:<userId>` (or bare `userId` when no prefix is configured, the
 * default for the original deployment-creation limiter). Two limiter
 * instances with different `keyPrefix`es never share a counter, even though
 * they read/write the same two tables.
 *
 * Default per-tier limits (requests per hour) — used by the deployment-
 * creation call site via `checkDeploymentRateLimit`:
 *   free       :  10 / hr
 *   pro        :  50 / hr
 *   enterprise : 500 / hr
 *
 * Tables required (migrations must exist):
 *   deployment_rate_limit_requests (id uuid PK, user_id text, created_at timestamptz)
 *   deployment_rate_limit_escalations (user_id text PK, hit_count int, window_start timestamptz)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SubscriptionTier } from '@craft/types';

export const WINDOW_MS = 60 * 60 * 1_000; // 1 hour in ms

export const TIER_HOURLY_LIMITS: Record<SubscriptionTier, number> = {
    free: 10,
    pro: 50,
    enterprise: 500,
};

export const ESCALATION_THRESHOLD = 3;
export const ESCALATION_REDUCTION = 0.5;

export interface SlidingWindowResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfterSeconds: number;
    escalated: boolean;
    limit: number;
}

export interface RateLimiterOptions {
    /** Sliding window size in ms. Default: WINDOW_MS (1 hour). */
    windowMs?: number;
    /** Per-tier request budget within the window. Default: TIER_HOURLY_LIMITS. */
    maxRequests?: Record<SubscriptionTier, number>;
    /**
     * Scopes this limiter's counters to their own key so different call
     * sites sharing the same two tables never cross-talk. Omit for the
     * original, unscoped deployment-creation behavior.
     */
    keyPrefix?: string;
}

export interface DeploymentStyleRateLimiter {
    windowMs: number;
    maxRequests: Record<SubscriptionTier, number>;
    keyPrefix?: string;
    /**
     * Check and (on success) record a request for the given user.
     *
     * The caller is responsible for providing a Supabase client that is
     * already authenticated or bypasses RLS for these tables (service-role
     * in prod).
     */
    check(supabase: SupabaseClient, userId: string, tier: SubscriptionTier): Promise<SlidingWindowResult>;
}

/**
 * Create a sliding-window rate limiter with its own window/threshold and an
 * independent counter namespace (via `keyPrefix`).
 *
 * @example
 * ```typescript
 * const bulkDomainAttachLimiter = createDeploymentStyleRateLimiter({
 *   windowMs: 10 * 60 * 1_000,
 *   maxRequests: { free: 5, pro: 25, enterprise: 250 },
 *   keyPrefix: 'bulk-domain-attach',
 * });
 *
 * const result = await bulkDomainAttachLimiter.check(supabase, user.id, tier);
 * ```
 */
export function createDeploymentStyleRateLimiter(
    options: RateLimiterOptions = {},
): DeploymentStyleRateLimiter {
    const windowMs = options.windowMs ?? WINDOW_MS;
    const maxRequests = options.maxRequests ?? TIER_HOURLY_LIMITS;
    const keyPrefix = options.keyPrefix;

    const scopedKey = (userId: string): string => (keyPrefix ? `${keyPrefix}:${userId}` : userId);

    return {
        windowMs,
        maxRequests,
        keyPrefix,
        check: (supabase, userId, tier) =>
            checkRateLimit(supabase, scopedKey(userId), maxRequests[tier], windowMs),
    };
}

/** The original deployment-creation limiter, preserving today's window/threshold and unscoped key. */
const deploymentCreationRateLimiter = createDeploymentStyleRateLimiter();

/**
 * Check and (on success) record a deployment-creation request for the given
 * user. Thin wrapper around `deploymentCreationRateLimiter` kept for
 * call-site compatibility.
 */
export async function checkDeploymentRateLimit(
    supabase: SupabaseClient,
    userId: string,
    tier: SubscriptionTier,
): Promise<SlidingWindowResult> {
    return deploymentCreationRateLimiter.check(supabase, userId, tier);
}

async function checkRateLimit(
    supabase: SupabaseClient,
    key: string,
    baseLimit: number,
    windowMs: number,
): Promise<SlidingWindowResult> {
    const now = Date.now();
    const windowStart = new Date(now - windowMs).toISOString();

    // ── 1. Check escalation ─────────────────────────────────────────────────
    const escalated = await isEscalated(supabase, key, now, windowMs);
    const effectiveLimit = escalated ? Math.floor(baseLimit * ESCALATION_REDUCTION) : baseLimit;

    // ── 2. Count requests in the current sliding window ─────────────────────
    const { count, error: countError } = await supabase
        .from('deployment_rate_limit_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', key)
        .gte('created_at', windowStart);

    if (countError) {
        // On DB error, fail open to avoid blocking legitimate users
        return {
            allowed: true,
            remaining: effectiveLimit,
            resetAt: now + windowMs,
            retryAfterSeconds: 0,
            escalated,
            limit: effectiveLimit,
        };
    }

    const requestCount = count ?? 0;
    const allowed = requestCount < effectiveLimit;

    if (allowed) {
        // ── 3a. Log the request ─────────────────────────────────────────────
        await supabase.from('deployment_rate_limit_requests').insert({
            user_id: key,
            created_at: new Date(now).toISOString(),
        });

        return {
            allowed: true,
            remaining: effectiveLimit - requestCount - 1,
            resetAt: now + windowMs,
            retryAfterSeconds: 0,
            escalated,
            limit: effectiveLimit,
        };
    }

    // ── 3b. Rejected — increment escalation counter ─────────────────────────
    await recordEscalationHit(supabase, key, now, windowMs);

    // Oldest request in window defines when the window next frees a slot
    const { data: oldest } = await supabase
        .from('deployment_rate_limit_requests')
        .select('created_at')
        .eq('user_id', key)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    const oldestMs = oldest?.created_at ? new Date(oldest.created_at).getTime() : now;
    const resetAt = oldestMs + windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1_000));

    return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterSeconds,
        escalated,
        limit: effectiveLimit,
    };
}

async function isEscalated(
    supabase: SupabaseClient,
    key: string,
    nowMs: number,
    windowMs: number,
): Promise<boolean> {
    const { data } = await supabase
        .from('deployment_rate_limit_escalations')
        .select('hit_count, window_start')
        .eq('user_id', key)
        .single();

    if (!data) return false;

    // Escalation window expired — reset
    if (data.window_start && new Date(data.window_start).getTime() < nowMs - windowMs) {
        return false;
    }

    return (data.hit_count ?? 0) >= ESCALATION_THRESHOLD;
}

async function recordEscalationHit(
    supabase: SupabaseClient,
    key: string,
    nowMs: number,
    windowMs: number,
): Promise<void> {
    const windowStart = new Date(nowMs - windowMs).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    const { data: existing } = await supabase
        .from('deployment_rate_limit_escalations')
        .select('hit_count, window_start')
        .eq('user_id', key)
        .single();

    if (!existing || new Date(existing.window_start).getTime() < nowMs - windowMs) {
        // First hit in this window (or window expired) — start fresh
        await supabase
            .from('deployment_rate_limit_escalations')
            .upsert({
                user_id: key,
                hit_count: 1,
                window_start: windowStart,
                updated_at: nowIso,
            });
    } else {
        await supabase
            .from('deployment_rate_limit_escalations')
            .update({
                hit_count: (existing.hit_count ?? 0) + 1,
                updated_at: nowIso,
            })
            .eq('user_id', key);
    }
}
