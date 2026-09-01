/**
 * Audit Log Compaction Service (#749)
 *
 * Archives audit log rows older than the retention period to a cold-storage
 * Supabase Storage bucket, then hard-deletes PII fields (email, ip_address)
 * from those rows in-database (zeroing them out rather than deleting rows).
 *
 * Properties:
 *   - Configurable retention period (default: 90 days)
 *   - PII fields are zeroed out at the retention boundary, not deleted
 *   - Archived events are stored as NDJSON in cold storage and are
 *     restorable for compliance requests
 *   - Idempotent: rows that have already been compacted (pii_redacted=true)
 *     are skipped; archiving uses upsert so re-running is safe
 *
 * Cold storage layout:
 *   audit-archive/{YYYY-MM-DD}/{batchId}.ndjson
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { RETENTION_POLICY, getRetentionPolicyWindows, validateRetentionWindows } from '@/lib/retention-policy';

export interface CompactionConfig {
    /** Days to retain full audit events before PII redaction. Default: 90 */
    retentionDays?: number;
    /** Supabase Storage bucket name for cold archives. Default: 'audit-archive' */
    archiveBucket?: string;
    /** Rows to process per compaction run. Default: 500 */
    batchSize?: number;
    /** Injectable clock for testing. Default: () => new Date() */
    now?: () => Date;
}

export interface CompactionResult {
    archived: number;
    redacted: number;
    errors: number;
}

const PII_FIELDS = ['email', 'ip_address'] as const;
const FAILED_REDACTIONS_PATH = 'compaction-state/failed-redactions.json';

export class AuditLogCompactionService {
    private readonly retentionDays: number;
    private readonly archiveBucket: string;
    private readonly batchSize: number;
    private readonly now: () => Date;

    constructor(
        private readonly supabase: SupabaseClient,
        config: CompactionConfig = {},
    ) {
        this.retentionDays = config.retentionDays ?? RETENTION_POLICY.auditLogCompaction.defaultDays;
        validateRetentionWindows({
            auditLogCompactionDays: this.retentionDays,
            analyticsPurgeDays: getRetentionPolicyWindows().analyticsPurgeDays,
            tombstonedDeploymentPurgeDays: getRetentionPolicyWindows().tombstonedDeploymentPurgeDays,
        });
        this.archiveBucket = config.archiveBucket ?? 'audit-archive';
        this.batchSize = config.batchSize ?? 500;
        this.now = config.now ?? (() => new Date());
    }

    /**
     * Run one compaction pass.
     *
     * 1. Fetch rows older than the retention window that have not yet been redacted.
     * 2. Archive them to cold storage as NDJSON.
     * 3. Zero out PII fields in-database.
     *
     * Returns counts of archived/redacted/errored rows.
     */
    async compact(): Promise<CompactionResult> {
        const cutoff = new Date(this.now());
        cutoff.setDate(cutoff.getDate() - this.retentionDays);
        const cutoffIso = cutoff.toISOString();

        const result: CompactionResult = { archived: 0, redacted: 0, errors: 0 };

        // Fetch rows due for compaction (not yet redacted)
        const { data: rows, error: fetchError } = await this.supabase
            .from('audit_logs')
            .select('*')
            .lt('created_at', cutoffIso)
            .eq('pii_redacted', false)
            .limit(this.batchSize);

        if (fetchError) {
            console.error('[audit-compaction] Failed to fetch rows', fetchError.message);
            return result;
        }

        if (!rows || rows.length === 0) return result;

        const ids = rows.map((r: Record<string, unknown>) => r['id'] as string);

        const failedBatch = await this._getFailedRedactions();
        if (failedBatch && this._isSameBatch(ids, failedBatch.ids)) {
            const ageMs = Date.now() - failedBatch.timestamp;
            if (ageMs < 24 * 60 * 60 * 1000) {
                console.warn(
                    `[audit-compaction] Skipping re-archive of ${ids.length} rows that failed redaction ${Math.round(ageMs / 1000)}s ago`
                );
                result.errors += rows.length;
                return result;
            }
        }

        // Step 1 – Archive to cold storage
        const archiveError = await this._archive(rows, cutoffIso);
        if (archiveError) {
            result.errors += rows.length;
            return result;
        }
        result.archived += rows.length;

        // Step 2 – Redact PII in-database
        const redactUpdate: Record<string, unknown> = { pii_redacted: true };
        for (const field of PII_FIELDS) {
            redactUpdate[field] = null;
        }

        const { error: updateError } = await this.supabase
            .from('audit_logs')
            .update(redactUpdate)
            .in('id', ids);

        if (updateError) {
            console.error('[audit-compaction] Failed to redact PII', updateError.message);
            result.errors += rows.length;
            await this._setFailedRedactions(ids);
        } else {
            result.redacted += rows.length;
            await this._clearFailedRedactions(ids);
        }

        return result;
    }

