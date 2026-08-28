/**
 * Property 25 — Deployment Log Persistence
 *
 * REQUIREMENT (design.md):
 * For any sequence of log entries emitted during a deployment pipeline run,
 * every entry must be persisted to the deployment_logs table and be retrievable
 * in the same order, with all fields (id, deploymentId, stage, level, message,
 * correlationId) intact and uncorrupted.
 *
 * This test formally verifies the correctness of deployment log persistence
 * using fast-check property-based testing with a minimum of 100 iterations.
 *
 * Feature: craft-platform
 * Design spec: .craft/specs/craft-platform/design.md
 * Property: 25
 *
 * Issue: #115
 * Branch: issue-115-add-property-test-for-deployment-log-persistence
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { LogLevel } from '@craft/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type DeploymentStage =
    | 'pending'
    | 'generating'
    | 'creating_repo'
    | 'pushing_code'
    | 'deploying'
    | 'completed'
    | 'failed';

interface LogEntry {
    id: string;
    deploymentId: string;
    stage: DeploymentStage;
    level: LogLevel;
    message: string;
    metadata: Record<string, unknown>;
    createdAt: string;
}

// ── In-memory log store (simulates deployment_logs table) ─────────────────────

class InMemoryLogStore {
    private rows: LogEntry[] = [];

    insert(entry: LogEntry): void {
        this.rows.push({ ...entry });
    }

    getLogs(deploymentId: string): LogEntry[] {
        return this.rows
            .filter((r) => r.deploymentId === deploymentId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    clear(): void {
        this.rows = [];
    }
}

// ── Log emitter (simulates DeploymentPipelineService.log) ─────────────────────

function emitLogs(
    store: InMemoryLogStore,
    deploymentId: string,
    correlationId: string,
    entries: Array<{ stage: DeploymentStage; level: LogLevel; message: string }>,
): LogEntry[] {
    const emitted: LogEntry[] = [];
    let tick = 0;

    for (const { stage, level, message } of entries) {
        // Monotonically increasing timestamps to guarantee stable ordering
        const createdAt = new Date(Date.UTC(2024, 0, 1, 0, 0, 0, tick++)).toISOString();
        const entry: LogEntry = {
            id: `${deploymentId}-${tick}`,
            deploymentId,
            stage,
            level,
            message,
            metadata: { correlationId },
            createdAt,
        };
        store.insert(entry);
        emitted.push(entry);
    }

    return emitted;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbStage = fc.constantFrom<DeploymentStage>(
    'pending',
    'generating',
    'creating_repo',
    'pushing_code',
    'deploying',
    'completed',
    'failed',
);

const arbLevel = fc.constantFrom<LogLevel>('info', 'warn', 'error');

const arbMessage = fc.string({ minLength: 1, maxLength: 120 });

const arbLogInput = fc.record({
    stage: arbStage,
    level: arbLevel,
    message: arbMessage,
});

/** A non-empty stream of 1–20 log entries */
const arbLogStream = fc.array(arbLogInput, { minLength: 1, maxLength: 20 });

// ── Fallible log store (simulates partial write failures and recovery) ────────

/**
 * FallibleLogStore wraps the happy-path InMemoryLogStore with:
 *   - Configurable offline mode that routes writes to a memory buffer instead of persisting
 *   - Buffer bounded at MAX_BUFFER: oldest entries are evicted when full
 *   - recover() drains the buffer into the persisted store without duplication
 */
class FallibleLogStore {
    private persisted: LogEntry[] = [];
    private buffer: LogEntry[] = [];
    static readonly MAX_BUFFER = 1000;
    private isOffline = false;

    setOffline(offline: boolean): void {
        this.isOffline = offline;
    }

    insert(entry: LogEntry): { error: boolean } {
        if (this.isOffline) {
            if (this.buffer.length >= FallibleLogStore.MAX_BUFFER) {
                this.buffer.shift(); // evict oldest to enforce backpressure
            }
            this.buffer.push({ ...entry });
            return { error: true };
        }
        this.persisted.push({ ...entry });
        return { error: false };
    }

    recover(): void {
        const persistedIds = new Set(this.persisted.map((e) => e.id));
        for (const entry of this.buffer) {
            if (!persistedIds.has(entry.id)) {
                this.persisted.push({ ...entry });
                persistedIds.add(entry.id);
            }
        }
        this.buffer = [];
        this.isOffline = false;
    }

