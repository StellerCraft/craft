import { NextRequest, NextResponse } from 'next/server';
import { githubToVercelDeploymentService } from '@/services/github-to-vercel-deployment.service';
import { createClient } from '@/lib/supabase/server';

/**
 * Cron endpoint to sync Vercel deployment status for stale deployments
 * This should be called periodically (e.g., every 2 minutes) by a cron service
 *
 * Vercel Cron: https://vercel.com/docs/cron-jobs
 * Configure in vercel.json with crons array containing path and schedule.
 */
export async function GET(req: NextRequest) {
    try {
        // Verify cron secret to prevent unauthorized access
        const authHeader = req.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('Running sync-deployment-status cron...');

        const supabase = createClient();
        
        // Find deployments in 'building' state that are older than 2 minutes
        const twoMinutesAgo = new Date(Date.now() - 120000).toISOString();
        
        const { data: staleDeployments, error: fetchError } = await supabase
            .from('github_vercel_deployments')
            .select('vercel_deployment_id')
            .eq('status', 'building')
            .lt('created_at', twoMinutesAgo);

        if (fetchError) {
            console.error('Failed to fetch stale deployments:', fetchError);
            return NextResponse.json({ error: 'Failed to fetch stale deployments' }, { status: 500 });
        }

        console.log(`Found ${staleDeployments?.length || 0} stale deployments to sync`);

        let syncedCount = 0;
        let failedCount = 0;

        if (staleDeployments && staleDeployments.length > 0) {
            const syncPromises = staleDeployments.map(async (d) => {
                try {
                    const result = await githubToVercelDeploymentService.syncDeploymentStatus(d.vercel_deployment_id);
                    if (result) {
                        syncedCount++;
                    } else {
                        failedCount++;
                    }
                } catch (err) {
                    console.error(`Error syncing deployment ${d.vercel_deployment_id}:`, err);
                    failedCount++;
                }
            });

            await Promise.all(syncPromises);
        }

        console.log(`Sync complete: ${syncedCount} synced, ${failedCount} failed`);

        return NextResponse.json({
            synced: syncedCount,
            failed: failedCount,
        });
    } catch (error: any) {
        console.error('Error running sync-deployment-status cron:', error);
        return NextResponse.json(
            { error: error.message || 'Sync failed' },
            { status: 500 }
        );
    }
}
