import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { validateCustomizationConfig } from '@/lib/customization/validate';

/**
 * POST /api/customization/validate
 * Validates a customization config payload without persisting it.
 * Returns { valid, errors } — stable contract for preview and deployment consumers.
 */
export const POST = withAuth(async (req: NextRequest) => {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const result = validateCustomizationConfig(body);
    return NextResponse.json(result, { status: result.valid ? 200 : 422 });
});
