/**
 * Cascade / fleet-scale integration tests for the cron health-check route (#1152).
 *
 * These tests exercise the REAL HealthMonitorService (only Supabase + Vercel are
 * mocked) so they cover the actual paging, bounded-concurrency, and checkpoint
 * logic that keeps a large deployment fleet within the cron execution budget and
 * lets a truncated run resume on the next invocation.
 *
 * Run: vitest run src/app/api/cron/health-check/health-check.cascade.integration.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';
import { healthMonitorService } from '@/services/health-monitor.service';

const CRON_SECRET = 'test-cron-secret';
const FLEET_SIZE = 500;
const HEALTH_CHECK_PAGE_SIZE = 50;

// Build a deterministic, lexicographically-ordered fleet of deployment ids.
const DEPLOYMENTS = Array.from({ length: FLEET_SIZE }, (_, i) => ({
    id: `dep-${String(i + 1).padStart(4, '0')}`,
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockFrom = vi.fn();

// A minimal Supabase query builder that resolves the deployments page the real
// service asks for (honouring the `id > cursor` and `limit(+1)` it sends).
function makeDeploymentsBuilder(): any {
    const builder: any = {
        _cursor: null as string | null,
        _limit: 0,
        select() {
            return this;
        },
        eq() {
            return this;
        },
        order() {
            return this;
        },
        gt(_col: string, val: string) {
            this._cursor = val;
            return this;
        },
        limit(n: number) {
            this._limit = n;
            return this;
        },
        single() {
            return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (value: any) => void) {
            const all = DEPLOYMENTS.filter(
                (d) => !this._cursor || d.id > this._cursor
            );
            const rows = all.slice(0, this._limit);
            resolve({ data: rows, error: null });
        },
    };
    return builder;
}

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom }),
}));

vi.mock('@/services/vercel.service', () => ({
    VercelService: vi.fn(() => ({ breaker: { currentState: 'CLOSED' } })),
}));

// ── Test setup ─────────────────────────────────────────────────────────────────

let savedCursor: string | null = null;
let checkedIds: string[] = [];
let advanceMs = 0;

function createCronRequest(secret?: string): NextRequest {
    return new NextRequest('http://localhost:4001/api/cron/health-check', {
        method: 'GET',
        headers: {
            authorization: secret ? `Bearer ${secret}` : `Bearer ${CRON_SECRET}`,
        },
    });
}

beforeEach(() => {
    savedCursor = null;
    checkedIds = [];
    advanceMs = 0;
    vi.clearAllMocks();
    delete process.env.HEALTH_CHECK_BUDGET_MS;
    process.env.CRON_SECRET = CRON_SECRET;

    mockFrom.mockImplementation((table: string) => {
        if (table === 'deployments') return makeDeploymentsBuilder();
        // Any other table: resolve empty so unrelated queries don't blow up.
        return {
            select: () => ({
                eq: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
            }),
        };
    });

    // Run the real health checks, but observe which deployments were touched and
    // (optionally) burn fake time so the execution budget can be exercised.
    vi.spyOn(healthMonitorService, 'checkDeploymentHealth').mockImplementation(
        async (id: any) => {
            checkedIds.push(String(id));
            if (advanceMs > 0) vi.advanceTimersByTime(advanceMs);
            return { isHealthy: true, responseTime: 50, statusCode: 200, error: null };
        }
    );
    vi.spyOn(healthMonitorService, 'getCheckpoint').mockImplementation(
        async () => savedCursor
    );
    vi.spyOn(healthMonitorService, 'saveCheckpoint').mockImplementation(
        async (cursor: any) => {
            savedCursor = cursor ?? null;
        }
    );
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('Health-check cron cascade (#1152)', () => {
    it('completes a large fleet within the documented time budget', async () => {
        const start = Date.now();
        const response = await GET(createCronRequest());
        const elapsed = Date.now() - start;

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.totalChecked).toBe(FLEET_SIZE);
        // The sweep is bounded; even a 500-deployment fleet finishes far under the
        // 60s cron execution budget because it pages + caps concurrency.
        expect(elapsed).toBeLessThan(10_000);
        // A fully-drained sweep persists a NULL checkpoint.
        expect(savedCursor).toBeNull();
    });

    it('checkpoints progress and resumes after a budget truncation instead of restarting', async () => {
        vi.useFakeTimers();
        advanceMs = 50; // each health check burns 50ms of fake time
        process.env.HEALTH_CHECK_BUDGET_MS = '1'; // force truncation after one page

        let invocations = 0;
        let firstRunTotal = -1;

        for (let i = 0; i < 50; i++) {
            const response = await GET(createCronRequest());
            expect(response.status).toBe(200);
            const data = await response.json();
            if (invocations === 0) firstRunTotal = data.totalChecked;
            invocations++;
            if (new Set(checkedIds).size >= FLEET_SIZE) break;
        }

        // The first invocation was truncated to exactly one page...
        expect(firstRunTotal).toBe(HEALTH_CHECK_PAGE_SIZE);
        // ...so it took more than one scheduled invocation to cover the fleet...
        expect(invocations).toBeGreaterThan(1);
        // ...and across those invocations every deployment was checked exactly once
        // (no restarts from the beginning, no skips).
        expect(new Set(checkedIds).size).toBe(FLEET_SIZE);
        expect(checkedIds.length).toBe(FLEET_SIZE);
        // The final invocation drained the fleet and cleared the checkpoint.
        expect(savedCursor).toBeNull();
    });
});
