import { createClient } from '@/lib/supabase/server';

export class AnalyticsService {
    /**
     * Record a page view for a deployment
     */
    async recordPageView(deploymentId: string): Promise<void> {
        const supabase = createClient();

        await supabase.from('deployment_analytics').insert({
            deployment_id: deploymentId,
            metric_type: 'page_view',
            metric_value: 1,
        });
    }

    /**
     * Record deployment uptime check
     */
    async recordUptimeCheck(
        deploymentId: string,
        isUp: boolean
    ): Promise<void> {
        const supabase = createClient();

        await supabase.from('deployment_analytics').insert({
            deployment_id: deploymentId,
            metric_type: 'uptime_check',
            metric_value: isUp ? 1 : 0,
        });
    }

    /**
     * Record Stellar transaction count
     */
    async recordTransactionCount(
        deploymentId: string,
        count: number
    ): Promise<void> {
        const supabase = createClient();

        await supabase.from('deployment_analytics').insert({
            deployment_id: deploymentId,
            metric_type: 'transaction_count',
            metric_value: count,
        });
    }

    /**
     * Get analytics for a deployment
     */
    async getAnalytics(
        deploymentId: string,
        metricType?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<
        Array<{
            id: string;
            metricType: string;
            metricValue: number;
            recordedAt: Date;
        }>
    > {
        const supabase = createClient();

        let query = supabase
            .from('deployment_analytics')
            .select('*')
            .eq('deployment_id', deploymentId)
            .order('recorded_at', { ascending: false });

        if (metricType) {
            query = query.eq('metric_type', metricType);
        }

        if (startDate) {
            query = query.gte('recorded_at', startDate.toISOString());
        }

        if (endDate) {
            query = query.lte('recorded_at', endDate.toISOString());
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Failed to get analytics: ${error.message}`);
        }

        return (data || []).map((row) => ({
            id: row.id,
            metricType: row.metric_type,
            metricValue: row.metric_value,
            recordedAt: new Date(row.recorded_at),
        }));
    }

    /**
     * Get aggregated analytics summary
     */
    async getAnalyticsSummary(deploymentId: string): Promise<{
        totalPageViews: number;
        uptimePercentage: number;
        totalTransactions: number;
        lastChecked: Date | null;
    }> {
        const supabase = createClient();

        // Get page views
        const { data: pageViews } = await supabase
            .from('deployment_analytics')
            .select('metric_value')
            .eq('deployment_id', deploymentId)
            .eq('metric_type', 'page_view');

        const totalPageViews = pageViews?.reduce(
            (sum, row) => sum + row.metric_value,
            0
        ) || 0;

        // Get uptime checks
        const { data: uptimeChecks } = await supabase
            .from('deployment_analytics')
            .select('metric_value, recorded_at')
            .eq('deployment_id', deploymentId)
            .eq('metric_type', 'uptime_check')
            .order('recorded_at', { ascending: false });

        const uptimePercentage = uptimeChecks?.length
            ? (uptimeChecks.filter((row) => row.metric_value === 1).length /
                uptimeChecks.length) *
            100
            : 100;

        const lastChecked = uptimeChecks?.[0]
            ? new Date(uptimeChecks[0].recorded_at)
            : null;

        // Get transaction count
        const { data: transactions } = await supabase
            .from('deployment_analytics')
            .select('metric_value')
            .eq('deployment_id', deploymentId)
            .eq('metric_type', 'transaction_count');

        const totalTransactions = transactions?.reduce(
            (sum, row) => sum + row.metric_value,
            0
        ) || 0;

        return {
            totalPageViews,
            uptimePercentage: Math.round(uptimePercentage * 100) / 100,
            totalTransactions,
            lastChecked,
        };
    }

    /**
     * Delete deployment_analytics rows older than `retentionDays` days.
     *
     * Called by the daily purge-analytics cron job.
     * If retentionDays is 0 the policy is considered disabled and nothing is deleted.
     *
     * @param retentionDays - Number of days to retain records (0 = disabled)
     * @returns Number of rows deleted
     */
    async applyRetentionPolicy(retentionDays: number): Promise<number> {
        if (retentionDays === 0) {
            return 0;
        }

        const supabase = createClient();
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

        const { error, count } = await supabase
            .from('deployment_analytics')
            .delete()
            .lt('recorded_at', cutoff);

        if (error) {
            throw new Error(`Failed to apply retention policy: ${error.message}`);
        }

        return count ?? 0;
    }

    /**
     * Export analytics data as CSV
     */
    async exportAnalytics(
        deploymentId: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<string> {
        const analytics = await this.getAnalytics(
            deploymentId,
            undefined,
            startDate,
            endDate
        );

        // Generate CSV
        const headers = ['Metric Type', 'Value', 'Recorded At'];
        const rows = analytics.map((row) => [
            row.metricType,
            row.metricValue.toString(),
            row.recordedAt.toISOString(),
        ]);

        const csv = [
            headers.join(','),
            ...rows.map((row) => row.join(',')),
        ].join('\n');

        return csv;
    }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();
