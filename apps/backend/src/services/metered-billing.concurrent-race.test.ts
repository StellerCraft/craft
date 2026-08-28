/**
 * Unit tests for concurrent recordUsage race condition handling
 *
 * Verifies that two concurrent recordUsage() calls for the same
 * idempotency key result in exactly one aggregated usage row with
 * summed quantity, not duplicate rows or unhandled exceptions.
 *
 * Issue: #892
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeteringService } from './metered-billing.service';

interface UsageRecord {
  id: string;
  user_id: string;
  operation_type: string;
  quantity: number;
  metadata: Record<string, unknown>;
  billing_period_start: string;
  billing_period_end: string;
  idempotency_key: string;
  reported_to_stripe: boolean;
  created_at: string;
}

const store: UsageRecord[] = [];
let idCounter = 0;

function createQueryBuilder(records: UsageRecord[]) {
  const conditions: Array<(r: UsageRecord) => boolean> = [];
  let isSelect = false;
  let upsertData: any = null;
  let onConflictCol: string | null = null;

  const builder: any = {
    select(_cols?: string, _opts?: unknown) {
      isSelect = true;
      return builder;
    },
    eq(col: string, val: unknown) {
      conditions.push((r: any) => r[col] === val);
      return builder;
    },
    gte(col: string, val: unknown) {
      conditions.push((r: any) => r[col] >= val);
      return builder;
    },
    lte(col: string, val: unknown) {
      conditions.push((r: any) => r[col] <= val);
      return builder;
    },
    is(col: string, _val: null) {
      conditions.push((r: any) => r[col] == null);
      return builder;
    },
    upsert(data: unknown, opts?: { onConflict?: string }) {
      upsertData = data;
      onConflictCol = opts?.onConflict || null;
      return builder;
    },
    async single() {
      const matching = records.filter(r => conditions.every(c => c(r)));
      if (matching.length === 0) {
        if (upsertData) {
          const record = {
            id: `id-${++idCounter}`,
            created_at: new Date().toISOString(),
            ...upsertData,
          } as UsageRecord;
          records.push(record);
          return { data: record, error: null };
        }
        return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
      }

      const existing = matching[0];
      if (upsertData && onConflictCol) {
        Object.assign(existing, upsertData);
        return { data: existing, error: null };
      }

      return { data: existing, error: null };
    },
    insert(data: unknown) {
      const record = {
        id: `id-${++idCounter}`,
        created_at: new Date().toISOString(),
        ...(data as object),
      } as UsageRecord;
      records.push(record);
      return {
        select(_cols?: string) {
          return {
            async single() {
              return { data: record, error: null };
            },
          };
        },
      };
    },
    update(data: unknown) {
      return {
        eq(col: string, val: unknown) {
          const idx = records.findIndex((r: any) => r[col] === val);
          if (idx >= 0) {
            Object.assign(records[idx], data);
          }
          const found = idx >= 0 ? records[idx] : null;
          return {
            select(_cols?: string) {
              return {
                async single() {
                  return { data: found, error: null };
                },
              };
            },
          };
        },
      };
    },
    async then() {
      return { data: records.filter(r => conditions.every(c => c(r))), error: null };
    },
  };

  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (_table: string) => createQueryBuilder(store),
  }),
}));

describe('MeteringService – concurrent race condition handling', () => {
  beforeEach(() => {
    store.length = 0;
    idCounter = 0;
  });

  it('two concurrent recordUsage calls with same idempotency key result in one record with summed quantity', async () => {
    const userId = 'user-123';
    const operationType = 'api_call';
    const q1 = 5;
    const q2 = 3;

    const svc = new MeteringService();

    // Simulate two concurrent calls happening at the same second
    const now = Date.now();
    const promise1 = svc.recordUsage(userId, operationType, q1);
    const promise2 = svc.recordUsage(userId, operationType, q2);

    const result1 = await promise1;
    const result2 = await promise2;

    // Both should return records
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();

    // Both should reference the same record (or at least the same idempotency key)
    expect(result1.idempotency_key).toBe(result2.idempotency_key);

    // Store should have exactly one record (no duplicates)
    const recordsWithKey = store.filter(
      r => r.idempotency_key === result1.idempotency_key
    );
    expect(recordsWithKey).toHaveLength(1);

    // Quantity should be the sum of both calls
    expect(recordsWithKey[0].quantity).toBe(q1 + q2);
  });

  it('concurrent recordUsage calls do not throw unhandled errors on unique constraint conflicts', async () => {
    const userId = 'user-456';
    const operationType = 'deployment_create';

    const svc = new MeteringService();

    // Attempt 100 concurrent calls in the same second
    const promises = Array.from({ length: 100 }, (_, i) =>
      svc.recordUsage(userId, operationType, 1)
    );

    const results = await Promise.all(promises);

    // All should succeed without throwing
    expect(results).toHaveLength(100);
    results.forEach(result => {
      expect(result).toBeDefined();
      expect(result.idempotency_key).toBeDefined();
    });

    // Should have exactly one record in store for this idempotency key
    const idempotencyKey = results[0].idempotency_key;
    const records = store.filter(r => r.idempotency_key === idempotencyKey);
    expect(records).toHaveLength(1);

    // Quantity should be 100 (all calls aggregated)
    expect(records[0].quantity).toBe(100);
  });

  it('metadata from all concurrent calls is merged', async () => {
    const userId = 'user-789';
    const operationType = 'domain_config';

    const svc = new MeteringService();

    const metadata1 = { source: 'api', action: 'create' };
    const metadata2 = { source: 'cli', region: 'us-east-1' };

    const promise1 = svc.recordUsage(userId, operationType, 1, metadata1);
    const promise2 = svc.recordUsage(userId, operationType, 1, metadata2);

    const result1 = await promise1;
    const result2 = await promise2;

    // The final stored record should have merged metadata
    const storedRecord = store.find(r => r.id === result1.id || r.id === result2.id);
    expect(storedRecord).toBeDefined();
    expect(storedRecord!.metadata).toMatchObject({
      source: expect.any(String),
      action: 'create',
      region: 'us-east-1',
    });
  });
});
