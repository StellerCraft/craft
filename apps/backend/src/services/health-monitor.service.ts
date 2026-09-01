import { createClient } from '@/lib/supabase/server';
import { analyticsService } from './analytics.service';

export interface PoolMetrics {
    activeConnections: number;
    idleConnections: number;
    waitQueueLength: number;
    totalConnections: number;
    utilizationPercent: number;
    averageWaitTimeMs: number;
}

interface PoolMetricsInternal {
    activeConnections: number;
    idleConnections: number;
    waitQueueLength: number;
    waitTimes: number[];
    lastSampled: number;
}

const POOL_ALERT_THRESHOLD = 0.8;
const POOL_METRICS_WINDOW_MS = 60_000;
const poolMetrics: PoolMetricsInternal = {
    activeConnections: 0,
    idleConnections: 0,
    waitQueueLength: 0,
    waitTimes: [],
    lastSampled: Date.now(),
};

// Health-check cron sweep tuning.
const HEALTH_CHECK_PAGE_SIZE = 50;
const HEALTH_CHECK_CONCURRENCY = 10;

/**
 * Run an async worker over items with a bounded concurrency pool so a large fleet
 * never triggers an unbounded Promise.all (which is what made the sweep exceed the
 * cron execution budget in the first place).
 */
async function mapWithConcurrency<T, R>(
    items: T[],
    worker: (item: T) => Promise<R>,
    concurrency: number
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let index = 0;
    async function workerLoop(): Promise<void> {
        while (index < items.length) {
            const current = index++;
            results[current] = await worker(items[current]);
        }
    }
    const pools = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: pools }, () => workerLoop()));
    return results;
}

export class HealthMonitorService {
    /**
     * Check deployment health
     */
    async checkDeploymentHealth(deploymentId: string): Promise<{
        isHealthy: boolean;
        responseTime: number;
        statusCode: number | null;
        error: string | null;
    }> {
        const supabase = createClient();

        // Get deployment URL
        const { data: deployment } = await supabase
            .from('deployments')
            .select('deployment_url')
            .eq('id', deploymentId)
            .single();

        if (!deployment?.deployment_url) {
            return {
                isHealthy: false,
                responseTime: 0,
                statusCode: null,
                error: 'Deployment URL not found',
            };
        }

        try {
            const startTime = Date.now();
            const response = await fetch(deployment.deployment_url, {
                method: 'HEAD',
                signal: AbortSignal.timeout(10000), // 10 second timeout
            });
            const responseTime = Date.now() - startTime;

            const isHealthy = response.ok;

            // Record uptime check
            await analyticsService.recordUptimeCheck(deploymentId, isHealthy);

            return {
                isHealthy,
                responseTime,
                statusCode: response.status,
                error: null,
            };
        } catch (error: any) {
            // Record downtime
            await analyticsService.recordUptimeCheck(deploymentId, false);

            return {
                isHealthy: false,
                responseTime: 0,
                statusCode: null,
                error: error.message || 'Health check failed',
            };
        }
    }

    /**
     * Check health for all active deployments.
     *
     * @deprecated Prefer {@link checkAllDeploymentsPaged} for cron sweeps so the work can
     * be bounded and resumed. This helper remains for backward compatibility and gathers
     * every active deployment in a single unbounded pass.
     */
    async checkAllDeployments(): Promise<
        Array<{
            deploymentId: string;
            isHealthy: boolean;
            responseTime: number;
        }>
    > {
        const supabase = createClient();

        const startTime = Date.now();

        const { data: deployments } = await supabase
            .from('deployments')
            .select('id')
            .eq('status', 'completed')
            .eq('is_active', true);

        if (!deployments) {
            return [];
        }

        const results = await pMap(
            deployments,
            async (deployment) => {
                const health = await this.checkDeploymentHealth(deployment.id);
                return {
                    deploymentId: deployment.id,
                    isHealthy: health.isHealthy,
                    responseTime: health.responseTime,
                };
            },
            parseInt(process.env.HEALTH_CHECK_CONCURRENCY || '20', 10),
        );

        const durationMs = Date.now() - startTime;
        console.log(
            `[health-monitor] Sweep completed: ${deployments.length} deployments checked in ${durationMs}ms`
        );

        return results;
    }

