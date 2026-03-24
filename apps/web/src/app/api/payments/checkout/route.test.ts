import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Supabase server mock (required by withAuth) ---
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: vi.fn(),
    }),
}));

// --- Payment service mock ---
const mockCreateCheckoutSession = vi.fn();
vi.mock('@/services/payment.service', () => ({
    paymentService: { createCheckoutSession: mockCreateCheckoutSession },
}));

const fakeUser = { id: 'user-1', email: 'a@b.com' };
const fakeSession = { sessionId: 'cs_test_123', url: 'https://checkout.stripe.com/pay/cs_test_123' };

const post = (body: unknown) =>
    new NextRequest('http://localhost/api/payments/checkout', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });

describe('POST /api/payments/checkout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { POST } = await import('./route');
        const res = await POST(post({ priceId: 'price_123' }), { params: {} });
        expect(res.status).toBe(401);
    });

    it('returns 400 when priceId is missing', async () => {
        const { POST } = await import('./route');
        const res = await POST(post({}), { params: {} });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Invalid input');
        expect(body.details).toBeDefined();
    });

    it('returns 400 when priceId is empty string', async () => {
        const { POST } = await import('./route');
        const res = await POST(post({ priceId: '' }), { params: {} });
        expect(res.status).toBe(400);
    });

    it('returns 400 when successUrl is not a valid URL', async () => {
        const { POST } = await import('./route');
        const res = await POST(post({ priceId: 'price_123', successUrl: 'not-a-url' }), { params: {} });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.details.successUrl).toBeDefined();
    });

    it('returns 400 when cancelUrl is not a valid URL', async () => {
        const { POST } = await import('./route');
        const res = await POST(post({ priceId: 'price_123', cancelUrl: 'not-a-url' }), { params: {} });
        expect(res.status).toBe(400);
    });

    it('returns sessionId and url on success', async () => {
        mockCreateCheckoutSession.mockResolvedValue(fakeSession);
        const { POST } = await import('./route');
        const res = await POST(post({ priceId: 'price_123' }), { params: {} });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.sessionId).toBe('cs_test_123');
        expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test_123');
    });

    it('passes optional successUrl and cancelUrl to the service', async () => {
        mockCreateCheckoutSession.mockResolvedValue(fakeSession);
        const { POST } = await import('./route');
        await POST(
            post({ priceId: 'price_123', successUrl: 'https://app.example.com/success', cancelUrl: 'https://app.example.com/cancel' }),
            { params: {} }
        );
        expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
            fakeUser.id,
            'price_123',
            'https://app.example.com/success',
            'https://app.example.com/cancel'
        );
    });

    it('returns 400 when service throws "User email not found"', async () => {
        mockCreateCheckoutSession.mockRejectedValue(new Error('User email not found'));
        const { POST } = await import('./route');
        const res = await POST(post({ priceId: 'price_123' }), { params: {} });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('User email not found');
    });

    it('returns 500 on unexpected service error', async () => {
        mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe API error'));
        const { POST } = await import('./route');
        const res = await POST(post({ priceId: 'price_123' }), { params: {} });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('Stripe API error');
    });
});
