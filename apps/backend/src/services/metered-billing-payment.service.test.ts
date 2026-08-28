import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MeteringPaymentIntegration,
  meteringPayment,
} from './metered-billing-payment.service';
import { stripe } from '@/lib/stripe/client';
import { createClient } from '@/lib/supabase/server';
import { meterService } from '@/services/metered-billing.service';

vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    customers: {
      create: vi.fn(),
    },
    subscriptions: {
      create: vi.fn(),
      retrieve: vi.fn(),
    },
    subscriptionItems: {
      createUsageRecord: vi.fn(),
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/services/metered-billing.service', () => ({
  meterService: {
    recordUsage: vi.fn(),
    aggregateUsage: vi.fn(),
    reportPendingUsageToStripe: vi.fn(),
    getUsageStats: vi.fn(),
  },
}));

describe('MeteringPaymentIntegration', () => {
  let integration: MeteringPaymentIntegration;
  let mockSupabase: any;
  let profileData: any;
  let profileError: any;
  let authUserData: any;
  let profileUpdates: any[];
  let usageRecordUpdates: any[];

  beforeEach(() => {
    integration = new MeteringPaymentIntegration();
    vi.clearAllMocks();

    profileData = {
      stripe_customer_id: 'cus_existing_123',
      stripe_subscription_id: 'sub_test_456',
    };
    profileError = null;
    authUserData = { user: { email: 'test@example.com' } };
    profileUpdates = [];
    usageRecordUpdates = [];

    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: profileData,
                  error: profileError,
                })),
              })),
            })),
            update: vi.fn((data: any) => ({
              eq: vi.fn(async (_col: string, val: any) => {
                profileUpdates.push({ data, userId: val });
                return { data: null, error: null };
              }),
            })),
          };
        }
        if (table === 'usage_records') {
          return {
            update: vi.fn((data: any) => ({
              eq: vi.fn(async (_col: string, id: any) => {
                usageRecordUpdates.push({ data, id });
                return { data: null, error: null };
              }),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      auth: {
        getUser: vi.fn(async () => ({
          data: authUserData,
          error: null,
        })),
      },
    };

    vi.mocked(createClient).mockReturnValue(mockSupabase);
  });

  describe('createMeteredBillingSubscription', () => {
    it('creates a metered subscription for a customer with an existing Stripe customer ID', async () => {
      vi.mocked(stripe.subscriptions.create).mockResolvedValueOnce({
        id: 'sub_new_789',
        items: {
          data: [{ id: 'si_item_789', price: { id: 'price_metered_123' } }],
        },
      } as any);

      const result = await integration.createMeteredBillingSubscription(
        'user_1',
        'price_metered_123'
      );

      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(stripe.subscriptions.create).toHaveBeenCalledWith({
        customer: 'cus_existing_123',
        items: [{ price: 'price_metered_123' }],
        metadata: {
          user_id: 'user_1',
          billing_type: 'metered',
        },
      });

      expect(profileUpdates).toContainEqual({
        userId: 'user_1',
        data: {
          stripe_subscription_id: 'sub_new_789',
          subscription_tier: 'pro',
          subscription_status: 'active',
        },
      });

      expect(result).toEqual({
        subscriptionId: 'sub_new_789',
        subscriptionItemId: 'si_item_789',
      });
    });

    it('creates a new Stripe customer when profile has no stripe_customer_id', async () => {
      profileData = { stripe_customer_id: null };

      vi.mocked(stripe.customers.create).mockResolvedValueOnce({
        id: 'cus_newly_created',
      } as any);

      vi.mocked(stripe.subscriptions.create).mockResolvedValueOnce({
        id: 'sub_new_abc',
        items: {
          data: [{ id: 'si_item_abc', price: { id: 'price_metered_abc' } }],
        },
      } as any);

      const result = await integration.createMeteredBillingSubscription(
        'user_2',
        'price_metered_abc'
      );

      expect(stripe.customers.create).toHaveBeenCalledWith({
        email: 'test@example.com',
        metadata: {
          supabase_user_id: 'user_2',
          tier: 'metered',
        },
      });

      // Verify profile customer ID update was performed
      expect(profileUpdates).toContainEqual({
        userId: 'user_2',
        data: { stripe_customer_id: 'cus_newly_created' },
      });

      expect(result).toEqual({
        subscriptionId: 'sub_new_abc',
        subscriptionItemId: 'si_item_abc',
      });
    });

    it('throws error when creating customer if user email is missing', async () => {
      profileData = { stripe_customer_id: null };
      authUserData = { user: { email: null } };

      await expect(
        integration.createMeteredBillingSubscription('user_no_email', 'price_123')
      ).rejects.toThrow('User email not found');

      expect(stripe.customers.create).not.toHaveBeenCalled();
      expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    });

    it('propagates Stripe subscription creation failures', async () => {
      vi.mocked(stripe.subscriptions.create).mockRejectedValueOnce(
        new Error('Stripe card error')
      );

      await expect(
        integration.createMeteredBillingSubscription('user_fail', 'price_fail')
      ).rejects.toThrow('Stripe card error');
    });
  });

  describe('reportUsage', () => {
    beforeEach(() => {
      vi.mocked(meterService.recordUsage).mockResolvedValue({
        id: 'rec_usage_001',
        user_id: 'user_1',
        operation_type: 'api_call',
        quantity: 5,
        reported_to_stripe: false,
      } as any);

      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValue({
        id: 'sub_test_456',
        items: {
          data: [
            {
              id: 'si_metered_001',
              price: {
                recurring: {
                  usage_type: 'metered',
                },
              },
            },
          ],
        },
      } as any);

      vi.mocked(stripe.subscriptionItems.createUsageRecord).mockResolvedValue({
        id: 'usgr_stripe_999',
      } as any);
    });

    it('successfully reports usage to Stripe and marks local record as reported', async () => {
      const fixedTimestamp = 1700000000;
      const result = await integration.reportUsage(
        'user_1',
        'api_call',
        5,
        fixedTimestamp
      );

      expect(meterService.recordUsage).toHaveBeenCalledWith('user_1', 'api_call', 5);
      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_test_456');
      expect(stripe.subscriptionItems.createUsageRecord).toHaveBeenCalledWith(
        'si_metered_001',
        {
          quantity: 5,
          timestamp: fixedTimestamp,
          action: 'increment',
        }
      );

      expect(usageRecordUpdates).toContainEqual({
        id: 'rec_usage_001',
        data: expect.objectContaining({
          stripe_usage_record_id: 'usgr_stripe_999',
          reported_to_stripe: true,
        }),
      });

      expect(result).toEqual({ success: true });
    });

    it('handles boundary case with quantity of 0', async () => {
      const result = await integration.reportUsage('user_1', 'api_call', 0);

      expect(meterService.recordUsage).toHaveBeenCalledWith('user_1', 'api_call', 0);
      expect(stripe.subscriptionItems.createUsageRecord).toHaveBeenCalledWith(
        'si_metered_001',
        expect.objectContaining({
          quantity: 0,
          action: 'increment',
        })
      );
      expect(result.success).toBe(true);
    });

    it('defaults quantity to 1 and generates current timestamp when omitted', async () => {
      const beforeTime = Math.floor(Date.now() / 1000);
      const result = await integration.reportUsage('user_1', 'deployment_create');
      const afterTime = Math.floor(Date.now() / 1000);

      expect(meterService.recordUsage).toHaveBeenCalledWith(
        'user_1',
        'deployment_create',
        1
      );

      const usageCallArgs = vi.mocked(stripe.subscriptionItems.createUsageRecord).mock.calls[0][1];
      expect(usageCallArgs.quantity).toBe(1);
      expect(usageCallArgs.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(usageCallArgs.timestamp).toBeLessThanOrEqual(afterTime);
      expect(result).toEqual({ success: true });
    });

    it('returns error when user has no active subscription ID in profile', async () => {
      profileData = { stripe_subscription_id: null };

      const result = await integration.reportUsage('user_no_sub', 'api_call', 1);

      expect(result).toEqual({
        success: false,
        error: 'No subscription found for user',
      });
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('returns error when fetching profile returns database error', async () => {
      profileError = { message: 'Database lookup failed' };

      const result = await integration.reportUsage('user_err', 'api_call', 1);

      expect(result).toEqual({
        success: false,
        error: 'No subscription found for user',
      });
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it('returns error when subscription has no metered recurring item', async () => {
      vi.mocked(stripe.subscriptions.retrieve).mockResolvedValueOnce({
        id: 'sub_licensed_only',
        items: {
          data: [
            {
              id: 'si_licensed_001',
              price: {
                recurring: {
                  usage_type: 'licensed',
                },
              },
            },
          ],
        },
      } as any);

      const result = await integration.reportUsage('user_1', 'api_call', 1);

      expect(result).toEqual({
        success: false,
        error: 'No metered subscription item found',
      });
      expect(stripe.subscriptionItems.createUsageRecord).not.toHaveBeenCalled();
    });

    it('surfaces Stripe API errors with full error message detail', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(stripe.subscriptionItems.createUsageRecord).mockRejectedValueOnce(
        new Error('Stripe rate limit exceeded: rate_limit')
      );

      const result = await integration.reportUsage('user_1', 'api_call', 10);

      expect(result).toEqual({
        success: false,
        error: 'Stripe rate limit exceeded: rate_limit',
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('getAggregatedUsage', () => {
    it('aggregates usage quantities across multiple operation types', async () => {
      const mockPeriod = {
        start: new Date('2026-08-01T00:00:00Z'),
        end: new Date('2026-08-31T23:59:59Z'),
      };

      vi.mocked(meterService.aggregateUsage).mockResolvedValueOnce([
        {
          operation_type: 'api_call',
          total_quantity: 150,
          period: mockPeriod,
        },
        {
          operation_type: 'build_minutes',
          total_quantity: 45,
          period: mockPeriod,
        },
      ] as any);

      const result = await integration.getAggregatedUsage('user_agg');

      expect(meterService.aggregateUsage).toHaveBeenCalledWith('user_agg');
      expect(result).toEqual({
        billingPeriod: mockPeriod,
        usageByType: [
          { type: 'api_call', quantity: 150 },
          { type: 'build_minutes', quantity: 45 },
        ],
        totalQuantity: 195,
      });
    });

    it('returns empty usage with 0 total quantity when no usage exists', async () => {
      vi.mocked(meterService.aggregateUsage).mockResolvedValueOnce([]);

      const result = await integration.getAggregatedUsage('user_empty');

      expect(result.totalQuantity).toBe(0);
      expect(result.usageByType).toEqual([]);
      expect(result.billingPeriod.start).toBeInstanceOf(Date);
      expect(result.billingPeriod.end).toBeInstanceOf(Date);
    });
  });

  describe('syncPendingUsage', () => {
    it('returns synced counts without nextSyncTime when all records succeed', async () => {
      vi.mocked(meterService.reportPendingUsageToStripe).mockResolvedValueOnce({
        reported: 12,
        failed: 0,
      } as any);

      const result = await integration.syncPendingUsage('user_sync');

      expect(meterService.reportPendingUsageToStripe).toHaveBeenCalledWith('user_sync');
      expect(result).toEqual({
        synced: 12,
        failed: 0,
        nextSyncTime: undefined,
      });
    });

    it('schedules nextSyncTime in 60 seconds when there are failed reports', async () => {
      vi.mocked(meterService.reportPendingUsageToStripe).mockResolvedValueOnce({
        reported: 8,
        failed: 2,
      } as any);

      const before = Date.now();
      const result = await integration.syncPendingUsage('user_sync_fail');
      const after = Date.now();

      expect(result.synced).toBe(8);
      expect(result.failed).toBe(2);
      expect(result.nextSyncTime).toBeGreaterThanOrEqual(before + 60000);
      expect(result.nextSyncTime).toBeLessThanOrEqual(after + 60000);
    });
  });

  describe('getBillingPeriod', () => {
    it('computes exact month start and end timestamps for a given date', () => {
      const testDate = new Date('2026-02-15T12:00:00Z');
      const period = integration.getBillingPeriod(testDate);

      // February 2026 has 28 days
      expect(period.start.getFullYear()).toBe(2026);
      expect(period.start.getMonth()).toBe(1); // February (0-indexed)
      expect(period.start.getDate()).toBe(1);

      expect(period.end.getFullYear()).toBe(2026);
      expect(period.end.getMonth()).toBe(1);
      expect(period.end.getDate()).toBe(28);
      expect(period.end.getHours()).toBe(23);
      expect(period.end.getMinutes()).toBe(59);
      expect(period.end.getSeconds()).toBe(59);
    });

    it('defaults to current month period when no argument is provided', () => {
      const now = new Date();
      const period = integration.getBillingPeriod();

      expect(period.start.getFullYear()).toBe(now.getFullYear());
      expect(period.start.getMonth()).toBe(now.getMonth());
      expect(period.start.getDate()).toBe(1);
    });
  });

  describe('isUsageWithinLimits', () => {
    it('returns true when all usage types are within limits', async () => {
      vi.mocked(meterService.getUsageStats).mockResolvedValueOnce({
        by_type: [
          { type: 'api_call', count: 50 },
          { type: 'deployment', count: 3 },
        ],
      } as any);

      const tierLimits = {
        api_call: { monthly: 100 },
        deployment: { monthly: 10 },
      };

      const withinLimits = await integration.isUsageWithinLimits('user_limit', tierLimits);
      expect(withinLimits).toBe(true);
    });

    it('returns false when any usage type exceeds monthly limit', async () => {
      vi.mocked(meterService.getUsageStats).mockResolvedValueOnce({
        by_type: [
          { type: 'api_call', count: 150 },
          { type: 'deployment', count: 2 },
        ],
      } as any);

      const tierLimits = {
        api_call: { monthly: 100 },
        deployment: { monthly: 10 },
      };

      const withinLimits = await integration.isUsageWithinLimits('user_limit', tierLimits);
      expect(withinLimits).toBe(false);
    });

    it('ignores usage types that are unconstrained in tier limits', async () => {
      vi.mocked(meterService.getUsageStats).mockResolvedValueOnce({
        by_type: [
          { type: 'unlimited_feature', count: 99999 },
        ],
      } as any);

      const tierLimits = {
        api_call: { monthly: 100 },
      };

      const withinLimits = await integration.isUsageWithinLimits('user_limit', tierLimits);
      expect(withinLimits).toBe(true);
    });
  });

  describe('singleton export', () => {
    it('meteringPayment is an instance of MeteringPaymentIntegration', () => {
      expect(meteringPayment).toBeInstanceOf(MeteringPaymentIntegration);
    });
  });
});
