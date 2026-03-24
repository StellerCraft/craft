import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authService } from '@/services/auth.service';
import { withRateLimit } from '@/lib/api/with-rate-limit';
import { AUTH_RATE_LIMIT } from '@/lib/api/rate-limit';

const signUpSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
});

/**
 * POST /api/auth/signup
 * Creates a new user account and returns the user + session.
 * Returns 409 if the email is already registered.
 * Rate limited: 10 requests per 15 minutes per IP (see AUTH_RATE_LIMIT).
 */
export const POST = withRateLimit('auth:signup', AUTH_RATE_LIMIT)(
    async (req: NextRequest) => {
        const body = await req.json();
        const parsed = signUpSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
                { status: 400 }
            );
        }

        const result = await authService.signUp(parsed.data.email, parsed.data.password);

        if (result.error) {
            const status = result.error.code === 'PROFILE_CREATION_ERROR' ? 409 : 400;
            return NextResponse.json({ error: result.error.message }, { status });
        }

        return NextResponse.json({ user: result.user, session: result.session }, { status: 201 });
    }
);
