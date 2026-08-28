import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
}));
const mockStripe = vi.hoisted(() => ({
  subscriptions: { retrieve: vi.fn() },
  subscriptionItems: { createUsageRecord: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => mockSupabase }));
vi.mock('@/lib/stripe/client', () => ({ stripe: mockStripe }));

import { MeteringService } from './metered-billing.service';

describe('MeteringService.reportPendingUsageToStripe()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({
          data: { stripe_subscription_id: 'sub_123' }, error: null,
        }) }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: async () => ({ data: [
                { quantity: 1, operation_type: 'one' },
                { quantity: 1, operation_type: 'two' },
                { quantity: 1, operation_type: 'three' },
                { quantity: 1, operation_type: 'four' },
              ], error: null }),
            }),
          }),
        }),
      };
    });
    mockStripe.subscriptions.retrieve.mockResolvedValue({ items: { data: [
      { id: 'si_123', price: { recurring: { usage_type: 'metered' } } },
    ] } });
  });

  it('stops the batch after three consecutive Stripe failures', async () => {
    const service = new MeteringService();
    const report = vi.spyOn(service, 'reportUsageToStripe')
      .mockResolvedValue({ success: false, error: 'Stripe unavailable' });

    const result = await service.reportPendingUsageToStripe('user-123');

    expect(report).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ reported: 0, failed: 3 });
  });

  it('resets the failure streak after a successful report', async () => {
    const service = new MeteringService();
    const report = vi.spyOn(service, 'reportUsageToStripe')
      .mockResolvedValueOnce({ success: false, error: 'temporary' })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValue({ success: false, error: 'Stripe unavailable' });

    const result = await service.reportPendingUsageToStripe('user-123');

    expect(report).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ reported: 1, failed: 3 });
  });
});