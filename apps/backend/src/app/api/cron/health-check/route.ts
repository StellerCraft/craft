import { NextRequest, NextResponse } from 'next/server';
import { healthMonitorService } from '@/services/health-monitor.service';
import { VercelService } from '@/services/vercel.service';
import { withCronAuth } from '@/lib/api/cron-auth';

/**
 * Cron endpoint to check health of all deployments
 * This should be called periodically (e.g., every 5 minutes) by a cron service
 *
 * Vercel Cron: https://vercel.com/docs/cron-jobs
 * Configure in vercel.json with crons array containing path and schedule.
 */
// Documented execution time budget for a single cron invocation (ms). If the sweep
// exceeds this, it stops and resumes from the persisted cursor on the next run.
const HEALTH_CHECK_BUDGET_MS = 60_000;
const HEALTH_CHECK_PAGE_SIZE = 50;

async function handleHealthCheck(req: NextRequest) {
    try {
        console.log('Running health check for all deployments...');
        const startedAt = Date.now();

        let cursor: string | null = null;
        let allResults: Array<{
            deploymentId: string;
            isHealthy: boolean;
            responseTime: number;
        }> = [];

        // Process deployments in ordered pages. Each page is bounded by HEALTH_CHECK_PAGE_SIZE,
        // and the returned cursor lets a truncated run resume where it left off next time.
        do {
            if (Date.now() - startedAt > HEALTH_CHECK_BUDGET_MS) {
                console.warn(
                    'Health-check budget exceeded; resuming from cursor on next invocation.'
                );
                break;
            }

            const page = await healthMonitorService.checkAllDeploymentsPaged({
                cursor,
                limit: HEALTH_CHECK_PAGE_SIZE,
            });
            allResults = allResults.concat(page.results);
            cursor = page.nextCursor;
        } while (cursor);

        const unhealthyCount = allResults.filter((r) => !r.isHealthy).length;

        console.log(
            `Health check complete: ${allResults.length} deployments checked, ${unhealthyCount} unhealthy`
        );

        return NextResponse.json({
            success: true,
            totalChecked: allResults.length,
            unhealthyCount,
            results: allResults,
            vercelCircuitState: new VercelService().breaker.currentState,
        });
    } catch (error: any) {
        console.error('Error running health check cron:', error);
        return NextResponse.json(
            { error: error.message || 'Health check failed' },
            { status: 500 }
        );
    }
}

export const GET = withCronAuth(handleHealthCheck);
