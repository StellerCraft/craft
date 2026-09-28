import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getRetentionPolicyWindows, readRetentionDays, validateRetentionWindows } from '@/lib/retention-policy';
import { cleanupService } from '@/services/cleanup.service';
import { createLogger, resolveCorrelationId, CORRELATION_ID_HEADER } from '@/lib/api/logger';
import { withCronAuth } from '@/lib/api/cron-auth';

/**
 * Cron: permanently purge tombstoned deployments past the retention window,
 * and remove orphaned Supabase Storage artifacts left by deployments that
 * failed before their artifact was registered.
 *
 * Soft-deleted (tombstoned) deployments are archived with a deleted_at timestamp.
 * After DEPLOYMENT_TOMBSTONE_RETENTION_DAYS (default: 30) they are permanently
 * removed by this job, along with their cascaded deployment_logs and
 * deployment_analytics rows.
 *
 * Orphaned artifacts are kept for a 24h debugging window and deleted in batches
 * of up to 100 per run (see CleanupService.purgeOrphanedArtifacts).
 *
 * Scheduled daily via vercel.json.  Protected by CRON_SECRET via withCronAuth.
 */
async function handlePurgeTombstonedDeployments(req: NextRequest) {

    const correlationId = resolveCorrelationId(req);
    const log = createLogger({ correlationId, service: 'purge-tombstoned-deployments-cron' });
    const headers = { [CORRELATION_ID_HEADER]: correlationId };

    const retentionDays = readRetentionDays('tombstonedDeploymentPurge');
    validateRetentionWindows(getRetentionPolicyWindows());

    let purged = 0;
    if (retentionDays > 0) {
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
        const supabase = createClient();

        const { error, count } = await supabase
            .from('deployments')
            .delete({ count: 'exact' })
            .not('deleted_at', 'is', null)
            .lt('deleted_at', cutoff);

        if (error) {
            log.error('Tombstone purge failed', error);
            return NextResponse.json({ error: error.message }, { status: 500, headers });
        }
        purged = count ?? 0;
    }

    // Remove orphaned storage artifacts (24h retention, 100/run batch limit).
    let orphanedArtifactsPurged = 0;
    try {
        const orphanResult = await cleanupService.purgeOrphanedArtifacts({ correlationId });
        orphanedArtifactsPurged = orphanResult.recordsDeleted;
    } catch (err: unknown) {
        // Orphan cleanup failure should not fail the whole cron; log and continue.
        log.error('Orphaned artifact purge failed', err);
    }

    return NextResponse.json(
        {
            purged,
            orphanedArtifactsPurged,
            retentionDisabled: retentionDays === 0,
        },
        { headers },
    );
}

export const GET = withCronAuth(handlePurgeTombstonedDeployments);
