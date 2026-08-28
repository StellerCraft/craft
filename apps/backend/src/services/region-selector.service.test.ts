/**
 * Unit tests for RegionSelectorService (#757)
 *
 * Coverage:
 *   - weighted selection algorithm (0.7·user + 0.3·horizon) across latency combos
 *   - fallback to us-east-1 when measurement fails
 *   - 5-minute cache: hit within TTL (no measurement), miss when expired
 *   - cache write on a fresh selection
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    RegionSelectorService,
    scoreRegion,
    selectOptimalRegion,
    regionHealthUrl,
    DEFAULT_REGION,
    type Region,
    type RegionMeasurement,
} from './region-selector.service';

// ── Supabase mock (cache read/write) ──────────────────────────────────────────

function makeSupabaseMock() {
    let cacheRow: { selected_region: string; expires_at: string } | null = null;
    const upserts: Record<string, unknown>[] = [];

    const client = {
        from(_table: string) {
            return {
                select() {
                    return {
                        eq() {
                            return {
                                maybeSingle() {
                                    return Promise.resolve({ data: cacheRow, error: null });
                                },
                            };
                        },
                    };
                },
                upsert(values: Record<string, unknown>) {
                    upserts.push(values);
                    return Promise.resolve({ error: null });
                },
            };
        },
    } as unknown as SupabaseClient;

    return {
        client,
        upserts,
        setCacheRow: (row: typeof cacheRow) => (cacheRow = row),
    };
}

/** Build a probe that returns per-URL latencies; defaults to Infinity. */
function probeFrom(latencies: Record<string, number>) {
    return (url: string) => Promise.resolve(latencies[url] ?? Infinity);
}

const NOW = 1_000_000_000_000;
const horizonTestnet = 'https://horizon-testnet.stellar.org';

describe('scoring helpers', () => {
    it('weights user latency at 0.7 and horizon at 0.3', () => {
        expect(scoreRegion(100, 200)).toBeCloseTo(0.7 * 100 + 0.3 * 200);
    });

    it('selects the region with the lowest weighted score', () => {
        const measurements: RegionMeasurement[] = [
            { region: 'us-east-1', userLatencyMs: 100, horizonLatencyMs: 50 }, // 85
            { region: 'eu-west-1', userLatencyMs: 40, horizonLatencyMs: 200 }, // 88
            { region: 'ap-southeast-1', userLatencyMs: 30, horizonLatencyMs: 90 }, // 48
        ];
        const result = selectOptimalRegion(measurements);
        expect(result.region).toBe('ap-southeast-1');
        expect(result.fallback).toBe(false);
    });

    it('lets a low horizon latency tip the choice between close user latencies', () => {
        const measurements: RegionMeasurement[] = [
            { region: 'us-east-1', userLatencyMs: 50, horizonLatencyMs: 300 }, // 125
            { region: 'eu-west-1', userLatencyMs: 55, horizonLatencyMs: 20 }, // 44.5
        ];
        expect(selectOptimalRegion(measurements).region).toBe('eu-west-1');
    });

    it('ignores unreachable regions (Infinity score)', () => {
        const measurements: RegionMeasurement[] = [
            { region: 'us-east-1', userLatencyMs: Infinity, horizonLatencyMs: Infinity },
            { region: 'eu-west-1', userLatencyMs: 70, horizonLatencyMs: 70 },
        ];
        expect(selectOptimalRegion(measurements).region).toBe('eu-west-1');
    });

    it('falls back to the default region when every measurement failed', () => {
        const measurements: RegionMeasurement[] = [
            { region: 'us-east-1', userLatencyMs: Infinity, horizonLatencyMs: Infinity },
            { region: 'eu-west-1', userLatencyMs: Infinity, horizonLatencyMs: Infinity },
            { region: 'ap-southeast-1', userLatencyMs: Infinity, horizonLatencyMs: Infinity },
        ];
        const result = selectOptimalRegion(measurements);
        expect(result.region).toBe(DEFAULT_REGION);
        expect(result.fallback).toBe(true);
        expect(result.score).toBeNull();
    });
});

