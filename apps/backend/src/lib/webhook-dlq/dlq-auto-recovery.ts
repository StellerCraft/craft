/**
 * DLQ Auto-Recovery Orchestrator (#748)
 *
 * Polls the DLQ at a configurable interval and automatically retries
 * pending entries using exponential backoff with ±10% jitter. The poller's
 * retryState is the source of truth; startup reconciliation re-arms entries
 * whose in-memory schedule was lost during a process restart.
 *
 * Retry schedule (base delays): 1m, 2m, 4m, 8m, 16m, 32m → permanent failure
 *
 * Circuit breaker: after 5 consecutive failures to an endpoint, all retries
 * for that endpoint are paused for 1 hour.
 */

import { webhookDLQ, type DLQEntry } from './dead-letter-queue';
import { calculateBackoffDelay, sleep } from '@/lib/retry/exponential-backoff';
import { CircuitBreaker, type CircuitState } from '@/lib/api/circuit-breaker';
import { createLogger } from '@/lib/api/logger';
import { randomUUID } from 'crypto';

// Re-export so consumers only need one import
export { webhookDLQ };

// Base delays in ms: 1m 2m 4m 8m 16m 32m
const RETRY_DELAYS_MS = [60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000];
const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length;
const CIRCUIT_BREAKER_PAUSE_MS = 60 * 60 * 1_000; // 1 hour
const CIRCUIT_BREAKER_THRESHOLD = 5;

export interface DLQRecoveryConfig {
    /** How often (ms) to scan for retryable entries. Default: 30_000 */
    pollIntervalMs?: number;
    /** Injectable clock for testing. Default: Date.now */
    now?: () => number;
    /** Injectable sleep for testing. Default: real sleep */
    sleep?: (ms: number) => Promise<void>;
    /**
     * Optional callback invoked on every circuit state transition.
     * Receives the circuit key (source:eventType), the previous state, and the new state.
     * Useful for ops dashboards or metrics collection without parsing logs.
     */
    onCircuitStateChange?: (name: string, from: CircuitState, to: CircuitState) => void;
    /**
     * Optional parent circuit breaker state provider (e.g., Horizon client's circuit).
     * If provided, DLQ retries for Horizon-dependent processors will consult this
     * breaker's state to avoid redundant attempts when the upstream service is known to be down.
     * Called with (parentBreakerName) and should return the current CircuitState or null if unknown.
     */
    getParentCircuitState?: (name: string) => CircuitState | null;
}

interface RetryState {
    nextRetryAt: number;
    retryCount: number;
}

export class DLQAutoRecovery {
    private retryState = new Map<string, RetryState>();
    private circuitBreakers = new Map<string, CircuitBreaker>();
    private running = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private circuitStates = new Map<string, CircuitState>();

    private readonly pollIntervalMs: number;
    private readonly now: () => number;
    private readonly sleepFn: (ms: number) => Promise<void>;
    private readonly onCircuitStateChange?: DLQRecoveryConfig['onCircuitStateChange'];
    private readonly getParentCircuitState?: DLQRecoveryConfig['getParentCircuitState'];
    private readonly logger = createLogger({ correlationId: randomUUID() });

    constructor(config: DLQRecoveryConfig = {}) {
        this.pollIntervalMs = config.pollIntervalMs ?? 30_000;
        this.now = config.now ?? Date.now;
        this.sleepFn = config.sleep ?? sleep;
        this.onCircuitStateChange = config.onCircuitStateChange;
        this.getParentCircuitState = config.getParentCircuitState;
    }

    /** Start the background polling loop. */
    start(): void {
        if (this.running) return;
        this.running = true;
        void this.initialize();
        this._scheduleNext();
    }

    /** Re-arm pending entries after a process restart. */
    async initialize(): Promise<void> {
        await this.processDue();
    }

