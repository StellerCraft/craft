import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { validateCustomizationConfig } from '@/lib/customization/validate';
import { previewService } from '@/services/preview.service';
import type { CustomizationConfig, DeepPartial } from '@craft/types';

/**
 * POST /api/preview/update
 * Updates preview with partial customization changes.
 * Expects { current, changes } where changes is DeepPartial<CustomizationConfig>.
 * Returns minimal update payload with changedFields and optional mockData.
 */
export const POST = withAuth(async (req: NextRequest) => {
    let body: { current?: unknown; changes?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.current || !body.changes) {
        return NextResponse.json(
            { error: 'Missing required fields: current, changes' },
            { status: 400 }
        );
    }

    // Validate current config
    const currentValidation = validateCustomizationConfig(body.current);
    if (!currentValidation.valid) {
        return NextResponse.json(
            { error: 'Invalid current customization config', details: currentValidation.errors },
            { status: 422 }
        );
    }

    const current = body.current as CustomizationConfig;
    const changes = body.changes as DeepPartial<CustomizationConfig>;

    try {
        const payload = previewService.updatePreview(current, changes);
        return NextResponse.json(payload, { status: 200 });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || 'Failed to update preview' },
            { status: 500 }
        );
    }
});