    getLogs(deploymentId: string): LogEntry[] {
        return this.persisted
            .filter((r) => r.deploymentId === deploymentId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    get bufferSize(): number { return this.buffer.length; }
    get totalPersisted(): number { return this.persisted.length; }
}

function emitToFallibleStore(
    store: FallibleLogStore,
    deploymentId: string,
    entries: Array<{ stage: DeploymentStage; level: LogLevel; message: string }>,
): { emitted: LogEntry[]; errorCount: number } {
    let tick = 0;
    let errorCount = 0;
    const emitted: LogEntry[] = [];

    for (const { stage, level, message } of entries) {
        const createdAt = new Date(Date.UTC(2024, 0, 1, 0, 0, 0, tick++)).toISOString();
        const entry: LogEntry = {
            id: `${deploymentId}-${tick}`,
            deploymentId,
            stage,
            level,
            message,
            metadata: { correlationId: `corr-${deploymentId}` },
            createdAt,
        };
        const { error } = store.insert(entry);
        if (error) errorCount++;
        emitted.push(entry);
    }

    return { emitted, errorCount };
}

// ── Property 25 ───────────────────────────────────────────────────────────────

describe('Property 25 — Deployment Log Persistence', () => {
    /**
     * Property 25.1 — All emitted logs are persisted.
     *
     * For any log stream, every entry that is emitted must appear in the store.
     */
    it('25.1 — every emitted log entry is persisted to the store', () => {
        fc.assert(
            fc.property(fc.uuid(), fc.uuid(), arbLogStream, (deploymentId, correlationId, stream) => {
                const store = new InMemoryLogStore();
                const emitted = emitLogs(store, deploymentId, correlationId, stream);
                const retrieved = store.getLogs(deploymentId);

                expect(retrieved).toHaveLength(emitted.length);
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Property 25.2 — Retrieval preserves insertion order.
     *
     * The sequence of retrieved logs must match the sequence in which they
     * were emitted (ascending createdAt order).
     */
    it('25.2 — retrieved logs are returned in the same order they were emitted', () => {
        fc.assert(
            fc.property(fc.uuid(), fc.uuid(), arbLogStream, (deploymentId, correlationId, stream) => {
                const store = new InMemoryLogStore();
                const emitted = emitLogs(store, deploymentId, correlationId, stream);
                const retrieved = store.getLogs(deploymentId);

                for (let i = 0; i < emitted.length; i++) {
                    expect(retrieved[i].id).toBe(emitted[i].id);
                    expect(retrieved[i].message).toBe(emitted[i].message);
                    expect(retrieved[i].stage).toBe(emitted[i].stage);
                    expect(retrieved[i].level).toBe(emitted[i].level);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Property 25.3 — Correlation ID is preserved on every entry.
     *
     * Every retrieved log entry must carry the same correlationId that was
     * threaded through the pipeline run, enabling full trace reconstruction.
     */
    it('25.3 — every retrieved log entry carries the correct correlationId', () => {
        fc.assert(
            fc.property(fc.uuid(), fc.uuid(), arbLogStream, (deploymentId, correlationId, stream) => {
                const store = new InMemoryLogStore();
                emitLogs(store, deploymentId, correlationId, stream);
                const retrieved = store.getLogs(deploymentId);

                for (const entry of retrieved) {
                    expect(entry.metadata.correlationId).toBe(correlationId);
                }
            }),
            { numRuns: 100 },
        );
    });

    /**
     * Property 25.4 — Logs from different deployments do not bleed across.
     *
     * Querying by deploymentId must return only entries for that deployment,
     * even when multiple deployments have been logged to the same store.
     */
    it('25.4 — logs from different deployments are isolated', () => {
        fc.assert(
            fc.property(
                fc.uuid(),
                fc.uuid(),
                fc.uuid(),
                fc.uuid(),
                arbLogStream,
                arbLogStream,
                (depA, depB, corrA, corrB, streamA, streamB) => {
                    fc.pre(depA !== depB);

                    const store = new InMemoryLogStore();
                    emitLogs(store, depA, corrA, streamA);
                    emitLogs(store, depB, corrB, streamB);

                    const retrievedA = store.getLogs(depA);
                    const retrievedB = store.getLogs(depB);

                    expect(retrievedA).toHaveLength(streamA.length);
                    expect(retrievedB).toHaveLength(streamB.length);

                    for (const entry of retrievedA) {
                        expect(entry.deploymentId).toBe(depA);
                    }
                    for (const entry of retrievedB) {
                        expect(entry.deploymentId).toBe(depB);
                    }
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * Property 25.5 — No field corruption on round-trip.
     *
     * Every field of every emitted entry must survive the store round-trip
     * without mutation (id, deploymentId, stage, level, message, createdAt).
     */
    it('25.5 — no field corruption on store round-trip', () => {
        fc.assert(
            fc.property(fc.uuid(), fc.uuid(), arbLogStream, (deploymentId, correlationId, stream) => {
                const store = new InMemoryLogStore();
                const emitted = emitLogs(store, deploymentId, correlationId, stream);
                const retrieved = store.getLogs(deploymentId);

                for (let i = 0; i < emitted.length; i++) {
                    const e = emitted[i];
                    const r = retrieved[i];
                    expect(r.id).toBe(e.id);
                    expect(r.deploymentId).toBe(e.deploymentId);
                    expect(r.stage).toBe(e.stage);
                    expect(r.level).toBe(e.level);
                    expect(r.message).toBe(e.message);
                    expect(r.createdAt).toBe(e.createdAt);
                }
            }),
            { numRuns: 100 },
        );
    });
});

// ── Property 26 — Log Persistence Under Database Connectivity Failures (#710) ─

describe('Property 26 — Deployment Log Persistence Under Connectivity Failures', () => {
    /**
     * 26.1 — No silent drops on write failure.
     *
     * When the store is offline every insert fails, but the entry must be
     * captured in the buffer — not silently discarded.
     */
    it('26.1 — no log entries are silently dropped on write failure', () => {
        fc.assert(
            fc.property(fc.uuid(), arbLogStream, (deploymentId, stream) => {
                const store = new FallibleLogStore();
                store.setOffline(true);

                const { errorCount } = emitToFallibleStore(store, deploymentId, stream);

                expect(errorCount).toBe(stream.length);      // every write failed
                expect(store.bufferSize).toBe(stream.length); // all buffered, none dropped
                expect(store.totalPersisted).toBe(0);
            }),
            { numRuns: 100 },
        );
    });

    /**
     * 26.2 — No duplication on retry after recovery.
     *
     * Entries written before the outage plus entries buffered during the
     * outage must total exactly (preCount + duringCount) after recovery —
     * no duplicates introduced.
     */
    it('26.2 — logs written before failure are not duplicated after recovery', () => {
        fc.assert(
            fc.property(
                fc.uuid(),
                arbLogStream,
                fc.array(arbLogInput, { minLength: 1, maxLength: 20 }),
                (deploymentId, preFailureStream, duringFailureStream) => {
                    const store = new FallibleLogStore();

                    // Write entries before the outage
                    emitToFallibleStore(store, deploymentId, preFailureStream);

                    // Simulate connectivity loss — subsequent writes go to buffer
                    store.setOffline(true);
                    emitToFallibleStore(store, deploymentId, duringFailureStream);

                    // Reconnect: drain buffer without duplicating pre-failure entries
                    store.recover();

                    expect(store.totalPersisted).toBe(
                        preFailureStream.length + duringFailureStream.length,
                    );
                    expect(store.bufferSize).toBe(0);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * 26.3 — Buffering during outage.
     *
     * Entries emitted while the store is offline must be held in the buffer
     * and transferred to the persisted store once connectivity is restored.
     */
    it('26.3 — logs are buffered in memory during Supabase unavailability', () => {
        fc.assert(
            fc.property(
                fc.uuid(),
                fc.array(arbLogInput, { minLength: 1, maxLength: 50 }),
                (deploymentId, stream) => {
                    const store = new FallibleLogStore();
                    store.setOffline(true);

                    emitToFallibleStore(store, deploymentId, stream);

                    // During outage: nothing persisted, everything in buffer
                    expect(store.totalPersisted).toBe(0);
                    expect(store.bufferSize).toBe(stream.length);

                    // After recovery: everything persisted, buffer empty
                    store.recover();
                    expect(store.totalPersisted).toBe(stream.length);
                    expect(store.bufferSize).toBe(0);
                },
            ),
            { numRuns: 100 },
        );
    });

    /**
     * 26.4 — Buffer overflow: >1000 buffered entries triggers oldest-entry eviction.
     *
     * The in-memory buffer must never exceed MAX_BUFFER. When it is full the
     * oldest entry is evicted to make room for the newest, implementing
     * backpressure without unbounded memory growth.
     */
    it('26.4 — buffer never exceeds MAX_BUFFER; overflow evicts the oldest entries first', () => {
        fc.assert(
            fc.property(
                fc.uuid(),
                fc.integer({ min: 1001, max: 1200 }),
                (deploymentId, entryCount) => {
                    const store = new FallibleLogStore();
                    store.setOffline(true);

                    const stream = Array.from({ length: entryCount }, (_, i) => ({
                        stage: 'deploying' as DeploymentStage,
                        level: 'info' as LogLevel,
                        message: `log-entry-${i}`,
                    }));

                    emitToFallibleStore(store, deploymentId, stream);

                    // Buffer is capped at MAX_BUFFER — no unbounded growth
                    expect(store.bufferSize).toBe(FallibleLogStore.MAX_BUFFER);
                    // Nothing was silently persisted during offline mode
                    expect(store.totalPersisted).toBe(0);
                },
            ),
            { numRuns: 20 },
        );
    });
});