describe('RegionSelectorService.selectRegion', () => {
    let mock: ReturnType<typeof makeSupabaseMock>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        mock = makeSupabaseMock();
    });

    it('measures, selects the optimal region, and caches it on a cache miss', async () => {
        const probe = probeFrom({
            [regionHealthUrl('us-east-1')]: 120,
            [regionHealthUrl('eu-west-1')]: 30,
            [regionHealthUrl('ap-southeast-1')]: 200,
            [horizonTestnet]: 40,
        });
        const svc = new RegionSelectorService(mock.client, { probe, now: () => NOW });

        const result = await svc.selectRegion({ cacheKey: 'user-1:testnet', network: 'testnet' });

        // eu-west-1 has the lowest user latency; horizon is equal across regions.
        expect(result.region).toBe('eu-west-1');
        expect(result.cached).toBe(false);
        expect(result.fallback).toBe(false);

        // Cached with a 5-minute expiry.
        expect(mock.upserts).toHaveLength(1);
        expect(mock.upserts[0]).toMatchObject({
            cache_key: 'user-1:testnet',
            selected_region: 'eu-west-1',
        });
        expect(new Date(mock.upserts[0].expires_at as string).getTime()).toBe(
            NOW + 5 * 60 * 1000,
        );
    });

    it('returns the cached region without measuring when still within TTL', async () => {
        mock.setCacheRow({
            selected_region: 'ap-southeast-1',
            expires_at: new Date(NOW + 60_000).toISOString(), // not yet expired
        });
        const probe = vi.fn(() => Promise.resolve(10));
        const svc = new RegionSelectorService(mock.client, { probe, now: () => NOW });

        const result = await svc.selectRegion({ cacheKey: 'user-1:testnet', network: 'testnet' });

        expect(result.region).toBe('ap-southeast-1');
        expect(result.cached).toBe(true);
        expect(probe).not.toHaveBeenCalled();
        expect(mock.upserts).toHaveLength(0);
    });

    it('re-measures when the cached entry has expired', async () => {
        mock.setCacheRow({
            selected_region: 'ap-southeast-1',
            expires_at: new Date(NOW - 1).toISOString(), // expired
        });
        const probe = probeFrom({
            [regionHealthUrl('us-east-1')]: 25,
            [regionHealthUrl('eu-west-1')]: 300,
            [regionHealthUrl('ap-southeast-1')]: 300,
            [horizonTestnet]: 10,
        });
        const svc = new RegionSelectorService(mock.client, { probe, now: () => NOW });

        const result = await svc.selectRegion({ cacheKey: 'user-1:testnet', network: 'testnet' });

        expect(result.cached).toBe(false);
        expect(result.region).toBe('us-east-1');
        expect(mock.upserts).toHaveLength(1);
    });

    it('re-measures when the cached region is no longer in the supported REGIONS list', async () => {
        mock.setCacheRow({
            selected_region: 'sa-east-1',
            expires_at: new Date(NOW + 60_000).toISOString(),
        });
        const probe = vi.fn(probeFrom({
            [regionHealthUrl('us-east-1')]: 25,
            [regionHealthUrl('eu-west-1')]: 300,
            [regionHealthUrl('ap-southeast-1')]: 300,
            [horizonTestnet]: 10,
        }));
        const svc = new RegionSelectorService(mock.client, { probe, now: () => NOW });

        const result = await svc.selectRegion({ cacheKey: 'user-1:testnet', network: 'testnet' });

        expect(result.cached).toBe(false);
        expect(probe).toHaveBeenCalled();
        expect(result.region).toBe('us-east-1');
        expect(mock.upserts).toHaveLength(1);
    });

    it('falls back to us-east-1 when all region probes fail', async () => {
        const probe = probeFrom({}); // everything Infinity
        const svc = new RegionSelectorService(mock.client, { probe, now: () => NOW });

        const result = await svc.selectRegion({ cacheKey: 'user-1:testnet', network: 'testnet' });

        expect(result.region).toBe<Region>('us-east-1');
        expect(result.fallback).toBe(true);
    });

    it('honours REGION_HEALTH_* env overrides for endpoint URLs', () => {
        vi.stubEnv('REGION_HEALTH_US_EAST_1', 'https://custom.example/health');
        expect(regionHealthUrl('us-east-1')).toBe('https://custom.example/health');
    });
});
