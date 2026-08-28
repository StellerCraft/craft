import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { cleanupService } from '@/services/cleanup.service';

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
 * Scheduled daily via vercel.json.  Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const retentionDays = parseInt(process.env.DEPLOYMENT_TOMBSTONE_RETENTION_DAYS ?? '30', 10);

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
            console.error('Tombstone purge failed:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        purged = count ?? 0;
    }

    // Remove orphaned storage artifacts (24h retention, 100/run batch limit).
    let orphanedArtifactsPurged = 0;
    try {
        const orphanResult = await cleanupService.purgeOrphanedArtifacts();
        orphanedArtifactsPurged = orphanResult.recordsDeleted;
    } catch (err: unknown) {
        // Orphan cleanup failure should not fail the whole cron; log and continue.
        console.error('Orphaned artifact purge failed:', err);
    }

    return NextResponse.json({
        purged,
        orphanedArtifactsPurged,
        retentionDisabled: retentionDays === 0,
    });
}
