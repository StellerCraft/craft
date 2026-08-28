/**
 * RegionSelectorService
 *
 * Picks the optimal Vercel deployment region for a user by combining two
 * measured latencies:
 *
 *   - user_latency:    round-trip from the user to each region's health endpoint
 *   - horizon_latency: round-trip from each region to the Stellar Horizon
 *                      endpoint for the selected network
 *
 * The region that minimises  0.7 × user_latency + 0.3 × horizon_latency  is
 * chosen. Selections are cached in Supabase with a 5-minute TTL to avoid
 * re-measuring on every deployment, and us-east-1 is used as a fallback when
 * measurement fails.
 *
 * Issue: #757 — Multi-Region Deployment Orchestration with Latency-Based
 *               Routing Selection
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import {
    getNetworkMetadata,
    type StellarNetworkId,
} from '@/services/stellar-network.service';

// ── Constants ─────────────────────────────────────────────────────────────────

export const REGIONS = ['us-east-1', 'eu-west-1', 'ap-southeast-1'] as const;
export type Region = (typeof REGIONS)[number];

export const DEFAULT_REGION: Region = 'us-east-1';

/** Scoring weights: user latency dominates, Horizon latency is secondary. */
export const USER_LATENCY_WEIGHT = 0.7;
export const HORIZON_LATENCY_WEIGHT = 0.3;

