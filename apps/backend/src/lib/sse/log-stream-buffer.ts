/**
 * LogStreamBuffer
 *
 * A fixed-size ring buffer that sits between a deployment-log producer and an
 * SSE consumer to provide backpressure for slow clients.
 *
 * Without it, a client that reads SSE events slower than they are produced
 * causes the server to buffer log lines indefinitely (unbounded memory). This
 * buffer caps the number of *pending* (not-yet-flushed) log lines per client:
 * when full it drops the oldest entry and records the drop so the route can
 * emit a `buffer_overflow` event.
 *
 * It also assigns a monotonic sequence number to every event (used as the SSE
 * `id:` field) and retains a bounded history of *emitted* events so a client
 * reconnecting with a `Last-Event-ID` header can replay everything it missed
 * within the retained window.
 *
 * Issue: #755 — Real-Time Deployment Log Streaming with SSE Backpressure Handling
 */

export interface LogStreamEvent {
    /** Monotonic sequence number; surfaced to the client as the SSE `id:` field. */
    seq: number;
    /** SSE event name (e.g. "log"). */
    event: string;
    /** Event payload. */
    data: Record<string, unknown>;
}

export interface LogStreamBufferOptions {
    /** Max pending (un-flushed) entries before the oldest is dropped. Default 100. */
    capacity?: number;
    /** Sequence number of the last event the client already has. Numbering resumes after it. */
    startSeq?: number;
    /** Max emitted events retained for Last-Event-ID replay. Default = capacity. */
    historyLimit?: number;
}

const DEFAULT_CAPACITY = 100;

export class LogStreamBuffer {
    private readonly capacity: number;
    private readonly historyLimit: number;
    private readonly pending: LogStreamEvent[] = [];
    private readonly history: LogStreamEvent[] = [];
    private nextSeq: number;
    private droppedSinceFlush = 0;
    private totalDropped = 0;

    constructor(options: LogStreamBufferOptions = {}) {
        this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
        this.historyLimit = Math.max(1, options.historyLimit ?? this.capacity);
        // First event after a reconnect continues numbering from the last seen id.
        this.nextSeq = (options.startSeq ?? 0) + 1;
    }

    /**
     * Enqueue a log line. Assigns the next sequence number and appends it to the
     * pending buffer. If pending now exceeds capacity, the oldest pending entries
     * are dropped (and counted) — this is the backpressure signal.
     */
    enqueue(event: string, data: Record<string, unknown>): LogStreamEvent {
        const entry: LogStreamEvent = { seq: this.nextSeq++, event, data };
        this.pending.push(entry);

        while (this.pending.length > this.capacity) {
            this.pending.shift();
            this.droppedSinceFlush++;
            this.totalDropped++;
        }

        return entry;
    }

    /** Whether entries were dropped due to overflow since the last consumeDropped(). */
    hasOverflow(): boolean {
        return this.droppedSinceFlush > 0;
    }

    /**
     * Return the number of entries dropped since the last call and reset the
     * counter. The route calls this after draining to emit a single
     * `buffer_overflow` event carrying the dropped count.
     */
    consumeDropped(): number {
        const dropped = this.droppedSinceFlush;
        this.droppedSinceFlush = 0;
        return dropped;
    }

    /**
     * Remove and return all pending entries for flushing to the client. Drained
     * entries are recorded in the bounded replay history.
     */
    drain(): LogStreamEvent[] {
        const out = this.pending.splice(0, this.pending.length);
        for (const entry of out) {
            this.history.push(entry);
        }
        while (this.history.length > this.historyLimit) {
            this.history.shift();
        }
        return out;
    }

    /**
     * Replay retained events with a sequence number greater than `lastSeq`,
     * for a client reconnecting via `Last-Event-ID`. Returns entries that are
     * still inside the retained window (oldest-first). The caller can detect a
     * normal capacity-overflow gap when {@link earliestRetainedSeq} is greater
     * than `lastSeq + 1`.
     *
     * **Important — sequence-reset detection (fixes #927):**
     * Before trusting an empty or partial replay result, callers must also check
     * {@link hasSequenceReset}. A new buffer instance (e.g. after a process
     * restart) starts numbering from 1, so a client reconnecting with a large
     * `lastSeq` will pass the normal gap check (earliestRetainedSeq > lastSeq+1
     * evaluates false) yet still receive a misleading empty replay. When
     * `hasSequenceReset(lastSeq)` returns `true` the route should emit an
     * explicit `"stream-reset"` SSE event so the client knows to discard its
     * prior state and start fresh.
     */
    replayFrom(lastSeq: number): LogStreamEvent[] {
        return this.history.filter((e) => e.seq > lastSeq);
    }

    /**
     * Returns `true` when the client's `lastSeq` is higher than any sequence
     * number this buffer instance has ever emitted. This is only possible when
     * the buffer was re-created (e.g. after a process restart) and its counter
     * has reset to a lower starting point than the client's high-water mark.
     *
     * Use this alongside the normal {@link earliestRetainedSeq} gap check:
     * ```
     * if (buffer.hasSequenceReset(clientLastSeq)) {
     *   // emit a "stream-reset" SSE event; do NOT replay
     * } else if ((buffer.earliestRetainedSeq() ?? 0) > clientLastSeq + 1) {
     *   // emit a "buffer_overflow" / gap event; replay what is available
     * } else {
     *   // normal replay
     *   const missed = buffer.replayFrom(clientLastSeq);
     * }
     * ```
     */
    hasSequenceReset(lastSeq: number): boolean {
        return lastSeq > this.lastSeq;
    }

    /** Sequence of the oldest retained event, or null when history is empty. */
    earliestRetainedSeq(): number | null {
        return this.history.length > 0 ? this.history[0].seq : null;
    }

    /** Number of currently pending (un-flushed) entries. */
    get size(): number {
        return this.pending.length;
    }

    /** Sequence number assigned to the most recent event (0 if none yet). */
    get lastSeq(): number {
        return this.nextSeq - 1;
    }

    /** Total entries dropped over the lifetime of this buffer. */
    get totalDroppedCount(): number {
        return this.totalDropped;
    }
}