    /**
     * Check health for a single ordered page of active deployments.
     *
     * Deployments are ordered by `id` so the returned `nextCursor` (the last id in the
     * page) is stable across invocations. A run truncated by the cron execution budget can
     * resume from this cursor on the next invocation instead of restarting from the top.
     *
     * The page's health checks run with a bounded concurrency pool (never an unbounded
     * `Promise.all` across the whole fleet) so a large account stays within the budget.
     */
    async checkAllDeploymentsPaged(opts?: {
        cursor?: string | null;
        limit?: number;
        concurrency?: number;
    }): Promise<{
        results: Array<{
            deploymentId: string;
            isHealthy: boolean;
            responseTime: number;
        }>;
        nextCursor: string | null;
        totalProcessed: number;
    }> {
        const supabase = createClient();
        const limit = opts?.limit ?? HEALTH_CHECK_PAGE_SIZE;
        const concurrency = opts?.concurrency ?? HEALTH_CHECK_CONCURRENCY;

        // Page with a +1 look-ahead so we can tell whether more pages remain.
        let query = supabase
            .from('deployments')
            .select('id')
            .eq('status', 'completed')
            .eq('is_active', true)
            .order('id', { ascending: true })
            .limit(limit + 1);

        if (opts?.cursor) {
            query = query.gt('id', opts.cursor);
        }

        const { data: deployments, error } = await query;
        if (error) {
            throw new Error(`Failed to fetch deployments for health check: ${error.message}`);
        }
        if (!deployments || deployments.length === 0) {
            return { results: [], nextCursor: null, totalProcessed: 0 };
        }

        const hasMore = deployments.length > limit;
        const pageItems = hasMore ? deployments.slice(0, limit) : deployments;

        const results = await mapWithConcurrency(
            pageItems,
            async (deployment) => {
                const health = await this.checkDeploymentHealth(deployment.id);
                return {
                    deploymentId: deployment.id,
                    isHealthy: health.isHealthy,
                    responseTime: health.responseTime,
                };
            },
            concurrency
        );

        // Persisted cursor for the next page (null when this page drained the fleet).
        const nextCursor = hasMore ? pageItems[pageItems.length - 1].id : null;

        return { results, nextCursor, totalProcessed: results.length };
    }

    private static readonly CRON_CHECKPOINT_JOB = 'health-check';

