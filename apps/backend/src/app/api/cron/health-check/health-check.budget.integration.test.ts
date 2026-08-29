// @vitest-environment node
/**
 * Health Check Cron Execution Budget & Checkpointing Integration Test (issue #1152)
 *
 * The cron health-check route calls `HealthMonitorService.checkAllDeployments`,
 * which fans out across every active deployment. This test asserts:
 *   1. A sweep over a realistically large deployment count completes within the
 *      documented time budget (HEALTH_CHECK_SWEEP_BUDGET_MS).
 *   2. The paged API (`{ cursor, limit }`) lets a truncated run resume from where
 *      it left off via `nextCursor` instead of restarting from the beginning.
 *
 * Run: pnpm test -- health-check.budget.integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { healthMonitorService, HEALTH_CHECK_SWEEP_BUDGET_MS } from '@/services/health-monitor.service';

const LARGE_COUNT = 2000;
const DEPLOYMENTS = Array.from({ length: LARGE_COUNT }, (_, i) => ({
  id: `dep_${i}`,
  deployment_url: `https://dep-${i}.example.com/healthz`,
}));

function makeSupabase() {
  return {
    from: (_table: string) => {
      const chain: any = {
        _select: null,
        _eq: null,
        select(fields: string) {
          chain._select = fields;
          return chain;
        },
        eq(col: string, val: any) {
          chain._eq = { col, val };
          return chain;
        },
        order() {
          return chain;
        },
        async range(from: number, to: number) {
          if (chain._select === 'id') {
            return { data: DEPLOYMENTS.slice(from, to + 1).map((d) => ({ id: d.id })), error: null };
          }
          return { data: null, error: null };
        },
        async single() {
          if (chain._select === 'deployment_url' && chain._eq?.col === 'id') {
            const d = DEPLOYMENTS.find((x) => x.id === chain._eq.val);
            return { data: d ? { deployment_url: d.deployment_url } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => makeSupabase() as any,
}));

vi.mock('@/services/analytics.service', () => ({
  analyticsService: { recordUptimeCheck: async () => undefined },
}));

describe('Health Check Cron — execution budget & checkpointing (#1152)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
  });

  it(`completes a sweep over ${LARGE_COUNT} deployments within the documented time budget`, async () => {
    const start = Date.now();
    const results = await healthMonitorService.checkAllDeployments();
    const elapsed = Date.now() - start;

    expect(Array.isArray(results)).toBe(true);
    expect((results as any[]).length).toBe(LARGE_COUNT);
    expect(elapsed).toBeLessThan(HEALTH_CHECK_SWEEP_BUDGET_MS);
  });

  it('resumes a truncated sweep from the cursor instead of restarting', async () => {
    const PAGE = 500;

    const first = await healthMonitorService.checkAllDeployments({ cursor: 0, limit: PAGE });
    expect(first.truncated).toBe(true);
    expect(first.results.length).toBe(PAGE);
    expect(first.nextCursor).toBe(PAGE);

    const second = await healthMonitorService.checkAllDeployments({ cursor: first.nextCursor!, limit: PAGE });
    // No overlap between pages: second page starts where the first ended.
    const firstIds = new Set(first.results.map((r) => r.deploymentId));
    const secondIds = second.results.map((r) => r.deploymentId);
    expect(secondIds.every((id) => !firstIds.has(id))).toBe(true);
    expect(second.results.length).toBe(PAGE);
  });
});
