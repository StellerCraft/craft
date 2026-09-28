import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { githubToVercelDeploymentService } from '@/services/github-to-vercel-deployment.service';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 10;

/**
 * GET /api/deployments/github
 *
 * Retrieves recent GitHub-triggered Vercel deployments.
 * Requires authentication.
 *
 * Query parameters:
 *   - repoFullName: GitHub repository full name (e.g., "owner/repo")
 *   - limit: Maximum number of deployments to return (default: 10, max: 100)
 *
 * Returns array of deployment metadata with:
 *   - id, repoFullName, repoName, branch
 *   - commitSha, commitMessage, pusherName
 *   - vercelDeploymentId, vercelDeploymentUrl, status
 *   - createdAt, updatedAt
 */
export const GET = withAuth(async (req, { user }) => {
    const { searchParams } = new URL(req.url);
    const repoFullName = searchParams.get('repoFullName');
    const limitStr = searchParams.get('limit');

    if (!repoFullName) {
        return NextResponse.json(
            { error: 'Missing repoFullName query parameter' },
            { status: 400 }
        );
    }

    let limit = DEFAULT_LIMIT;
    if (limitStr !== null) {
        const parsed = Number(limitStr);
        if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_LIMIT) {
            return NextResponse.json(
                { error: `limit must be a positive integer between 1 and ${MAX_LIMIT}` },
                { status: 400 }
            );
        }
        limit = parsed;
    }

    try {
        const deployments = await githubToVercelDeploymentService.getRecentDeployments(
            repoFullName,
            limit
        );

        return NextResponse.json({ deployments });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || 'Failed to retrieve deployments' },
            { status: 500 }
        );
    }
});