    /**
     * Restore archived events for a compliance request.
     *
     * @param date - The archive date (YYYY-MM-DD) to restore from
     * @returns Parsed audit rows from cold storage
     */
    async restore(date: string): Promise<unknown[]> {
        const { data: files, error: listError } = await this.supabase.storage
            .from(this.archiveBucket)
            .list(date);

        if (listError || !files) {
            throw new Error(`[audit-compaction] Cannot list archive for ${date}: ${listError?.message}`);
        }

        const records: unknown[] = [];

        for (const file of files) {
            const { data, error } = await this.supabase.storage
                .from(this.archiveBucket)
                .download(`${date}/${file.name}`);

            if (error || !data) continue;

            const text = await data.text();
            for (const line of text.split('\n')) {
                if (line.trim()) records.push(JSON.parse(line));
            }
        }

        return records;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private async _getFailedRedactions(): Promise<{ ids: string[]; timestamp: number } | null> {
        try {
            const { data, error } = await this.supabase
                .storage
                .from(this.archiveBucket)
                .download(FAILED_REDACTIONS_PATH);

            if (error || !data) return null;

            const text = await data.text();
            if (!text.trim()) return null;

            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed.ids)) return null;

            return {
                ids: parsed.ids as string[],
                timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
            };
        } catch {
            return null;
        }
    }

    private async _setFailedRedactions(ids: string[]): Promise<void> {
        try {
            const payload = JSON.stringify({ ids, timestamp: Date.now() });
            await this.supabase.storage
                .from(this.archiveBucket)
                .upload(FAILED_REDACTIONS_PATH, payload, { contentType: 'application/json', upsert: true });
        } catch (err) {
            console.error('[audit-compaction] Failed to persist failed-redaction state', err);
        }
    }

    private async _clearFailedRedactions(ids: string[]): Promise<void> {
        try {
            const existing = await this._getFailedRedactions();
            if (!existing) return;

            const remaining = existing.ids.filter((id) => !ids.includes(id));
            if (remaining.length === 0) {
                await this.supabase.storage
                    .from(this.archiveBucket)
                    .remove([FAILED_REDACTIONS_PATH]);
            } else {
                const payload = JSON.stringify({ ids: remaining, timestamp: Date.now() });
                await this.supabase.storage
                    .from(this.archiveBucket)
                    .upload(FAILED_REDACTIONS_PATH, payload, { contentType: 'application/json', upsert: true });
            }
        } catch (err) {
            console.error('[audit-compaction] Failed to clear failed-redaction state', err);
        }
    }

    private _isSameBatch(ids: string[], other: string[]): boolean {
        if (ids.length !== other.length) return false;
        const set = new Set(ids);
        return other.every((id) => set.has(id));
    }

    private async _archive(rows: Record<string, unknown>[], cutoffIso: string): Promise<Error | null> {
        const dateKey = cutoffIso.slice(0, 10); // YYYY-MM-DD
        const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const path = `${dateKey}/${batchId}.ndjson`;
        const ndjson = rows.map((r) => JSON.stringify(r)).join('\n');

        const { error } = await this.supabase.storage
            .from(this.archiveBucket)
            .upload(path, ndjson, { contentType: 'application/x-ndjson', upsert: true });

        if (error) {
            console.error('[audit-compaction] Archive upload failed', error.message);
            return new Error(error.message);
        }

        return null;
    }
}
