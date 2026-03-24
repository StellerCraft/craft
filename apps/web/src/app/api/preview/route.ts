import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { validateCustomizationConfig } from '@/lib/customization/validate';
import { previewService } from '@/services/preview.service';

/**
 * POST /api/preview
 * Generates a preview payload from customization config.
 * Returns { customization, mockData, timestamp } for iframe rendering.
 */
export const POST = withAuth(async (req: NextRequest) => {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Validate the customization config
    const validation = validateCustomizationConfig(body);
    if (!validation.valid) {
        return NextResponse.json(
            { error: 'Invalid customization config', details: validation.errors },
            { status: 422 }
        );
    }

    try {
        const payload = previewService.generatePreview(validation.valid ? body as any : body);
        return NextResponse.json(payload, { status: 200 });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || 'Failed to generate preview' },
            { status: 500 }
        );
    }
});
