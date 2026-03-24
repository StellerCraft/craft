import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { customizationDraftService } from '@/services/customization-draft.service';

type Params = { deploymentId: string };

/**
 * GET /api/drafts/deployment/[deploymentId]
 * Loads the customization draft for the deployment's template.
 * Returns 404 if no draft exists, 403 if the deployment belongs to another user.
 */
export const GET = withAuth<Params>(async (_req, { user, params }) => {
    try {
        const draft = await customizationDraftService.getDraftByDeployment(
            user.id,
            params.deploymentId
        );
        if (!draft) {
            return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
        }
        return NextResponse.json(draft);
    } catch (error: any) {
        const status = error.message === 'Forbidden' ? 403 : 500;
        return NextResponse.json({ error: error.message || 'Failed to load draft' }, { status });
    }
});
