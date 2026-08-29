/**
 * Integration test for issue #1151.
 *
 * A retried checkout request that lands in a different one-second window than
 * the original is de-duplicated at the payment layer (no duplicate charge) but
 * was previously NOT de-duplicated at the metering layer, because
 * `MeteringService.generateIdempotencyKey` derives its own one-second-granularity
 * key (`operationType-userId-second`). The user is billed once but metered twice.
 *
 * This test simulates a checkout retry that lands in a different second and
 * asserts that, when the payment idempotency key is threaded through
 * `reportUsage`, only ONE usage record is produced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeteringPaymentIntegration } from './metered-billing-payment.service';

let usageUpserts: any[] = [];

const mockSupabase = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        single: async () => {
          if (table === 'profiles') {
            return {
              data: {
                stripe_subscription_id: 'sub_123',
                stripe_customer_id: 'cus_123',
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      }),
    }),
    update: () => ({
      eq: () => ({
        then: async () => ({ data: null, error: null }),
      }),
    }),
    upsert: (payload: any) => {
      if (table === 'usage_records') {
        usageUpserts.push(payload);
      }
      return {
        select: () => ({
          single: async () => ({ data: payload, error: null }),
        }),
      };
    },
  }),
};

const mockStripe = {
  subscriptions: {
    retrieve: async () => ({
      items: {
        data: [
          {
            id: 'si_123',
            price: { recurring: { usage_type: 'metered' } },
          },
        ],
      },
    }),
  },
  subscriptionItems: {
    createUsageRecord: async () => ({ id: 'usgr_123' }),
  },
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase as any,
}));

vi.mock('@/lib/stripe/client', () => ({
  stripe: mockStripe,
}));

describe('MeteringPaymentIntegration – checkout retry must not double-meter (#1151)', () => {
  beforeEach(() => {
    usageUpserts = [];
  });

  it('meters a retried checkout exactly once when the payment idempotency key is threaded through', async () => {
    const metering = new MeteringPaymentIntegration();
    const paymentIdempotencyKey = 'idem-checkout-abc-123';

    // Original attempt.
    await metering.reportUsage('user_1', 'api_call', 1, undefined, paymentIdempotencyKey);
    // Retry landing in a different calendar second.
    await metering.reportUsage('user_1', 'api_call', 1, undefined, paymentIdempotencyKey);

    const keys = usageUpserts.map((u) => u.idempotency_key);
    expect(keys).toEqual([paymentIdempotencyKey, paymentIdempotencyKey]);
    // Exactly one unique metering identity => one logical usage record.
    expect(new Set(keys).size).toBe(1);
  });

  it('still de-duplicates even when the two attempts cross a one-second boundary', async () => {
    const metering = new MeteringPaymentIntegration();
    const paymentIdempotencyKey = 'idem-checkout-xyz-789';

    const realNow = Date.now;
    // First attempt at t=0s.
    Date.now = () => 1000;
    await metering.reportUsage('user_2', 'api_call', 1, undefined, paymentIdempotencyKey);
    // Retry at t=5s (different one-second bucket for the derived key).
    Date.now = () => 5000;
    await metering.reportUsage('user_2', 'api_call', 1, undefined, paymentIdempotencyKey);
    Date.now = realNow;

    const keys = usageUpserts.map((u) => u.idempotency_key);
    expect(new Set(keys).size).toBe(1);
  });
});
