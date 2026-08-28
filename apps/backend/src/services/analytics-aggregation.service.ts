import { createClient } from '@/lib/supabase/server';

export type RollupGranularity = '1h' | '24h';

const BUCKET_MS: Record<RollupGranularity, number> = {
    '1h': 60 * 60 * 1_000,
    '24h': 24 * 60 * 60 * 1_000,
};

/**
 * Incremental analytics aggregation service.
 *
 * For each granularity (1h / 24h) it:
 *  1. Reads the cursor (last_run_at) from rollup_cursors
 *  2. Fetches only new deployment_analytics rows since that cursor
 *  3. Groups them into time buckets and upserts into analytics_rollups
 *  4. Advances the cursor to the current time
 *
 * The upsert is idempotent — re-running with the same data produces the
 * same result because we recompute each bucket from the raw rows.
 */
export class AnalyticsAggregationService {
    async aggregate(granularity: RollupGranularity): Promise<{ bucketsWritten: number }> {
        const supabase = createClient();
        const bucketMs = BUCKET_MS[granularity];

        // 1. Read cursor
        const { data: cursorRow, error: cursorErr } = await supabase
            .from('rollup_cursors')
            .select('last_run_at')
            .eq('granularity', granularity)
            .single();

        if (cursorErr) throw new Error(`Failed to read rollup cursor: ${cursorErr.message}`);
        const since = new Date(cursorRow!.last_run_at);
        const now = new Date();

        // 2. Fetch new events since the last cursor
        const { data: rows, error: rowsErr } = await supabase
            .from('deployment_analytics')
            .select('deployment_id, metric_type, metric_value, recorded_at')
            .gte('recorded_at', since.toISOString())
            .lt('recorded_at', now.toISOString())
            .order('recorded_at', { ascending: true });

        if (rowsErr) throw new Error(`Failed to fetch analytics rows: ${rowsErr.message}`);
        if (!rows || rows.length === 0) return { bucketsWritten: 0 };

        // 3. Group into buckets
        type BucketKey = string; // `${deploymentId}|${metricType}|${bucketStart}`
        const buckets = new Map<BucketKey, {
            deployment_id: string;
            metric_type: string;
            bucket_start: string;
            total_value: number;
            record_count: number;
            up_count: number;
        }>();

        for (const row of rows) {
            const ts = new Date(row.recorded_at).getTime();
            const bucketStart = new Date(Math.floor(ts / bucketMs) * bucketMs).toISOString();
            const key: BucketKey = `${row.deployment_id}|${row.metric_type}|${bucketStart}`;

            const existing = buckets.get(key) ?? {
                deployment_id: row.deployment_id,
                metric_type: row.metric_type,
                bucket_start: bucketStart,
                total_value: 0,
                record_count: 0,
                up_count: 0,
            };

            existing.total_value += Number(row.metric_value);
            existing.record_count += 1;
            if (row.metric_type === 'uptime_check' && row.metric_value === 1) {
                existing.up_count += 1;
            }

            buckets.set(key, existing);
        }

        // 4. Upsert rollup buckets
        const upsertRows = Array.from(buckets.values()).map((b) => ({
            ...b,
            granularity,
            updated_at: now.toISOString(),
        }));

        const { error: upsertErr } = await supabase
            .from('analytics_rollups')
            .upsert(upsertRows, {
                onConflict: 'deployment_id,metric_type,granularity,bucket_start',
            });

        if (upsertErr) throw new Error(`Failed to upsert rollups: ${upsertErr.message}`);

        // 5. Advance cursor
        const { error: updateErr } = await supabase
            .from('rollup_cursors')
            .update({ last_run_at: now.toISOString() })
            .eq('granularity', granularity);

        if (updateErr) throw new Error(`Failed to advance rollup cursor: ${updateErr.message}`);

        return { bucketsWritten: buckets.size };
    }
}

export const analyticsAggregationService = new AnalyticsAggregationService();
