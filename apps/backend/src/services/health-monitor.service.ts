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

        // Get all active deployments
        const { data: deployments } = await supabase
            .from('deployments')
            .select('id')
            .eq('status', 'completed')
            .eq('is_active', true);

        if (!deployments) {
            return [];
        }

        const results = await Promise.all(
            deployments.map(async (deployment) => {
                const health = await this.checkDeploymentHealth(deployment.id);
                return {
                    deploymentId: deployment.id,
                    isHealthy: health.isHealthy,
                    responseTime: health.responseTime,
                };
            })
        );

        return results;
    }

    /**
     * Check health for a single ordered page of active deployments.
     *
     * Deployments are ordered by `id` so the returned `nextCursor` (the last id in the
     * page) is stable across invocations. A run truncated by the cron execution budget can
     * resume from this cursor on the next invocation instead of restarting from the top.
     */
    async checkAllDeploymentsPaged(opts?: {
        cursor?: string | null;
        limit?: number;
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
        const limit = opts?.limit ?? 50;

        // Get a page of active deployments, ordered so the cursor is stable.
        let query = supabase
            .from('deployments')
            .select('id')
            .eq('status', 'completed')
            .eq('is_active', true)
            .order('id', { ascending: true })
            .limit(limit);

        if (opts?.cursor) {
            query = query.gt('id', opts.cursor);
        }

        const { data: deployments } = await query;

        if (!deployments || deployments.length === 0) {
            return { results: [], nextCursor: null, totalProcessed: 0 };
        }

        const results = await Promise.all(
            deployments.map(async (deployment) => {
                const health = await this.checkDeploymentHealth(deployment.id);
                return {
                    deploymentId: deployment.id,
                    isHealthy: health.isHealthy,
                    responseTime: health.responseTime,
                };
            })
        );

        // If we filled the page we may have more; expose the last id as the resume cursor.
        const nextCursor =
            deployments.length === limit
                ? deployments[deployments.length - 1].id
                : null;

        return { results, nextCursor, totalProcessed: results.length };
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

// Export singleton instance
export const healthMonitorService = new HealthMonitorService();
