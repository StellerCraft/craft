import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { stripe } from '@/lib/stripe/client';
import { GET } from './route';

// ── Stripe Mock ──────────────────────────────────────────────────────────────

vi.mock('@/lib/stripe/client', () => ({
    stripe: {
        subscriptions: {
            retrieve: vi.fn(),
        },
    },
}));

// ── Supabase Mock ────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: {
            getUser: mockGetUser,
        },
        from: mockFrom,
    }),
}));

// ── Helpers & Fixtures ────────────────────────────────────────────────────────

const mockStripeMethods = stripe as any;

const makeProfileQuery = (profileData: Record<string, unknown> | null, error: unknown = null) => {
    const chainMethods = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
            data: profileData,
            error,
        }),
    };
    return chainMethods;
};

const createGetRequest = (url = 'http://localhost/api/payments/subscription') =>
    new NextRequest(url, { method: 'GET' });

describe('GET /api/payments/subscription (Integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Authenticated user with an active subscription', () => {
        it('returns 200 with active subscription details retrieved from Stripe', async () => {
            const userId = 'user-pro-123';
            const stripeSubscriptionId = 'sub_active_456';
            const periodEndTimestamp = 1735689600; // 2025-01-01T00:00:00.000Z

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId, email: 'pro@example.com' } },
                error: null,
            });

            mockFrom.mockReturnValue(
                makeProfileQuery({
                    subscription_tier: 'pro',
                    subscription_status: 'active',
                    stripe_subscription_id: stripeSubscriptionId,
                })
            );

            mockStripeMethods.subscriptions.retrieve.mockResolvedValue({
                id: stripeSubscriptionId,
                status: 'active',
                current_period_end: periodEndTimestamp,
                cancel_at_period_end: false,
            });

            const res = await GET(createGetRequest(), { params: {} });
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body).toEqual({
                tier: 'pro',
                status: 'active',
                currentPeriodEnd: new Date(periodEndTimestamp * 1000).toISOString(),
                cancelAtPeriodEnd: false,
            });

            expect(mockFrom).toHaveBeenCalledWith('profiles');
            expect(mockStripeMethods.subscriptions.retrieve).toHaveBeenCalledWith(stripeSubscriptionId);
        });

        it('correctly surfaces cancelAtPeriodEnd flag when subscription is pending cancellation', async () => {
            const userId = 'user-cancel-123';
            const stripeSubscriptionId = 'sub_canceling_789';
            const periodEndTimestamp = 1767225600; // 2026-01-01T00:00:00.000Z

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId, email: 'canceling@example.com' } },
                error: null,
            });

            mockFrom.mockReturnValue(
                makeProfileQuery({
                    subscription_tier: 'enterprise',
                    subscription_status: 'active',
                    stripe_subscription_id: stripeSubscriptionId,
                })
            );

            mockStripeMethods.subscriptions.retrieve.mockResolvedValue({
                id: stripeSubscriptionId,
                status: 'active',
                current_period_end: periodEndTimestamp,
                cancel_at_period_end: true,
            });

            const res = await GET(createGetRequest(), { params: {} });
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body).toEqual({
                tier: 'enterprise',
                status: 'active',
                currentPeriodEnd: new Date(periodEndTimestamp * 1000).toISOString(),
                cancelAtPeriodEnd: true,
            });
        });
    });

    describe('No subscription (free-tier) user', () => {
        it('returns 200 with default active free tier status when stripe_subscription_id is null', async () => {
            const userId = 'user-free-123';

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId, email: 'free@example.com' } },
                error: null,
            });

            mockFrom.mockReturnValue(
                makeProfileQuery({
                    subscription_tier: 'free',
                    subscription_status: null,
                    stripe_subscription_id: null,
                })
            );

            const res = await GET(createGetRequest(), { params: {} });
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.tier).toBe('free');
            expect(body.status).toBe('active');
            expect(body.cancelAtPeriodEnd).toBe(false);
            expect(typeof body.currentPeriodEnd).toBe('string');
            expect(isNaN(Date.parse(body.currentPeriodEnd))).toBe(false);

            expect(mockFrom).toHaveBeenCalledWith('profiles');
            expect(mockStripeMethods.subscriptions.retrieve).not.toHaveBeenCalled();
        });

        it('returns 200 with default active free tier status when profile is not found', async () => {
            const userId = 'user-noprofile-123';

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId, email: 'noprofile@example.com' } },
                error: null,
            });

            mockFrom.mockReturnValue(makeProfileQuery(null));

            const res = await GET(createGetRequest(), { params: {} });
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.tier).toBe('free');
            expect(body.status).toBe('active');
            expect(body.cancelAtPeriodEnd).toBe(false);
            expect(typeof body.currentPeriodEnd).toBe('string');
            expect(isNaN(Date.parse(body.currentPeriodEnd))).toBe(false);

            expect(mockStripeMethods.subscriptions.retrieve).not.toHaveBeenCalled();
        });
    });

    describe('Unauthenticated request', () => {
        it('returns 401 Unauthorized when user session is missing', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null,
            });

            const res = await GET(createGetRequest(), { params: {} });
            expect(res.status).toBe(401);

            const body = await res.json();
            expect(body).toEqual({ error: 'Unauthorized' });

            expect(mockFrom).not.toHaveBeenCalled();
            expect(mockStripeMethods.subscriptions.retrieve).not.toHaveBeenCalled();
        });

        it('returns 401 Unauthorized when auth.getUser returns an error', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: { message: 'Invalid or expired token' },
            });

            const res = await GET(createGetRequest(), { params: {} });
            expect(res.status).toBe(401);

            const body = await res.json();
            expect(body).toEqual({ error: 'Unauthorized' });

            expect(mockFrom).not.toHaveBeenCalled();
            expect(mockStripeMethods.subscriptions.retrieve).not.toHaveBeenCalled();
        });
    });

    describe('Error handling', () => {
        it('returns 500 when Stripe subscription retrieval throws an error', async () => {
            const userId = 'user-error-123';

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId, email: 'error@example.com' } },
                error: null,
            });

            mockFrom.mockReturnValue(
                makeProfileQuery({
                    subscription_tier: 'pro',
                    subscription_status: 'active',
                    stripe_subscription_id: 'sub_fail_123',
                })
            );

            mockStripeMethods.subscriptions.retrieve.mockRejectedValue(
                new Error('Stripe API unavailable')
            );

            const res = await GET(createGetRequest(), { params: {} });
            expect(res.status).toBe(500);

            const body = await res.json();
            expect(body).toEqual({ error: 'Stripe API unavailable' });
        });

        it('returns 500 when database profile retrieval throws an unhandled error', async () => {
            const userId = 'user-db-fail';

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId, email: 'dbfail@example.com' } },
                error: null,
            });

            mockFrom.mockImplementation(() => {
                throw new Error('Database connection failed');
            });

            const res = await GET(createGetRequest(), { params: {} });
            expect(res.status).toBe(500);

            const body = await res.json();
            expect(body).toEqual({ error: 'Database connection failed' });
        });
    });
});
