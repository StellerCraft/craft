import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const StripeConstructorMock = vi.fn();

vi.mock('stripe', () => {
    return {
        default: class MockStripe {
            constructor(secretKey: string, options: Record<string, unknown>) {
                StripeConstructorMock(secretKey, options);
                return { __mockStripeInstance: true, secretKey, options } as unknown as MockStripe;
            }
        },
    };
});

describe('stripe client', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        vi.resetModules();
        StripeConstructorMock.mockClear();
        process.env = { ...ORIGINAL_ENV };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('throws when STRIPE_SECRET_KEY is not set', async () => {
        delete process.env.STRIPE_SECRET_KEY;
        const { stripe } = await import('./client');

        expect(() => stripe.customers).toThrow('STRIPE_SECRET_KEY is not set');
        expect(StripeConstructorMock).not.toHaveBeenCalled();
    });

    it('initializes the SDK with the pinned API version and typescript mode once a key is present', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_123';
        const { stripe } = await import('./client');

        void stripe.customers;

        expect(StripeConstructorMock).toHaveBeenCalledTimes(1);
        expect(StripeConstructorMock).toHaveBeenCalledWith('sk_test_123', {
            apiVersion: '2026-02-25.clover',
            typescript: true,
        });
    });

    it('reuses the same underlying Stripe instance across multiple property accesses', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_456';
        const { stripe } = await import('./client');

        void stripe.customers;
        void stripe.subscriptions;
        void stripe.invoices;

        expect(StripeConstructorMock).toHaveBeenCalledTimes(1);
    });

    it('does not construct the client eagerly at module load time', async () => {
        process.env.STRIPE_SECRET_KEY = 'sk_test_789';
        await import('./client');

        expect(StripeConstructorMock).not.toHaveBeenCalled();
    });
});
