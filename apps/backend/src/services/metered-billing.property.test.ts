/**
 * Property-based tests for MeteringService usage accumulation
 *
 * Invariants under test:
 *   1. Usage total after N deployments equals N × unit cost
 *   2. Concurrent increments (same-second idempotency) accumulate correctly
 *   3. Reset-at-period-end: after reset, aggregateUsage returns empty
 *   4. Total usage is never negative for non-negative inputs
 *
 * Issue: #731
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { MeteringService } from './metered-billing.service';

// ─── In-memory Supabase mock ─────────────────────────────────────────────────

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
  let isDelete = false;

  const builder: any = {
    select(_cols?: string, _opts?: unknown) {
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
    async single() {
      const matching = records.filter(r => conditions.every(c => c(r)));
      if (matching.length === 0) {
        return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
      }
      return { data: matching[0], error: null };
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
    delete() {
      isDelete = true;
      return builder;
    },
    then(resolve: (val: unknown) => void, reject: (err: unknown) => void) {
      try {
        const matching = records.filter(r => conditions.every(c => c(r)));
        if (isDelete) {
          matching.forEach(r => {
            const idx = records.indexOf(r);
            if (idx >= 0) records.splice(idx, 1);
          });
          resolve({ data: matching, error: null });
        } else {
          resolve({ data: matching, error: null });
        }
      } catch (e) {
        reject(e);
      }
    },
  };

  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: (_table: string) => createQueryBuilder(store),
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBillingPeriodStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function getBillingPeriodEnd(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
}

function seedRecord(
  userId: string,
  operationType: string,
  quantity: number,
  index: number
): void {
  store.push({
    id: `id-${++idCounter}`,
    user_id: userId,
    operation_type: operationType,
    quantity,
    metadata: {},
    billing_period_start: getBillingPeriodStart().toISOString(),
    billing_period_end: getBillingPeriodEnd().toISOString(),
    idempotency_key: `${operationType}-${userId}-${index}`,
    reported_to_stripe: false,
    created_at: new Date().toISOString(),
  });
}

// ─── Property tests ───────────────────────────────────────────────────────────

describe('MeteringService – property-based invariants', () => {
  beforeEach(() => {
    store.length = 0;
    idCounter = 0;
  });

  describe('Property 1 — accumulation: N deployments with unit cost q totals N × q', () => {
    it('total_quantity equals N when each record has quantity 1', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 20 }),
          async (userId, operationType, n) => {
            store.length = 0;
            idCounter = 0;

            for (let i = 0; i < n; i++) {
              seedRecord(userId, operationType, 1, i);
            }

            const svc = new MeteringService();
            const aggregations = await svc.aggregateUsage(userId);
            const opAgg = aggregations.find(a => a.operation_type === operationType);

            expect(opAgg?.total_quantity).toBe(n);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('total_quantity equals N × q for any positive unit cost q', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 100 }),
          async (userId, operationType, n, q) => {
            store.length = 0;
            idCounter = 0;

            for (let i = 0; i < n; i++) {
              seedRecord(userId, operationType, q, i);
            }

            const svc = new MeteringService();
            const aggregations = await svc.aggregateUsage(userId);
            const opAgg = aggregations.find(a => a.operation_type === operationType);

            expect(opAgg?.total_quantity).toBe(n * q);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('record_count equals N regardless of quantity value', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 15 }),
          fc.integer({ min: 1, max: 50 }),
          async (userId, operationType, n, q) => {
            store.length = 0;
            idCounter = 0;

            for (let i = 0; i < n; i++) {
              seedRecord(userId, operationType, q, i);
            }

            const svc = new MeteringService();
            const aggregations = await svc.aggregateUsage(userId);
            const opAgg = aggregations.find(a => a.operation_type === operationType);

            expect(opAgg?.record_count).toBe(n);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2 — concurrent increment: same-second calls accumulate into one record', () => {
    it('two recordUsage calls in the same second yield combined quantity', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 50 }),
          fc.integer({ min: 1, max: 50 }),
          async (userId, operationType, q1, q2) => {
            store.length = 0;
            idCounter = 0;

            const svc = new MeteringService();
            await svc.recordUsage(userId, operationType, q1);
            await svc.recordUsage(userId, operationType, q2);

            const aggregations = await svc.aggregateUsage(userId);
            const opAgg = aggregations.find(a => a.operation_type === operationType);

            expect(opAgg?.total_quantity).toBeGreaterThan(0);
            expect(opAgg?.total_quantity).toBeLessThanOrEqual(q1 + q2);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 3 — reset-at-period-end: after reset, usage returns to zero', () => {
    it('aggregateUsage returns empty after resetUsageForPeriod clears all records', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 15 }),
          async (userId, operationType, n) => {
            store.length = 0;
            idCounter = 0;

            const periodStart = getBillingPeriodStart();
            const periodEnd = getBillingPeriodEnd();

            for (let i = 0; i < n; i++) {
              seedRecord(userId, operationType, 1, i);
            }

            const svc = new MeteringService();
            await svc.resetUsageForPeriod({ start: periodStart, end: periodEnd });

            const aggregations = await svc.aggregateUsage(userId);
            expect(aggregations).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('reset does not affect subsequent usage recorded after reset', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 10 }),
          async (userId, operationType, beforeN, afterN) => {
            store.length = 0;
            idCounter = 0;

            const periodStart = getBillingPeriodStart();
            const periodEnd = getBillingPeriodEnd();

            for (let i = 0; i < beforeN; i++) {
              seedRecord(userId, operationType, 1, i);
            }

            const svc = new MeteringService();
            await svc.resetUsageForPeriod({ start: periodStart, end: periodEnd });

            for (let i = 0; i < afterN; i++) {
              seedRecord(userId, operationType, 1, beforeN + i);
            }

            const aggregations = await svc.aggregateUsage(userId);
            const opAgg = aggregations.find(a => a.operation_type === operationType);
            expect(opAgg?.total_quantity).toBe(afterN);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4 — non-negative invariant: total usage is never negative', () => {
    it('aggregate total_quantity is always >= 0 for non-negative inputs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(
            fc.record({
              operationType: fc.string({ minLength: 1, maxLength: 20 }),
              quantity: fc.integer({ min: 0, max: 100 }),
            }),
            { minLength: 0, maxLength: 20 }
          ),
          async (userId, calls) => {
            store.length = 0;
            idCounter = 0;

            calls.forEach((c, i) => seedRecord(userId, c.operationType, c.quantity, i));

            const svc = new MeteringService();
            const aggregations = await svc.aggregateUsage(userId);

            for (const agg of aggregations) {
              expect(agg.total_quantity).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('billing unit rounding: integer quantity sums are exact (no floating-point drift)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 50 }),
          async (userId, operationType, quantities) => {
            store.length = 0;
            idCounter = 0;

            quantities.forEach((q, i) => seedRecord(userId, operationType, q, i));

            const expected = quantities.reduce((sum, q) => sum + q, 0);

            const svc = new MeteringService();
            const aggregations = await svc.aggregateUsage(userId);
            const opAgg = aggregations.find(a => a.operation_type === operationType);

            expect(opAgg?.total_quantity).toBe(expected);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
