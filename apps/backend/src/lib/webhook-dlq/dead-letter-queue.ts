/**
 * Webhook Dead Letter Queue (DLQ)
 *
 * Captures webhook events that exhaust all retry attempts so no event is
 * silently lost. The in-process store is sufficient for single-instance
 * deployments; replace the backing store with Redis / a DB table for
 * horizontally-scaled environments.
 *
 * Reprocessing is guarded by a single-attempt-per-entry flag so the same
 * entry cannot be requeued in an infinite loop.
 *
 * Auto-recovery: scheduleRetry() drives automatic retry with exponential
 * backoff (1m, 2m, 4m, 8m, 16m, 32m → permanent failure) and ±10% jitter.
 *
 * Circuit breaker: after 5 consecutive failures to an endpoint, all retries
 * to that endpoint are paused for 1 hour.
 */

import { randomUUID } from 'crypto';
import { calculateBackoffDelay, sleep } from '../retry/exponential-backoff';

export type WebhookSource = 'stripe' | 'github';

export interface DLQEntry {
    id: string;
    source: WebhookSource;
    eventType: string;
    payload: string;
    failureReason: string;
    attempts: number;
    createdAt: Date;
    reprocessedAt?: Date;
    reprocessStatus?: 'pending' | 'succeeded' | 'failed';
    /** Endpoint URL used for delivery (required for circuit-breaker tracking). */
    endpointUrl?: string;
}

type ProcessorFn = (entry: DLQEntry) => Promise<void>;

// Retry schedule in milliseconds: 1m, 2m, 4m, 8m, 16m, 32m
const RETRY_INTERVALS_MS = [
    1 * 60 * 1000,
    2 * 60 * 1000,
    4 * 60 * 1000,
    8 * 60 * 1000,
    16 * 60 * 1000,
    32 * 60 * 1000,
];

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60 * 60 * 1000; // 1 hour

interface CircuitBreakerState {
    consecutiveFailures: number;
    openedAt: number | null; // timestamp when tripped, null = closed
}

const store = new Map<string, DLQEntry>();
/** Secondary index: stable dedup key → entry id (fixes #926). */
const dedupIndex = new Map<string, string>();
const circuitBreakers = new Map<string, CircuitBreakerState>();
/**
 * Tracks entry IDs that are currently being reprocessed by any path
 * (reprocess() or scheduleRetry()). Guards against concurrent double-execution
 * of the same entry's processor. Fixes #979.
 */
const inFlight = new Set<string>();

let _stripeProcessor: ProcessorFn | null = null;
let _githubProcessor: ProcessorFn | null = null;

function generateId(): string {
    return `dlq_${Date.now()}_${randomUUID()}`;
}

/**
 * Derive a stable dedup key from the logical identity of a webhook delivery.
 * We use a simple deterministic string rather than a crypto hash so there are
 * no extra dependencies and the key remains human-readable in logs.
 */
function deriveDedupKey(source: WebhookSource, eventType: string, payload: string): string {
    return `${source}::${eventType}::${payload}`;
}

function getCircuitBreaker(endpoint: string): CircuitBreakerState {
    if (!circuitBreakers.has(endpoint)) {
        circuitBreakers.set(endpoint, { consecutiveFailures: 0, openedAt: null });
    }
    return circuitBreakers.get(endpoint)!;
}

function isCircuitOpen(endpoint: string): boolean {
    const cb = getCircuitBreaker(endpoint);
    if (cb.openedAt === null) return false;
    if (Date.now() - cb.openedAt >= CIRCUIT_BREAKER_RESET_MS) {
        // Auto-reset after 1 hour
        cb.consecutiveFailures = 0;
        cb.openedAt = null;
        return false;
    }
    return true;
}

function recordSuccess(endpoint: string): void {
    const cb = getCircuitBreaker(endpoint);
    cb.consecutiveFailures = 0;
    cb.openedAt = null;
}

