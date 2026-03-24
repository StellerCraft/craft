import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Stripe client mock ---
const mockConstructEvent = vi.fn();
vi.mock('@/lib/stripe/client', () => ({
    stripe: { webhooks: { constructEvent: mockConstructEvent } },
}));

// --- Payment service mock ---
const mockHandleWebhook = vi.fn();
vi.mock('@/services/payment.service', () => ({
    paymentService: { handleWebhook: mockHandleWebhook },
}));

const WEBHOOK_SECRET = 'whsec_test';
const VALID_SIG = 'valid-sig';

const makeRequest = (body: string, signature?: string) =>
    new NextRequest('http://localhost/api/webhooks/stripe', {
        method: 'POST',
        body,
        headers: signature ? { 'stripe-signature': signature } : {},
    });

const fakeEvent = (type: string) => ({ id: 'evt_1', type, data: { object: {} } });

describe('POST /api/webhooks/stripe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    });

    it('returns 400 when stripe-signature header is missing', async () => {
        const { POST } = await import('./route');
        const res = await POST(makeRequest('{}'));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Missing stripe-signature header');
    });

    it('returns 500 when STRIPE_WEBHOOK_SECRET is not set', async () => {
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
        const { POST } = await import('./route');
        const res = await POST(makeRequest('{}', VALID_SIG));
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('Webhook secret not configured');
    });

    it('returns 400 when signature verification fails', async () => {
        mockConstructEvent.mockImplementation(() => { throw new Error('No signatures found'); });
        const { POST } = await import('./route');
        const res = await POST(makeRequest('{}', 'bad-sig'));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Invalid signature');
    });

    it('returns 200 without calling handleWebhook for unsupported event types', async () => {
        mockConstructEvent.mockReturnValue(fakeEvent('payment_intent.created'));
        const { POST } = await import('./route');
        const res = await POST(makeRequest('{}', VALID_SIG));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: true });
        expect(mockHandleWebhook).not.toHaveBeenCalled();
    });

    it.each([
        'checkout.session.completed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'invoice.payment_succeeded',
        'invoice.payment_failed',
    ])('delegates %s to paymentService.handleWebhook', async (type) => {
        const event = fakeEvent(type);
        mockConstructEvent.mockReturnValue(event);
        mockHandleWebhook.mockResolvedValue(undefined);
        const { POST } = await import('./route');
        const res = await POST(makeRequest('{}', VALID_SIG));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: true });
        expect(mockHandleWebhook).toHaveBeenCalledWith(event);
    });

    it('returns 500 when handleWebhook throws', async () => {
        mockConstructEvent.mockReturnValue(fakeEvent('checkout.session.completed'));
        mockHandleWebhook.mockRejectedValue(new Error('DB error'));
        const { POST } = await import('./route');
        const res = await POST(makeRequest('{}', VALID_SIG));
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('Webhook processing failed');
    });
});