/** Cache time-to-live: 5 minutes. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

/** Default per-region health endpoints (override via REGION_HEALTH_<REGION> env). */
const DEFAULT_REGION_HEALTH: Record<Region, string> = {
    'us-east-1': 'https://us-east-1.health.craft.app/health',
    'eu-west-1': 'https://eu-west-1.health.craft.app/health',
    'ap-southeast-1': 'https://ap-southeast-1.health.craft.app/health',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RegionMeasurement {
    region: Region;
    /** Measured user→region latency in ms (Infinity when unreachable). */
    userLatencyMs: number;
    /** Measured region→Horizon latency in ms (Infinity when unreachable). */
    horizonLatencyMs: number;
}

export interface ScoredRegion extends RegionMeasurement {
    /** Weighted score; lower is better. */
    score: number;
}

export interface RegionSelection {
    region: Region;
    score: number | null;
    /** True when the result came from the cache. */
    cached: boolean;
    /** True when measurement failed and the default region was used. */
    fallback: boolean;
    measurements?: ScoredRegion[];
}

export interface SelectRegionInput {
    /** Stable key for caching (e.g. `${userId}:${network}` or `${ip}:${network}`). */
    cacheKey: string;
    network: StellarNetworkId;
}

/** Function used to measure round-trip latency to a URL (overridable for tests). */
export type LatencyProbe = (url: string) => Promise<number>;

// ── Pure scoring helpers ──────────────────────────────────────────────────────

/** Weighted score for a single region; lower is better. */
export function scoreRegion(userLatencyMs: number, horizonLatencyMs: number): number {
    return USER_LATENCY_WEIGHT * userLatencyMs + HORIZON_LATENCY_WEIGHT * horizonLatencyMs;
}

/**
 * Select the region with the lowest weighted score. Regions whose score is not
 * finite (a failed measurement) are ignored. Falls back to {@link DEFAULT_REGION}
 * when every region failed.
 */
export function selectOptimalRegion(measurements: RegionMeasurement[]): {
    region: Region;
    score: number | null;
    fallback: boolean;
    scored: ScoredRegion[];
} {
    const scored: ScoredRegion[] = measurements.map((m) => ({
        ...m,
        score: scoreRegion(m.userLatencyMs, m.horizonLatencyMs),
    }));

    let best: ScoredRegion | null = null;
    for (const candidate of scored) {
        if (!Number.isFinite(candidate.score)) continue;
        if (!best || candidate.score < best.score) best = candidate;
    }

    if (!best) {
        return { region: DEFAULT_REGION, score: null, fallback: true, scored };
    }
    return { region: best.region, score: best.score, fallback: false, scored };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class RegionSelectorService {
    private readonly probe: LatencyProbe;
    private readonly now: () => number;

    constructor(
        private readonly supabase?: SupabaseClient,
        options: { probe?: LatencyProbe; now?: () => number } = {},
    ) {
        this.probe = options.probe ?? defaultLatencyProbe;
        this.now = options.now ?? (() => Date.now());
    }

    private db(): SupabaseClient {
        return this.supabase ?? (createClient() as unknown as SupabaseClient);
    }

    /**
     * Return the optimal region for the input, using a cached selection when one
     * is still within the 5-minute TTL, otherwise measuring and caching afresh.
     */
    async selectRegion(input: SelectRegionInput): Promise<RegionSelection> {
        const cached = await this.readCache(input.cacheKey);
        if (cached) {
            return { region: cached, score: null, cached: true, fallback: false };
        }

        const measurements = await this.measureRegions(input.network);
        const { region, score, fallback, scored } = selectOptimalRegion(measurements);

        await this.writeCache(input.cacheKey, region, scored);

        return { region, score, cached: false, fallback, measurements: scored };
    }

    /** Measure user- and Horizon-latency for every region. */
    async measureRegions(network: StellarNetworkId): Promise<RegionMeasurement[]> {
        const horizonUrl = getNetworkMetadata(network)?.horizonUrl;

        return Promise.all(
            REGIONS.map(async (region) => {
                const [userLatencyMs, horizonLatencyMs] = await Promise.all([
                    this.probe(regionHealthUrl(region)),
                    horizonUrl ? this.probe(horizonUrl) : Promise.resolve(Infinity),
                ]);
                return { region, userLatencyMs, horizonLatencyMs };
            }),
        );
    }

    // ── Caching ───────────────────────────────────────────────────────────────

    /** Return the cached region for a key when it is still within TTL. */
    private async readCache(cacheKey: string): Promise<Region | null> {
        const { data, error } = await this.db()
            .from('region_latency_cache')
            .select('selected_region, expires_at')
            .eq('cache_key', cacheKey)
            .maybeSingle();

        if (error || !data) return null;

        const row = data as { selected_region: string; expires_at: string };
        if (new Date(row.expires_at).getTime() <= this.now()) return null;

        return REGIONS.includes(row.selected_region as Region)
            ? (row.selected_region as Region)
            : null;
    }

    /** Upsert the selection with a fresh 5-minute expiry. */
    private async writeCache(
        cacheKey: string,
        region: Region,
        scored: ScoredRegion[],
    ): Promise<void> {
        const expiresAt = new Date(this.now() + CACHE_TTL_MS).toISOString();

        const { error } = await this.db()
            .from('region_latency_cache')
            .upsert(
                {
                    cache_key: cacheKey,
                    selected_region: region,
                    scores: scored,
                    expires_at: expiresAt,
                },
                { onConflict: 'cache_key' },
            );

        if (error) {
            console.error('[RegionSelector] failed to cache selection:', error.message);
        }
    }
}

// ── Default latency probe ─────────────────────────────────────────────────────

/** Resolve a region's health endpoint, honouring env overrides. */
export function regionHealthUrl(region: Region): string {
    const envKey = `REGION_HEALTH_${region.toUpperCase().replace(/-/g, '_')}`;
    return process.env[envKey] ?? DEFAULT_REGION_HEALTH[region];
}

/**
 * Measure round-trip latency to a URL with a HEAD request. Returns Infinity on
 * any failure so the region is excluded from selection.
 */
export async function defaultLatencyProbe(url: string): Promise<number> {
    const start = Date.now();
    try {
        const res = await fetch(url, { method: 'HEAD' });
        if (!res.ok) return Infinity;
        return Date.now() - start;
    } catch {
        return Infinity;
    }
}

/** Shared singleton using the request-scoped Supabase server client. */
export const regionSelectorService = new RegionSelectorService();
