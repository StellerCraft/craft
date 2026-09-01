/**
 * Tests for SupabaseFeeBumpUsageStore — durable fee-bump usage (Issue #1111)
 *
 * The Supabase client is mocked with a module-level in-memory table that
 * persists independently of any SupabaseFeeBumpUsageStore instance. Discarding
 * the store object and creating a new one simulates a server restart: the
 * process-local service is gone, but the backing database rows remain.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Stateful Supabase mock ────────────────────────────────────────────────────

interface Row {
  user_id: string;
  count: number;
  total_fees_paid: number;
  last_used_at: string;
}

/** Stands in for the durable `fee_bump_usage_records` table. */
const backingTable = new Map<string, Row>();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: (_columns: string) => ({
        eq: (_column: string, userId: string) => ({
          maybeSingle: async () => ({
            data: backingTable.get(userId) ?? null,
            error: null,
          }),
        }),
      }),
      upsert: async (row: Row, _options: { onConflict: string }) => {
        backingTable.set(row.user_id, { ...backingTable.get(row.user_id), ...row });
        return { error: null };
      },
    }),
  }),
}));

// Imported after the mock is registered.
import { SupabaseFeeBumpUsageStore } from './fee-bump-usage.service';
import type { FeeBumpUsageStore } from '@craft/stellar';

const USER = 'a3f1c2d4-0000-4000-8000-000000000001';

beforeEach(() => {
  backingTable.clear();
});

describe('SupabaseFeeBumpUsageStore', () => {
  it('satisfies the FeeBumpUsageStore interface', () => {
    const store: FeeBumpUsageStore = new SupabaseFeeBumpUsageStore();
    expect(typeof store.record).toBe('function');
  });

  it('creates a usage record on the first fee-bump', async () => {
    const store = new SupabaseFeeBumpUsageStore();
    await store.record(USER, 300);

    const usage = await store.get(USER);
    expect(usage).toBeDefined();
    expect(usage!.count).toBe(1);
    expect(usage!.totalFeesPaid).toBe(300);
  });

  it('accumulates count and totalFeesPaid across fee-bumps', async () => {
    const store = new SupabaseFeeBumpUsageStore();
    await store.record(USER, 200);
    await store.record(USER, 150);
    await store.record(USER, 50);

    const usage = await store.get(USER);
    expect(usage!.count).toBe(3);
    expect(usage!.totalFeesPaid).toBe(400);
  });

  it('tracks users independently', async () => {
    const store = new SupabaseFeeBumpUsageStore();
    await store.record('user-1', 100);
    await store.record('user-2', 900);

    expect((await store.get('user-1'))!.totalFeesPaid).toBe(100);
    expect((await store.get('user-2'))!.totalFeesPaid).toBe(900);
  });

  it('persists usage across a simulated service re-instantiation (restart)', async () => {
    const storeBeforeRestart = new SupabaseFeeBumpUsageStore();
    await storeBeforeRestart.record(USER, 250);
    await storeBeforeRestart.record(USER, 250);

    // Simulate a restart: the service instance is gone; only the durable
    // Supabase table survives.
    const storeAfterRestart = new SupabaseFeeBumpUsageStore();
    const usage = await storeAfterRestart.get(USER);

    expect(usage).toBeDefined();
    expect(usage!.count).toBe(2);
    expect(usage!.totalFeesPaid).toBe(500);

    // Continuing to record after the restart builds on the persisted counters
    // rather than resetting them to zero.
    await storeAfterRestart.record(USER, 100);
    const continued = await storeAfterRestart.get(USER);
    expect(continued!.count).toBe(3);
    expect(continued!.totalFeesPaid).toBe(600);
  });
});
