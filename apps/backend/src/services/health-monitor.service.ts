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

/**
 * Documented time budget for a single cron health-check sweep (issue #1152).
 * Platforms such as Vercel cap cron function execution; the sweep is expected to
 * finish well under this. `checkAllDeployments` can be paged (cursor/limit) to
 * stay within it for very large deployment counts.
 */
export const HEALTH_CHECK_SWEEP_BUDGET_MS = 30_000;
const poolMetrics: PoolMetricsInternal = {
    activeConnections: 0,
    idleConnections: 0,
    waitQueueLength: 0,
    waitTimes: [],
    lastSampled: Date.now(),
};

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
     * The sweep fans out across every active deployment via `pMap`. To bound the
     * cron execution time budget (issue #1152) and to allow a truncated run to
     * resume instead of restarting from the beginning, callers may pass
     * `{ cursor, limit }` to page the underlying query. When `limit` is provided
     * the method returns a paged result (`{ results, nextCursor, truncated }`)
     * whose `nextCursor` can be fed into the next invocation. When called with no
     * options the behavior is unchanged for existing callers (a flat array).
     */
    async checkAllDeployments(
        opts: { cursor?: number; limit?: number } = {},
    ): Promise<
        | Array<{
              deploymentId: string;
              isHealthy: boolean;
              responseTime: number;
          }>
        | {
              results: Array<{
                  deploymentId: string;
                  isHealthy: boolean;
                  responseTime: number;
              }>;
              nextCursor: number | null;
              truncated: boolean;
          }
    > {
        const supabase = createClient();

        const startTime = Date.now();
        const limit = opts.limit ?? Number.MAX_SAFE_INTEGER;
        const cursor = opts.cursor ?? 0;

        const { data: deployments } = await supabase
            .from('deployments')
            .select('id')
            .eq('status', 'completed')
            .eq('is_active', true)
            .order('id', { ascending: true })
            .range(cursor, cursor + limit - 1);

        if (!deployments) {
            return opts.limit !== undefined
                ? { results: [], nextCursor: null, truncated: false }
                : [];
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
            `[health-monitor] Sweep completed: ${deployments.length} deployments checked in ${durationMs}ms (cursor=${cursor}, limit=${limit})`
        );

        if (opts.limit !== undefined) {
            const truncated = deployments.length >= limit;
            return {
                results,
                nextCursor: truncated ? cursor + limit : null,
                truncated,
            };
        }

        return results;
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
