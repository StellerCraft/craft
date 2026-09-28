import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentIdempotencyService } from './payment-idempotency.service';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

const lookupQuery = {
  select: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  single: vi.fn(),
  insert: mocks.insert,
};

for (const method of [lookupQuery.select, lookupQuery.eq, lookupQuery.gt, lookupQuery.order, lookupQuery.limit]) {
  method.mockReturnValue(lookupQuery);
}

describe('PaymentIdempotencyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue(lookupQuery);
    lookupQuery.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'RPC unavailable' } });
  });

  it('fails closed when the atomic RPC fails instead of inserting through a fallback', async () => {
    const service = new PaymentIdempotencyService();

    await expect(service.generateKey('user-1', 'checkout_session')).rejects.toThrow(
      'Failed to generate idempotency key atomically: RPC unavailable',
    );

    expect(mocks.rpc).toHaveBeenCalledWith('generate_payment_idempotency_key', {
      p_user_id: 'user-1',
      p_operation_type: 'checkout_session',
      p_request_fingerprint: null,
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});