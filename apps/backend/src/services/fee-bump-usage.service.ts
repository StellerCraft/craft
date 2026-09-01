/**
 * Durable Fee-Bump Usage Store (Issue #1111)
 *
 * `orchestrateFeeBump` in `@craft/stellar` defaults to an in-memory
 * `FeeBumpUsageStore` whose own doc comment flags it as a placeholder. A
 * server restart mid-billing-period wipes every user's `count` /
 * `totalFeesPaid` back to zero with no reconciliation against what was
 * actually charged — unacceptable for a usage-based billing signal.
 *
 * This Supabase-backed implementation persists each fee-bump so usage survives
 * restarts. It mirrors the persistence pattern used by
 * `PaymentIdempotencyService` and `MeteringService`: a read of the current
 * row followed by an upsert keyed on `user_id`.
 *
 * Production call paths that wrap user transactions in a platform-sponsored
 * fee-bump must inject `supabaseFeeBumpUsageStore` (or another durable
 * `FeeBumpUsageStore`) rather than relying on the in-memory default.
 */

import { createClient } from '@/lib/supabase/server';
import type { FeeBumpUsageRecord, FeeBumpUsageStore } from '@craft/stellar';

const TABLE = 'fee_bump_usage_records';

export class SupabaseFeeBumpUsageStore implements FeeBumpUsageStore {
  /**
   * Record a single fee-bump transaction for a user, incrementing the running
   * count and cumulative fee total. Creates the row on first use.
   */
  async record(userId: string, feeCharged: number): Promise<void> {
    const supabase = createClient();

    const { data: existing, error: readError } = await supabase
      .from(TABLE)
      .select('count, total_fees_paid')
      .eq('user_id', userId)
      .maybeSingle();

    if (readError) {
      throw new Error(
        `Failed to read fee-bump usage for ${userId}: ${readError.message}`,
      );
    }

    const nextCount = ((existing?.count as number | undefined) ?? 0) + 1;
    const nextTotal =
      ((existing?.total_fees_paid as number | undefined) ?? 0) + feeCharged;

    const { error: writeError } = await supabase.from(TABLE).upsert(
      {
        user_id: userId,
        count: nextCount,
        total_fees_paid: nextTotal,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

    if (writeError) {
      throw new Error(
        `Failed to persist fee-bump usage for ${userId}: ${writeError.message}`,
      );
    }
  }

  /**
   * Return the persisted usage record for a user, or `undefined` when the user
   * has no recorded fee-bump activity.
   */
  async get(userId: string): Promise<FeeBumpUsageRecord | undefined> {
    const supabase = createClient();

    const { data, error } = await supabase
      .from(TABLE)
      .select('user_id, count, total_fees_paid, last_used_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to read fee-bump usage for ${userId}: ${error.message}`,
      );
    }

    if (!data) return undefined;

    const lastUsedAt = data.last_used_at as string | number | null;

    return {
      userId: data.user_id as string,
      count: data.count as number,
      totalFeesPaid: data.total_fees_paid as number,
      lastUsedAt:
        typeof lastUsedAt === 'string' ? Date.parse(lastUsedAt) : lastUsedAt ?? 0,
    };
  }
}

/** Shared durable store instance for production fee-bump orchestration. */
export const supabaseFeeBumpUsageStore = new SupabaseFeeBumpUsageStore();
