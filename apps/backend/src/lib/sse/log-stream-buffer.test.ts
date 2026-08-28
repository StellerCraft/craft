/**
 * Unit tests for LogStreamBuffer (#755)
 *
 * Coverage:
 *   - sequence assignment + Last-Event-ID resume (startSeq)
 *   - fixed-size ring buffer backpressure (drop oldest on overflow)
 *   - overflow accounting (consumeDropped / buffer_overflow signalling)
 *   - drain semantics
 *   - replay from a requested sequence (reconnect)
 */
import { describe, it, expect } from 'vitest';
import { LogStreamBuffer } from './log-stream-buffer';

const line = (msg: string) => ({ message: msg });

describe('LogStreamBuffer', () => {
    describe('sequence numbering', () => {
        it('assigns monotonically increasing sequence numbers starting at 1', () => {
            const buf = new LogStreamBuffer();
            expect(buf.enqueue('log', line('a')).seq).toBe(1);
            expect(buf.enqueue('log', line('b')).seq).toBe(2);
            expect(buf.lastSeq).toBe(2);
        });

        it('resumes numbering after startSeq (Last-Event-ID reconnect)', () => {
            const buf = new LogStreamBuffer({ startSeq: 42 });
            expect(buf.enqueue('log', line('a')).seq).toBe(43);
            expect(buf.lastSeq).toBe(43);
        });
    });

    describe('backpressure ring buffer', () => {
        it('caps pending entries at capacity, dropping the oldest', () => {
            const buf = new LogStreamBuffer({ capacity: 3 });
            buf.enqueue('log', line('a')); // seq 1
            buf.enqueue('log', line('b')); // seq 2
            buf.enqueue('log', line('c')); // seq 3
            buf.enqueue('log', line('d')); // seq 4 → drops seq 1

            expect(buf.size).toBe(3);
            const drained = buf.drain();
            expect(drained.map((e) => e.seq)).toEqual([2, 3, 4]);
        });

        it('reports the number of dropped entries and resets the counter', () => {
            const buf = new LogStreamBuffer({ capacity: 2 });
            buf.enqueue('log', line('a'));
            buf.enqueue('log', line('b'));
            buf.enqueue('log', line('c')); // drops 1
            buf.enqueue('log', line('d')); // drops 1

            expect(buf.hasOverflow()).toBe(true);
            expect(buf.consumeDropped()).toBe(2);
            // Counter resets after consumption.
            expect(buf.hasOverflow()).toBe(false);
            expect(buf.consumeDropped()).toBe(0);
            // Lifetime total is retained.
            expect(buf.totalDroppedCount).toBe(2);
        });

        it('does not drop while within capacity', () => {
            const buf = new LogStreamBuffer({ capacity: 100 });
            for (let i = 0; i < 100; i++) buf.enqueue('log', line(`l${i}`));
            expect(buf.size).toBe(100);
            expect(buf.hasOverflow()).toBe(false);
            expect(buf.consumeDropped()).toBe(0);
        });

        it('enforces a minimum capacity of 1', () => {
            const buf = new LogStreamBuffer({ capacity: 0 });
            buf.enqueue('log', line('a'));
            buf.enqueue('log', line('b'));
            expect(buf.size).toBe(1);
            expect(buf.consumeDropped()).toBe(1);
        });
    });

    describe('drain', () => {
        it('removes and returns all pending entries', () => {
            const buf = new LogStreamBuffer();
            buf.enqueue('log', line('a'));
            buf.enqueue('log', line('b'));

            const drained = buf.drain();
            expect(drained).toHaveLength(2);
            expect(buf.size).toBe(0);
            expect(buf.drain()).toEqual([]);
        });
    });

    describe('replay (reconnect)', () => {
        it('replays retained events after the requested sequence', () => {
            const buf = new LogStreamBuffer({ capacity: 10 });
            for (let i = 1; i <= 5; i++) buf.enqueue('log', line(`l${i}`));
            buf.drain(); // flush → recorded in replay history

            const replay = buf.replayFrom(2);
            expect(replay.map((e) => e.seq)).toEqual([3, 4, 5]);
        });

        it('only retains emitted (drained) events for replay, not dropped ones', () => {
            const buf = new LogStreamBuffer({ capacity: 2, historyLimit: 10 });
            buf.enqueue('log', line('a')); // seq 1
            buf.enqueue('log', line('b')); // seq 2
            buf.enqueue('log', line('c')); // seq 3 → drops seq 1 (never emitted)
            buf.drain();

            const replay = buf.replayFrom(0);
            expect(replay.map((e) => e.seq)).toEqual([2, 3]);
        });

        it('bounds replay history to historyLimit and reports the earliest retained seq', () => {
            const buf = new LogStreamBuffer({ capacity: 100, historyLimit: 3 });
            for (let i = 1; i <= 6; i++) {
                buf.enqueue('log', line(`l${i}`));
                buf.drain();
            }
            // Only the last 3 emitted events remain replayable.
            expect(buf.replayFrom(0).map((e) => e.seq)).toEqual([4, 5, 6]);
            expect(buf.earliestRetainedSeq()).toBe(4);
        });

        it('returns an empty replay when nothing has been emitted', () => {
            const buf = new LogStreamBuffer();
            expect(buf.replayFrom(0)).toEqual([]);
            expect(buf.earliestRetainedSeq()).toBeNull();
        });
    });
});
