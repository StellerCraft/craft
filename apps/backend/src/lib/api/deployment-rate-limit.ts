/**
 * Supabase-backed sliding window rate limiter for the deployment API.
 *
 * Algorithm
 * ─────────
 * Each request is logged as a row in `deployment_rate_limit_requests`.
 * To check the limit, we count rows in the last WINDOW_MS for that user.
 * This is a true sliding window — no fixed epoch alignment.
 *
 * Escalation
 * ──────────
 * When a user is rejected, their hit count is incremented in
 * `deployment_rate_limit_escalations`. If they accumulate ≥ 3 rejections
 * within the same hour their effective limit is halved for the next hour.
 *
 * Per-tier limits (requests per hour)
 * ─────────────────────────────────────
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

/**
 * Check and (on success) record a deployment request for the given user.
 *
 * The caller is responsible for providing a Supabase client that is already
 * authenticated or bypasses RLS for these tables (service-role in prod).
 */
export async function checkDeploymentRateLimit(
    supabase: SupabaseClient,
    userId: string,
    tier: SubscriptionTier,
): Promise<SlidingWindowResult> {
    const now = Date.now();
    const windowStart = new Date(now - WINDOW_MS).toISOString();
    const baseLimit = TIER_HOURLY_LIMITS[tier];

    // ── 1. Check escalation ─────────────────────────────────────────────────
    const escalated = await isEscalated(supabase, userId, now);
    const effectiveLimit = escalated ? Math.floor(baseLimit * ESCALATION_REDUCTION) : baseLimit;

    // ── 2. Count requests in the current sliding window ─────────────────────
    const { count, error: countError } = await supabase
        .from('deployment_rate_limit_requests')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', windowStart);

    if (countError) {
        // On DB error, fail open to avoid blocking legitimate users
        return {
            allowed: true,
            remaining: effectiveLimit,
            resetAt: now + WINDOW_MS,
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
            user_id: userId,
            created_at: new Date(now).toISOString(),
        });

        return {
            allowed: true,
            remaining: effectiveLimit - requestCount - 1,
            resetAt: now + WINDOW_MS,
            retryAfterSeconds: 0,
            escalated,
            limit: effectiveLimit,
        };
    }

    // ── 3b. Rejected — increment escalation counter ─────────────────────────
    await recordEscalationHit(supabase, userId, now);

    // Oldest request in window defines when the window next frees a slot
    const { data: oldest } = await supabase
        .from('deployment_rate_limit_requests')
        .select('created_at')
        .eq('user_id', userId)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    const oldestMs = oldest?.created_at ? new Date(oldest.created_at).getTime() : now;
    const resetAt = oldestMs + WINDOW_MS;
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

async function isEscalated(supabase: SupabaseClient, userId: string, nowMs: number): Promise<boolean> {
    const windowStart = new Date(nowMs - WINDOW_MS).toISOString();

    const { data } = await supabase
        .from('deployment_rate_limit_escalations')
        .select('hit_count, window_start')
        .eq('user_id', userId)
        .single();

    if (!data) return false;

    // Escalation window expired — reset
    if (data.window_start && new Date(data.window_start).getTime() < nowMs - WINDOW_MS) {
        return false;
    }

    return (data.hit_count ?? 0) >= ESCALATION_THRESHOLD;
}

async function recordEscalationHit(supabase: SupabaseClient, userId: string, nowMs: number): Promise<void> {
    const windowStart = new Date(nowMs - WINDOW_MS).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    const { data: existing } = await supabase
        .from('deployment_rate_limit_escalations')
        .select('hit_count, window_start')
        .eq('user_id', userId)
        .single();

    if (!existing || new Date(existing.window_start).getTime() < nowMs - WINDOW_MS) {
        // First hit in this window (or window expired) — start fresh
        await supabase
            .from('deployment_rate_limit_escalations')
            .upsert({
                user_id: userId,
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
            .eq('user_id', userId);
    }
}
