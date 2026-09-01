import { NextRequest, NextResponse } from 'next/server';
import { withRole } from '@/lib/api/with-role';
import { webhookDLQ, type DLQEntry } from '@/lib/webhook-dlq/dead-letter-queue';
import { jobQueueService, type DLQRecord } from '@/services/job-queue.service';

/**
 * Combined Dead-Letter Queue View
 *
 * This endpoint aggregates both DLQ sources into a single response so that
 * operators get a unified view of all work that has permanently failed and
 * needs manual intervention:
 *
 *   - source: "webhook_dlq"
 *       In-memory store backed by webhookDLQ (dead-letter-queue.ts).
 *       Populated by Stripe and GitHub webhook deliveries that exhaust retries.
 *       Surfaced individually at: GET /api/admin/webhooks/dlq
 *
 *   - source: "job_dlq"
 *       Supabase-backed store (table: job_dlq).
 *       Populated by background jobs (JobQueueService) that exhaust max_attempts.
 *       No dedicated single-source route exists yet.
 *
 * Related endpoints:
 *   GET /api/admin/webhooks/dlq   – webhook-only DLQ (in-memory)
 *   POST /api/admin/webhooks/dlq  – reprocess a single webhook DLQ entry
 *   GET /api/admin/webhooks/replay – list deliveries available for replay
 *   POST /api/admin/webhooks/replay – trigger delivery replay
 */

// ── Unified entry shape ───────────────────────────────────────────────────────

export interface UnifiedDLQEntry {
    /** Discriminator: which underlying store this entry came from. */
    source: 'webhook_dlq' | 'job_dlq';
    id: string;
    /** Human-readable description of the work that failed. */
    jobType: string;
    /** ISO-8601 timestamp when the entry was created/captured. */
    createdAt: string;
    /** Number of attempts made before the entry was moved to the DLQ. */
    attempts: number;
    /** Last known failure reason. */
    failureReason: string;
    /** Whether manual reprocessing has been attempted and its outcome. */
    reprocessStatus: 'pending' | 'in_progress' | 'succeeded' | 'failed';
    /** ISO-8601 timestamp of the last reprocessing attempt, if any. */
    reprocessedAt: string | null;
    /** Source-specific metadata preserved verbatim for diagnostics. */
    raw: DLQEntry | DLQRecord;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapWebhookDLQEntry(entry: DLQEntry): UnifiedDLQEntry {
    return {
        source: 'webhook_dlq',
        id: entry.id,
        jobType: `${entry.source}:${entry.eventType}`,
        createdAt: entry.createdAt.toISOString(),
        attempts: entry.attempts,
        failureReason: entry.failureReason,
        reprocessStatus: entry.reprocessStatus ?? 'pending',
        reprocessedAt: entry.reprocessedAt ? entry.reprocessedAt.toISOString() : null,
        raw: entry,
    };
}

function mapJobDLQRecord(record: DLQRecord): UnifiedDLQEntry {
    return {
        source: 'job_dlq',
        id: record.id,
        jobType: record.job_type,
        createdAt: record.created_at,
        attempts: record.attempts,
        failureReason: record.failure_reason,
        reprocessStatus: record.reprocess_status,
        reprocessedAt: record.reprocessed_at ?? null,
        raw: record,
    };
}

// ── Route handler ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/dlq
 *
 * Returns a combined view of all DLQ entries from both sources, sorted
 * by createdAt descending (most recent failures first).
 *
 * Response shape:
 * {
 *   total: number,
 *   bySource: { webhook_dlq: number, job_dlq: number },
 *   entries: UnifiedDLQEntry[],
 *   _links: {
 *     webhookDlq:    "/api/admin/webhooks/dlq",
 *     webhookReplay: "/api/admin/webhooks/replay"
 *   }
 * }
 */
export const GET = withRole('admin', async (_req: NextRequest) => {
    // Collect webhook DLQ entries (synchronous, in-memory)
    const webhookEntries: UnifiedDLQEntry[] = webhookDLQ
        .list()
        .map(mapWebhookDLQEntry);

    // Collect job DLQ entries (async, Supabase-backed)
    let jobEntries: UnifiedDLQEntry[] = [];
    try {
        const records = await jobQueueService.listDLQ();
        jobEntries = records.map(mapJobDLQRecord);
    } catch (err: any) {
        // Surface the error as a partial response rather than failing the whole
        // request — the webhook DLQ is still valid and useful.
        console.error('[admin/dlq] Failed to fetch job DLQ entries:', err?.message);
    }

    const entries = [...webhookEntries, ...jobEntries].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json({
        total: entries.length,
        bySource: {
            webhook_dlq: webhookEntries.length,
            job_dlq: jobEntries.length,
        },
        entries,
        _links: {
            webhookDlq: '/api/admin/webhooks/dlq',
            webhookReplay: '/api/admin/webhooks/replay',
        },
    });
});
