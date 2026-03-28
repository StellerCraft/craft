/**
 * GET /api/deployments/[id]/logs
 *
 * Returns a paginated, filtered list of log entries for a given deployment.
 * All filtering and ordering is applied at the database layer.
 *
 * Authentication: requires a valid Supabase session (401 if missing).
 * Ownership: the authenticated user must own the deployment.
 *            Non-owners and missing deployments both return 404 to prevent
 *            existence leakage.
 *
 * Query parameters:
 *   page    integer        Page number (default: 1)
 *   limit   integer        Results per page (default: 50, max: 200)
 *   order   "asc" | "desc" Chronological order (default: "asc")
 *   since   ISO 8601       Filter logs created after this timestamp
 *   level   "info" | "warn" | "error"  Filter by log level
 *
 * Responses:
 *   200 — Paginated log array
 *   400 — Invalid query parameters
 *   401 — Not authenticated
 *   404 — Deployment not found (or not owned by caller)
 *   500 — Unexpected server error
 *
 * Issue: #111
 * Branch: issue-111-create-the-deployment-logs-route
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { deploymentLogsService, parseLogsQueryParams } from '@/services/deployment-logs.service';

export const GET = withAuth(async (req: NextRequest, { params, user, supabase }) => {
    const deploymentId = (params as { id: string }).id;

    // Ownership check — return 404 for both missing and non-owned deployments
    // to prevent existence leakage (issue spec: non-owners receive 404, not 403).
    const { data: deployment } = await supabase
        .from('deployments')
        .select('user_id')
        .eq('id', deploymentId)
        .single();

    if (!deployment || deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Validate and normalise query parameters before touching the DB.
    const parsed = parseLogsQueryParams(req.nextUrl.searchParams);
    if (!parsed.valid) {
        return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
    }

    try {
        const result = await deploymentLogsService.getLogs(deploymentId, parsed.params, supabase);
        return NextResponse.json(result);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to retrieve logs';
        console.error('[deployment-logs] unexpected error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
});
