/**
 * Unit tests for payment API route handlers
 *
 * Routes covered:
 *   POST /api/payments/checkout    – price validation, session creation, auth guard
 *   GET  /api/payments/subscription – status retrieval, auth guard
 *   POST /api/payments/cancel       – cancellation, missing subscription, auth guard
 *
 * Mocks:
 *   @/lib/supabase/server  → withAuth session check + cancel route profile lookup
 *   @/services/payment.service → paymentService singleton
 *   @/lib/stripe/pricing   → getValidPriceIds
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Supabase mock (required by withAuth) ──────────────────────────────────────

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

// ── Payment service mock ──────────────────────────────────────────────────────

const mockCreateCheckoutSession = vi.fn();
const mockGetSubscriptionStatus = vi.fn();
const mockCancelSubscription = vi.fn();

vi.mock('@/services/payment.service', () => ({
    paymentService: {
        createCheckoutSession: mockCreateCheckoutSession,
        getSubscriptionStatus: mockGetSubscriptionStatus,
        cancelSubscription: mockCancelSubscription,
    },
}));

// ── Pricing mock ──────────────────────────────────────────────────────────────

const mockGetValidPriceIds = vi.fn();

vi.mock('@/lib/stripe/pricing', () => ({
    getValidPriceIds: () => mockGetValidPriceIds(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fakeUser = { id: 'user-1', email: 'a@b.com' };

const post = (url: string, body: unknown) =>
    new NextRequest(`http://localhost${url}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });

const get = (url: string) =>
    new NextRequest(`http://localhost${url}`, { method: 'GET' });

// ── POST /api/payments/checkout ───────────────────────────────────────────────

describe('POST /api/payments/checkout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
        mockGetValidPriceIds.mockReturnValue(['price_pro', 'price_ent']);
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { POST } = await import('./checkout/route');
        const res = await POST(post('/api/payments/checkout', { priceId: 'price_pro' }), { params: {} });
        expect(res.status).toBe(401);
    });

    it('returns 400 when priceId is missing', async () => {
        const { POST } = await import('./checkout/route');
        const res = await POST(post('/api/payments/checkout', {}), { params: {} });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Invalid input');
    });

    it('returns 400 when priceId is not in the valid set', async () => {
        const { POST } = await import('./checkout/route');
        const res = await POST(post('/api/payments/checkout', { priceId: 'price_unknown' }), { params: {} });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Invalid price ID');
    });

    it('returns 200 with sessionId and url on success', async () => {
        mockCreateCheckoutSession.mockResolvedValue({
            sessionId: 'cs_123',
            url: 'https://checkout.stripe.com/cs_123',
        });
        const { POST } = await import('./checkout/route');
        const res = await POST(post('/api/payments/checkout', { priceId: 'price_pro' }), { params: {} });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.sessionId).toBe('cs_123');
        expect(body.url).toBe('https://checkout.stripe.com/cs_123');
    });

    it('calls createCheckoutSession with the authenticated user id', async () => {
        mockCreateCheckoutSession.mockResolvedValue({ sessionId: 'cs_x', url: 'https://x' });
        const { POST } = await import('./checkout/route');
        await POST(post('/api/payments/checkout', { priceId: 'price_pro' }), { params: {} });
        expect(mockCreateCheckoutSession).toHaveBeenCalledWith('user-1', 'price_pro', undefined, undefined);
    });

    it('returns 500 when createCheckoutSession throws', async () => {
        mockCreateCheckoutSession.mockRejectedValue(new Error('Stripe error'));
        const { POST } = await import('./checkout/route');
        const res = await POST(post('/api/payments/checkout', { priceId: 'price_pro' }), { params: {} });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('Stripe error');
    });
});

// ── GET /api/payments/subscription ───────────────────────────────────────────

describe('GET /api/payments/subscription', () => {
    const fakeStatus = {
        tier: 'pro',
        status: 'active',
        currentPeriodEnd: new Date('2026-12-31'),
        cancelAtPeriodEnd: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./subscription/route');
        const res = await GET(get('/api/payments/subscription'), { params: {} });
        expect(res.status).toBe(401);
    });

    it('returns 200 with subscription status', async () => {
        mockGetSubscriptionStatus.mockResolvedValue(fakeStatus);
        const { GET } = await import('./subscription/route');
        const res = await GET(get('/api/payments/subscription'), { params: {} });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.tier).toBe('pro');
        expect(body.status).toBe('active');
        expect(body.cancelAtPeriodEnd).toBe(false);
    });

    it('calls getSubscriptionStatus with the authenticated user id', async () => {
        mockGetSubscriptionStatus.mockResolvedValue(fakeStatus);
        const { GET } = await import('./subscription/route');
        await GET(get('/api/payments/subscription'), { params: {} });
        expect(mockGetSubscriptionStatus).toHaveBeenCalledWith('user-1');
    });

    it('returns 500 when getSubscriptionStatus throws', async () => {
        mockGetSubscriptionStatus.mockRejectedValue(new Error('DB error'));
        const { GET } = await import('./subscription/route');
        const res = await GET(get('/api/payments/subscription'), { params: {} });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('DB error');
    });
});

// ── POST /api/payments/cancel ─────────────────────────────────────────────────

describe('POST /api/payments/cancel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    const makeProfileQuery = (subscriptionId: string | null) => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
            data: subscriptionId ? { stripe_subscription_id: subscriptionId } : null,
        }),
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { POST } = await import('./cancel/route');
        const res = await POST(post('/api/payments/cancel', {}), { params: {} });
        expect(res.status).toBe(401);
    });

    it('returns 404 when no active subscription is found', async () => {
        mockFrom.mockReturnValue(makeProfileQuery(null));
        const { POST } = await import('./cancel/route');
        const res = await POST(post('/api/payments/cancel', {}), { params: {} });
        expect(res.status).toBe(404);
        expect((await res.json()).error).toBe('No active subscription found');
    });

    it('returns 200 on successful cancellation', async () => {
        mockFrom.mockReturnValue(makeProfileQuery('sub_abc'));
        mockCancelSubscription.mockResolvedValue(undefined);
        const { POST } = await import('./cancel/route');
        const res = await POST(post('/api/payments/cancel', {}), { params: {} });
        expect(res.status).toBe(200);
        expect((await res.json()).success).toBe(true);
    });

    it('calls cancelSubscription with the stored subscription ID', async () => {
        mockFrom.mockReturnValue(makeProfileQuery('sub_abc'));
        mockCancelSubscription.mockResolvedValue(undefined);
        const { POST } = await import('./cancel/route');
        await POST(post('/api/payments/cancel', {}), { params: {} });
        expect(mockCancelSubscription).toHaveBeenCalledWith('sub_abc');
    });

    it('returns 500 when cancelSubscription throws', async () => {
        mockFrom.mockReturnValue(makeProfileQuery('sub_abc'));
        mockCancelSubscription.mockRejectedValue(new Error('Stripe cancel error'));
        const { POST } = await import('./cancel/route');
        const res = await POST(post('/api/payments/cancel', {}), { params: {} });
        expect(res.status).toBe(500);
        expect((await res.json()).error).toBe('Stripe cancel error');
    });
});
