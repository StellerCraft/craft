import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { customizationDraftService } from '@/services/customization-draft.service';

type Params = { templateId: string };

/**
 * POST /api/drafts/[templateId]/promote
 *
 * Promotes the authenticated user's saved draft for the given template into a
 * live deployment update.
 *
 * Request body:
 *   { "deploymentId": "<uuid>" }
 *
 * Responses:
 *   200 – { success, deploymentId, rolledBack, deploymentUrl? }
 *   400 – Invalid JSON or missing deploymentId
 *   400 – Draft config failed validation  { error, details }
 *   404 – Draft not found
 *   404 – Deployment not found or access denied (returned by updateDeployment)
 *   500 – Unexpected error
 */
export const POST = withAuth<Params>(async (req: NextRequest, { user, params }) => {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { deploymentId } = (body as Record<string, unknown>) ?? {};
    if (!deploymentId || typeof deploymentId !== 'string') {
        return NextResponse.json({ error: 'deploymentId is required' }, { status: 400 });
    }

    try {
        const result = await customizationDraftService.promoteDraft(
            user.id,
            params.templateId,
            deploymentId,
        );

        if (!result.success) {
            // updateDeployment returns success:false when the deployment is not found
            // or is in a non-promotable state.
            const isNotFound = result.errorMessage?.includes('not found') ||
                result.errorMessage?.includes('access denied');
            return NextResponse.json(
                { error: result.errorMessage ?? 'Promotion failed' },
                { status: isNotFound ? 404 : 500 },
            );
        }

        return NextResponse.json(result);
    } catch (error: any) {
        if (error.message === 'Draft not found') {
            return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
        }
        if (error.validationErrors) {
            return NextResponse.json(
                { error: 'Invalid draft configuration', details: error.validationErrors },
                { status: 400 },
            );
        }
        return NextResponse.json({ error: error.message || 'Promotion failed' }, { status: 500 });
    }
});
