import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/api/with-auth';
import { paymentService } from '@/services/payment.service';
import { getValidPriceIds } from '@/lib/stripe/pricing';

const checkoutSchema = z.object({
    priceId: z.string().min(1),
    successUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
});

/**
 * POST /api/payments/checkout
 * Creates a Stripe checkout session for the authenticated user.
 * Returns { sessionId, url } on success.
 */
export const POST = withAuth(async (req: NextRequest, { user }) => {
    const body = await req.json();
    const parsed = checkoutSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    // Reject price IDs that are not mapped to a known tier.
    // This prevents callers from passing arbitrary Stripe price IDs.
    const validIds = getValidPriceIds();
    if (!validIds.includes(parsed.data.priceId)) {
        return NextResponse.json({ error: 'Invalid price ID' }, { status: 400 });
    }

    try {
        const session = await paymentService.createCheckoutSession(
            user.id,
            parsed.data.priceId,
            parsed.data.successUrl,
            parsed.data.cancelUrl
        );
        return NextResponse.json(session);
    } catch (error: any) {
        console.error('Error creating checkout session:', error);
        const isClientError = error.message === 'User email not found';
        return NextResponse.json(
            { error: error.message || 'Failed to create checkout session' },
            { status: isClientError ? 400 : 500 }
        );
    }
});