    /**
     * Read the persisted resume cursor for the health-check sweep. Returns `null` when
     * there is no in-progress run (i.e. the previous sweep completed or never started).
     */
    async getCheckpoint(): Promise<string | null> {
        try {
            const supabase = createClient();
            const { data, error } = await supabase
                .from('cron_checkpoints' as any)
                .select('cursor')
                .eq('job', HealthMonitorService.CRON_CHECKPOINT_JOB)
                .single();
            if (error || !data) return null;
            return (data as { cursor: string | null }).cursor ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Persist the resume cursor for the health-check sweep. `null` means the sweep has
     * fully drained the fleet; the next invocation will start fresh. A failed write must
     * never break the sweep itself.
     */
    async saveCheckpoint(cursor: string | null): Promise<void> {
        try {
            const supabase = createClient();
            await supabase
                .from('cron_checkpoints' as any)
                .upsert(
                    {
                        job: HealthMonitorService.CRON_CHECKPOINT_JOB,
                        cursor,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'job' }
                );
        } catch {
            // best-effort checkpoint; swallowing keeps the sweep resilient
        }
    }

    /**
     * Send downtime notification
     */
    async notifyDowntime(
        deploymentId: string,
        userId: string
    ): Promise<void> {
        // TODO: Implement email/webhook notification
        console.log(`Deployment ${deploymentId} is down. Notifying user ${userId}`);
    }

    /**
     * Monitor deployment and notify on downtime
     */
    async monitorDeployment(deploymentId: string): Promise<void> {
        const supabase = createClient();

        const health = await this.checkDeploymentHealth(deploymentId);

        if (!health.isHealthy) {
            // Get deployment owner
            const { data: deployment } = await supabase
                .from('deployments')
                .select('user_id')
                .eq('id', deploymentId)
                .single();

            if (deployment) {
                await this.notifyDowntime(deploymentId, deployment.user_id);
            }
        }
    }

    /**
     * Record connection pool metrics
     */
    recordPoolMetrics(
        activeConnections: number,
        idleConnections: number,
        waitQueueLength: number,
        waitTimeMs: number
    ): void {
        poolMetrics.activeConnections = activeConnections;
        poolMetrics.idleConnections = idleConnections;
        poolMetrics.waitQueueLength = waitQueueLength;
        poolMetrics.waitTimes.push(waitTimeMs);
        poolMetrics.lastSampled = Date.now();

        if (poolMetrics.waitTimes.length > 1000) {
            poolMetrics.waitTimes = poolMetrics.waitTimes.slice(-1000);
        }
    }

    /**
     * Get current pool health metrics
     */
    getPoolMetrics(): PoolMetrics {
        const totalConnections = poolMetrics.activeConnections + poolMetrics.idleConnections;
        const utilizationPercent = totalConnections > 0
            ? (poolMetrics.activeConnections / totalConnections) * 100
            : 0;

        const averageWaitTimeMs = poolMetrics.waitTimes.length > 0
            ? poolMetrics.waitTimes.reduce((a, b) => a + b, 0) / poolMetrics.waitTimes.length
            : 0;

        return {
            activeConnections: poolMetrics.activeConnections,
            idleConnections: poolMetrics.idleConnections,
            waitQueueLength: poolMetrics.waitQueueLength,
            totalConnections,
            utilizationPercent,
            averageWaitTimeMs,
        };
    }

    /**
     * Check if pool health is degraded
     */
    isPoolHealthDegraded(): boolean {
        const metrics = this.getPoolMetrics();
        return metrics.utilizationPercent >= POOL_ALERT_THRESHOLD * 100 ||
               metrics.waitQueueLength > 10 ||
               metrics.averageWaitTimeMs > 1000;
    }

    /**
     * Get complete health status including pool metrics
     */
    async getSystemHealth(): Promise<{
        status: 'healthy' | 'degraded' | 'unhealthy';
        timestamp: number;
        poolMetrics: PoolMetrics;
    }> {
        const metrics = this.getPoolMetrics();
        const isDegraded = this.isPoolHealthDegraded();

        return {
            status: isDegraded ? 'degraded' : 'healthy',
            timestamp: Date.now(),
            poolMetrics: metrics,
        };
    }
}

async function pMap<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;
    let activeCount = 0;
    let resolve: (() => void) | null = null;

    const errors: Error[] = [];

    function done() {
        activeCount--;
        if (resolve && activeCount === 0) {
            resolve();
        }
    }

    function runNext() {
        while (activeCount < concurrency && index < items.length) {
            const currentIndex = index++;
            activeCount++;
            fn(items[currentIndex])
                .then((result) => {
                    results[currentIndex] = result;
                    done();
                    runNext();
                })
                .catch((err) => {
                    errors.push(err);
                    done();
                    runNext();
                });
        }
    }

    return new Promise((res) => {
        resolve = res;
        runNext();
        if (activeCount === 0 && index === items.length) {
            res();
        }
    }).then(() => {
        if (errors.length > 0) {
            throw errors[0];
        }
        return results;
    });
}

// Export singleton instance
export const healthMonitorService = new HealthMonitorService();
