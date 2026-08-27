import { NextRequest, NextResponse } from 'next/server';
import { withRole } from '@/lib/api/with-role';
import { withGitHubWebhookAuth } from '@/lib/github/github-webhook';
import { webhookDLQ } from '@/lib/webhook-dlq/dead-letter-queue';

/**
 * GET /api/admin/webhooks/dlq
 *
 * Lists only the in-memory webhook DLQ entries (Stripe + GitHub webhook
 * delivery failures that exhausted all retry attempts).
 *
 * This endpoint covers ONE of TWO dead-letter queues in the platform:
 *
 *   1. webhook_dlq (this endpoint) — in-memory, populated by
 *      apps/backend/src/lib/webhook-dlq/dead-letter-queue.ts
 *
 *   2. job_dlq — Supabase-backed (table: job_dlq), populated by
 *      apps/backend/src/services/job-queue.service.ts (JobQueueService)
 *
 * For a unified view across both sources use:
 *   GET /api/admin/dlq
 *
 * Related endpoints:
 *   GET  /api/admin/dlq            – combined view of both DLQ sources
 *   POST /api/admin/webhooks/dlq   – reprocess a single entry from this queue
 *   GET  /api/admin/webhooks/replay – list deliveries available for replay
 */
export const GET = withGitHubWebhookAuth(
    withRole('admin', async (_req: NextRequest) => {
        const entries = webhookDLQ.list();
        return NextResponse.json({
            total: entries.length,
            entries,
            _links: {
                combinedDlq: '/api/admin/dlq',
                webhookReplay: '/api/admin/webhooks/replay',
            },
        });
    })
);

/**
 * POST /api/admin/webhooks/dlq
 * Reprocess a single webhook DLQ entry by id, passed in the request body.
 *
 * This operates on the in-memory webhook DLQ only.
 * To see all DLQ entries (including job_dlq) use GET /api/admin/dlq.
 *
 * Body: { id: string }
 */
export const POST = withGitHubWebhookAuth(
    withRole('admin', async (req: NextRequest) => {
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }

        const id = (body as Record<string, unknown>)?.id;
        if (!id || typeof id !== 'string') {
            return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 });
        }

        const entry = webhookDLQ.get(id);
        if (!entry) {
            return NextResponse.json({ error: 'DLQ entry not found' }, { status: 404 });
        }

        const result = await webhookDLQ.reprocess(id);

        if (!result.success) {
            return NextResponse.json(
                { error: result.error, entry: webhookDLQ.get(id) },
                { status: 422 }
            );
        }

        return NextResponse.json({ success: true, entry: webhookDLQ.get(id) });
    })
);
