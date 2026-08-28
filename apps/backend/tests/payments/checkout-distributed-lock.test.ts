import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as lockModule from '@/lib/supabase/supabase-lock';
import { PaymentService, CheckoutLockError } from '@/services/payment.service';

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { stripe_customer_id: 'cus_test' } }) }) }) }),
        auth: { getUser: async () => ({ data: { user: { email: 'u@example.com' } } }) },
    }),
}));

vi.mock('@/lib/stripe/client', () => ({
    stripe: {
        checkout: {
            sessions: {
                create: vi.fn(async () => ({ id: 'cs_test_123', url: 'https://stripe.com/cs_test' })),
            },
        },
    },
}));

vi.mock('@/services/payment-idempotency.service', () => ({
    paymentIdempotencyService: {
        generateKey: vi.fn(async () => 'ikey'),
        storeResponse: vi.fn(async () => {}),
    },
}));

vi.mock('@/lib/stripe/pricing', () => ({
    getTierFromPriceId: () => 'pro',
    getValidPriceIds: () => ['price_pro'],
}));

vi.mock('@/lib/stripe/tax', () => ({
    getTaxConfiguration: () => ({}),
    buildCheckoutTaxParams: () => ({}),
}));

vi.mock('@/services/invoice-delivery.service', () => ({
    invoiceDeliveryService: {},
}));

const acquireSpy = vi.spyOn(lockModule, 'acquireAdvisoryLock');
const releaseSpy = vi.spyOn(lockModule, 'releaseAdvisoryLock');

describe('PaymentService – distributed lock', () => {
    const svc = new PaymentService();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('acquires lock, calls inner logic, then releases on success', async () => {
        acquireSpy.mockResolvedValue(true);
        releaseSpy.mockResolvedValue(undefined);

        const result = await svc.createCheckoutSession('user-1', 'price_pro');

        expect(acquireSpy).toHaveBeenCalledWith('payment_checkout_user-1', 10_000);
        expect(result.sessionId).toBe('cs_test_123');
        expect(releaseSpy).toHaveBeenCalledWith('payment_checkout_user-1');
    });

    it('throws CheckoutLockError and does not release when lock not acquired', async () => {
        acquireSpy.mockResolvedValue(false);

        await expect(svc.createCheckoutSession('user-1', 'price_pro')).rejects.toBeInstanceOf(CheckoutLockError);
        expect(releaseSpy).not.toHaveBeenCalled();
    });

    it('releases lock even when inner logic throws', async () => {
        acquireSpy.mockResolvedValue(true);
        releaseSpy.mockResolvedValue(undefined);
        // Force inner to throw by making stripe fail
        const { stripe } = await import('@/lib/stripe/client');
        vi.mocked(stripe.checkout.sessions.create).mockRejectedValueOnce(new Error('stripe down'));

        await expect(svc.createCheckoutSession('user-1', 'price_pro')).rejects.toThrow('stripe down');
        expect(releaseSpy).toHaveBeenCalledWith('payment_checkout_user-1');
    });

    it('concurrent second request gets 409 when lock is held', async () => {
        let unlocked = false;
        acquireSpy.mockImplementation(async () => {
            // First call acquires, second fails (simulates held lock)
            if (!unlocked) { unlocked = true; return true; }
            return false;
        });
        releaseSpy.mockResolvedValue(undefined);

        // First request in progress (not awaited yet)
        const first = svc.createCheckoutSession('user-2', 'price_pro');
        const second = svc.createCheckoutSession('user-2', 'price_pro');

        await first;
        await expect(second).rejects.toBeInstanceOf(CheckoutLockError);
    });
});