    /** Stop the background polling loop. */
    stop(): void {
        this.running = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    /**
     * Process all due DLQ entries now (single pass).
     * Exposed for direct invocation in tests / cron jobs.
     */
    async processDue(): Promise<void> {
        const pending = webhookDLQ
            .list()
            .filter(
                (e) =>
                    e.reprocessStatus === 'pending' &&
                    // Skip entries already being retried by scheduleRetry() or a
                    // concurrent processDue() invocation to prevent double-execution (#979).
                    !webhookDLQ.inFlight.has(e.id),
            );

        await Promise.all(pending.map((entry) => this._processEntry(entry)));
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private _scheduleNext(): void {
        if (!this.running) return;
        this.timer = setTimeout(async () => {
            await this.processDue();
            this._scheduleNext();
        }, this.pollIntervalMs);
    }

    private _circuitFor(endpointKey: string): CircuitBreaker {
        if (!this.circuitBreakers.has(endpointKey)) {
            const breaker = new CircuitBreaker({
                name: endpointKey,
                failureThreshold: CIRCUIT_BREAKER_THRESHOLD,
                resetTimeoutMs: CIRCUIT_BREAKER_PAUSE_MS,
                now: this.now,
                onStateChange: (name: string, from: CircuitState, to: CircuitState, metadata?: Record<string, unknown>) => {
                    this.circuitStates.set(name, to);
                    this.logger.info('DLQ circuit breaker state transition', {
                        circuitKey: name,
                        from,
                        to,
                        ...metadata,
                    });
                    this.onCircuitStateChange?.(name, from, to);
                },
            });
            this.circuitBreakers.set(endpointKey, breaker);
        }
        return this.circuitBreakers.get(endpointKey)!;
    }

    /** Get current circuit states for all tracked endpoints. Exposed for admin/observability routes. */
    getCircuitStates(): Record<string, CircuitState> {
        return Object.fromEntries(this.circuitStates);
    }

    private async _processEntry(entry: DLQEntry): Promise<void> {
        const state = this.retryState.get(entry.id) ?? { nextRetryAt: 0, retryCount: 0 };

        // Not yet due
        if (this.now() < state.nextRetryAt) return;

        // Exceeded max retries → permanent failure
        if (state.retryCount >= MAX_RETRY_ATTEMPTS) {
            // Mark as permanently failed without touching reprocessStatus (already 'pending')
            // Update failure reason via a no-op reprocess that we track locally only.
            console.error('[dlq-recovery] Permanent failure after max retries', {
                id: entry.id,
                source: entry.source,
                eventType: entry.eventType,
            });
            this.retryState.set(entry.id, { ...state, nextRetryAt: Infinity });
            return;
        }

        const circuitKey = `${entry.source}:${entry.eventType}`;
        const breaker = this._circuitFor(circuitKey);

        // Check if a parent/upstream service circuit breaker is open (e.g., Horizon for Horizon-dependent processors).
        // If so, skip retrying to avoid wasting attempts on a known-down dependency.
        // For now, we check for Horizon-dependent processors by source name convention.
        const parentBreakerName = entry.source === 'webhook' ? 'horizon' : null;
        if (parentBreakerName) {
            const parentState = this.getParentCircuitState?.(parentBreakerName);
            if (parentState === 'OPEN') {
                this.logger.info('Skipping retry due to parent breaker OPEN', {
                    id: entry.id,
                    source: entry.source,
                    eventType: entry.eventType,
                    parentBreaker: parentBreakerName,
                });
                // Reschedule for later when parent might recover
                const attempt = state.retryCount;
                const baseDelay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
                const nextDelay = calculateBackoffDelay(0, baseDelay, baseDelay * 1.1, 1);
                this.retryState.set(entry.id, {
                    nextRetryAt: this.now() + nextDelay,
                    retryCount: attempt,
                });
                return;
            }
        }

        try {
            await breaker.call(() => webhookDLQ.reprocess(entry.id).then((result) => {
                if (!result.success) throw new Error(result.error ?? 'reprocess failed');
            }));

            // Success — clear retry state
            this.retryState.delete(entry.id);
        } catch {
            const attempt = state.retryCount;
            const baseDelay = RETRY_DELAYS_MS[attempt];
            // Apply ±10% jitter (same formula as calculateBackoffDelay but with fixed base)
            const nextDelay = calculateBackoffDelay(0, baseDelay, baseDelay * 1.1, 1);

            this.retryState.set(entry.id, {
                nextRetryAt: this.now() + nextDelay,
                retryCount: attempt + 1,
            });
        }
    }
}
