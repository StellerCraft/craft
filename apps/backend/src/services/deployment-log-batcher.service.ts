/**
 * Deployment Log Batcher (#747)
 *
 * Buffers log entries and flushes them to Supabase in configurable batch
 * sizes to reduce individual write latency under high-throughput deployments.
 *
 * Configuration (env vars):
 *   LOG_BATCH_SIZE       — max entries per batch (default: 50)
 *   LOG_FLUSH_INTERVAL_MS — max ms before a partial batch is flushed (default: 500)
 *
 * Guarantees:
 *   - Entries within a batch are ordered by timestamp before insert.
 *   - When 10 batches are in flight, `append` waits for one to finish before
 *     accepting another entry.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LogLevel } from '@craft/types';

export interface LogEntry {
    deploymentId: string;
    level: LogLevel;
    message: string;
    stage?: string;
    metadata?: Record<string, unknown>;
    /** ISO-8601; defaults to now if omitted. */
    timestamp?: string;
}

interface QueuedEntry extends LogEntry {
    timestamp: string;
}

const BATCH_SIZE = parseInt(process.env.LOG_BATCH_SIZE ?? '50', 10);
const FLUSH_INTERVAL_MS = parseInt(process.env.LOG_FLUSH_INTERVAL_MS ?? '500', 10);
const MAX_PENDING_BATCHES = 10;

export class DeploymentLogBatcher {
    private queue: QueuedEntry[] = [];
    private timer: ReturnType<typeof setTimeout> | null = null;
    private pendingFlushes = 0;
    private readonly inFlightFlushes = new Set<Promise<void>>();

    constructor(
        private readonly supabase: SupabaseClient,
        private readonly batchSize = BATCH_SIZE,
        private readonly flushIntervalMs = FLUSH_INTERVAL_MS,
    ) {}

    /**
     * Enqueue a log entry for batched writing.
        * Blocks until in-flight flush pressure drops below the limit.
     */
    async append(entry: LogEntry): Promise<void> {
        // Backpressure: too many in-flight batches
        while (this.pendingFlushes >= MAX_PENDING_BATCHES) {
            await Promise.race(this.inFlightFlushes);
        }

        this.queue.push({ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() });

        if (this.queue.length >= this.batchSize) {
            this._clearTimer();
            await this._flush();
        } else if (!this.timer) {
            this.timer = setTimeout(() => this._flush(), this.flushIntervalMs);
        }
    }

    /** Flush any remaining entries. Call on graceful shutdown. */
    async flush(): Promise<void> {
        this._clearTimer();
        if (this.queue.length > 0) await this._flush();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _flush(): Promise<void> {
        if (this.queue.length === 0) return;

        const batch = this.queue.splice(0, this.batchSize);
        // Guarantee ordering by timestamp within the batch
        batch.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

        const rows = batch.map((e) => ({
            deployment_id: e.deploymentId,
            level: e.level,
            message: e.message,
            stage: e.stage ?? null,
            metadata: e.metadata ?? null,
            created_at: e.timestamp,
        }));

        this.pendingFlushes++;
        const flushPromise = (async () => {
            try {
                const { error } = await this.supabase.from('deployment_logs').insert(rows);
                if (error) {
                    console.error('[log-batcher] Failed to flush batch', { count: rows.length, error: error.message });
                }
            } finally {
                this.pendingFlushes--;
            }
        })();
        this.inFlightFlushes.add(flushPromise);
        try {
            await flushPromise;
        } finally {
            this.inFlightFlushes.delete(flushPromise);
        }
    }

    private _clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}