function recordFailure(endpoint: string): void {
    const cb = getCircuitBreaker(endpoint);
    cb.consecutiveFailures += 1;
    if (cb.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && cb.openedAt === null) {
        cb.openedAt = Date.now();
        console.error('[DLQ] Circuit breaker tripped', { endpoint, consecutiveFailures: cb.consecutiveFailures });
    }
}

export const webhookDLQ = {
    registerProcessor(source: WebhookSource, fn: ProcessorFn): void {
        if (source === 'stripe') _stripeProcessor = fn;
        else _githubProcessor = fn;
    },

    capture(
        source: WebhookSource,
        eventType: string,
        payload: string,
        failureReason: string,
        attempts: number,
        endpointUrl?: string,
    ): DLQEntry {
        // --- Dedup check (fixes #926) ---
        // Derive a stable key for this logical webhook delivery.
        const dedupKey = deriveDedupKey(source, eventType, payload);
        const existingId = dedupIndex.get(dedupKey);

        if (existingId !== undefined) {
            const existing = store.get(existingId);
            // Only merge when the existing entry has NOT already succeeded —
            // a succeeded entry must not be resurrected for reprocessing.
            if (existing && existing.reprocessStatus !== 'succeeded') {
                existing.attempts = attempts;
                existing.failureReason = failureReason;
                store.set(existingId, existing);
                console.warn('[DLQ] Duplicate capture merged into existing entry', {
                    id: existingId,
                    source,
                    eventType,
                    attempts,
                    failureReason,
                });
                return existing;
            }
        }

        const entry: DLQEntry = {
            id: generateId(),
            source,
            eventType,
            payload,
            failureReason,
            attempts,
            createdAt: new Date(),
            reprocessStatus: 'pending',
            endpointUrl,
        };
        store.set(entry.id, entry);
        dedupIndex.set(dedupKey, entry.id);
        console.error('[DLQ] Event captured', {
            id: entry.id,
            source,
            eventType,
            attempts,
            failureReason,
        });
        return entry;
    },

    list(): DLQEntry[] {
        return Array.from(store.values()).sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        );
    },

    get(id: string): DLQEntry | undefined {
        return store.get(id);
    },

    async reprocess(id: string): Promise<{ success: boolean; error?: string }> {
        const entry = store.get(id);
        if (!entry) return { success: false, error: 'Entry not found' };

        if (entry.reprocessStatus === 'succeeded') {
            return { success: false, error: 'Entry already successfully reprocessed' };
        }

        // Guard against concurrent double-reprocessing from any path (#979).
        if (inFlight.has(id)) {
            return { success: false, error: 'Entry is already being reprocessed' };
        }

        const processor = entry.source === 'stripe' ? _stripeProcessor : _githubProcessor;
        if (!processor) {
            return { success: false, error: `No processor registered for source: ${entry.source}` };
        }

        inFlight.add(id);
        try {
            await processor(entry);
            entry.reprocessedAt = new Date();
            entry.reprocessStatus = 'succeeded';
            store.set(id, entry);
            const dedupKey = deriveDedupKey(entry.source, entry.eventType, entry.payload);
            dedupIndex.delete(dedupKey);
            return { success: true };
        } catch (err: any) {
            entry.reprocessedAt = new Date();
            entry.reprocessStatus = 'failed';
            entry.failureReason = err?.message ?? 'Reprocessing failed';
            store.set(id, entry);
            return { success: false, error: entry.failureReason };
        } finally {
            inFlight.delete(id);
        }
    },

    /**
     * Schedule automatic retry for a DLQ entry with exponential backoff,
     * ±10% jitter, and circuit-breaker protection per endpoint.
     *
     * Retry schedule: 1m → 2m → 4m → 8m → 16m → 32m → permanent failure.
     * Circuit breaker: 5 consecutive endpoint failures → pause 1 hour.
     */
    async scheduleRetry(id: string): Promise<void> {
        const entry = store.get(id);
        if (!entry) return;
        if (entry.reprocessStatus === 'succeeded') return;

        const processor = entry.source === 'stripe' ? _stripeProcessor : _githubProcessor;
        if (!processor) return;

        // Circuit breaker only applies when an explicit endpoint URL is provided
        const endpoint = entry.endpointUrl ?? null;

        for (let attempt = 0; attempt < RETRY_INTERVALS_MS.length; attempt++) {
            // Re-read entry in case it was mutated
            const current = store.get(id);
            if (!current || current.reprocessStatus === 'succeeded') return;

            // Check circuit breaker before each attempt (only when endpoint URL is known)
            if (endpoint !== null && isCircuitOpen(endpoint)) {
                console.warn('[DLQ] Circuit open, skipping retry', { id, endpoint, attempt });
                console.log('[DLQ] Retry audit', {
                    id,
                    source: current.source,
                    eventType: current.eventType,
                    attempt,
                    outcome: 'circuit_open',
                    timestamp: new Date().toISOString(),
                });
                return;
            }

            const baseDelay = RETRY_INTERVALS_MS[attempt];
            const delay = calculateBackoffDelay(0, baseDelay, baseDelay * 2, 1);
            await sleep(delay);

            // Re-check after sleep
            const afterSleep = store.get(id);
            if (!afterSleep || afterSleep.reprocessStatus === 'succeeded') return;
            if (endpoint !== null && isCircuitOpen(endpoint)) {
                console.warn('[DLQ] Circuit opened during wait, skipping retry', { id, endpoint });
                return;
            }

            // Guard against concurrent double-reprocessing (#979).
            // If reprocess() or another scheduleRetry() iteration has this
            // entry in-flight, skip this attempt to avoid double-execution.
            if (inFlight.has(id)) {
                console.warn('[DLQ] scheduleRetry: entry already in-flight, skipping attempt', { id, attempt });
                continue;
            }

            inFlight.add(id);
            try {
                await processor(afterSleep);
                afterSleep.reprocessedAt = new Date();
                afterSleep.reprocessStatus = 'succeeded';
                afterSleep.attempts += 1;
                store.set(id, afterSleep);
                const dedupKey = deriveDedupKey(afterSleep.source, afterSleep.eventType, afterSleep.payload);
                dedupIndex.delete(dedupKey);
                if (endpoint !== null) recordSuccess(endpoint);
                console.log('[DLQ] Retry audit', {
                    id,
                    source: afterSleep.source,
                    eventType: afterSleep.eventType,
                    attempt,
                    outcome: 'succeeded',
                    timestamp: new Date().toISOString(),
                });
                return;
            } catch (err: any) {
                afterSleep.attempts += 1;
                afterSleep.failureReason = err?.message ?? 'Retry failed';
                store.set(id, afterSleep);
                if (endpoint !== null) recordFailure(endpoint);
                console.log('[DLQ] Retry audit', {
                    id,
                    source: afterSleep.source,
                    eventType: afterSleep.eventType,
                    attempt,
                    outcome: 'failed',
                    error: afterSleep.failureReason,
                    timestamp: new Date().toISOString(),
                });
            } finally {
                inFlight.delete(id);
            }
        }

        // All retries exhausted → permanent failure
        const final = store.get(id);
        if (final) {
            final.reprocessStatus = 'failed';
            store.set(id, final);
            console.error('[DLQ] Permanent failure after all retries', {
                id,
                source: final.source,
                eventType: final.eventType,
                attempts: final.attempts,
                timestamp: new Date().toISOString(),
            });
        }
    },

    size(): number {
        return store.size;
    },

    /** Exposed for testing only. */
    _dedupIndexSize(): number {
        return dedupIndex.size;
    },

    /** Exposed for testing only. */
    _getCircuitBreaker(endpoint: string): CircuitBreakerState {
        return getCircuitBreaker(endpoint);
    },

    /** Exposed for testing only – resets all state. */
    _reset(): void {
        store.clear();
        dedupIndex.clear();
        circuitBreakers.clear();
        inFlight.clear();
        _stripeProcessor = null;
        _githubProcessor = null;
    },

    /**
     * Read-only view of entry IDs currently being reprocessed.
     * Used by DLQAutoRecovery.processDue() to skip in-flight entries (#979).
     */
    get inFlight(): ReadonlySet<string> {
        return inFlight;
    },
};
