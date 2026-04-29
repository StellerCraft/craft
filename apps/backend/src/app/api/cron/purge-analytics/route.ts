import { NextRequest, NextResponse } from 'next/server';
import { analyticsService } from '@/services/analytics.service';

/**
 * Cron: purge old deployment_analytics rows
 *
 * Deletes records from the deployment_analytics table that are older than
 * ANALYTICS_RETENTION_DAYS (default: 90). This prevents the table from
 * growing unbounded and degrading query performance over time.
 *
 * Set ANALYTICS_RETENTION_DAYS=0 to disable deletion entirely.
 *
 * Scheduled daily via vercel.json. Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const retentionDays = parseInt(process.env.ANALYTICS_RETENTION_DAYS ?? '90', 10);

    try {
        const deleted = await analyticsService.applyRetentionPolicy(retentionDays);
        return NextResponse.json({ deleted });
    } catch (error: any) {
        console.error('Error running analytics retention purge:', error);
        return NextResponse.json({ error: error.message || 'Purge failed' }, { status: 500 });
    }
}
