import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { templateGeneratorService } from '@/services/template-generator.service';

/**
 * POST /api/generate
 *
 * Accepts a GenerationRequest and returns a GenerationResultWithMetadata.
 * Requires authentication via withAuth middleware.
 *
 * Request body: { templateId: string, customization: CustomizationConfig, outputPath: string }
 *
 * Responses:
 *   200 — GenerationResultWithMetadata (success: true)
 *   401 — Unauthorized (no valid session)
 *   422 — Validation or generation failure (success: false)
 *   500 — Unexpected server error
 *
 * Feature: template-generator-entrypoint
 * Issue branch: issue-061-implement-template-generator-entrypoint
 */
export const POST = withAuth(async (req: NextRequest) => {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    try {
        const result = await templateGeneratorService.generate(body);

        if (!result.success) {
            return NextResponse.json(result, { status: 422 });
        }

        return NextResponse.json(result, { status: 200 });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
});
