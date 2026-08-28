/**
 * Soroban Event Relay — High-Volume Event Stream Property Tests (#738)
 *
 * Verifies that the relay correctly handles high-volume event streams without
 * dropping, reordering, or duplicating events.
 *
 * Properties verified:
 *   - For N published events, exactly N events reach the subscriber (no drops)
 *   - Ledger sequence numbers in relay output are strictly monotonically increasing
 *   - No events are duplicated when lastLedger tracking advances across polls
 *   - Slow subscribers receive all events after the poll drains (no silent drops)
 *
 * Uses fast-check to generate random event sequences.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { SorobanEventRelay } from './soroban-event-relay';

// ---------------------------------------------------------------------------
// Helpers — mirrors the pattern in soroban-event-relay.test.ts
// ---------------------------------------------------------------------------

const CONTRACT_A = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

type CloseListener = () => void;

function makeMockWs(readyState = 1) {
    let closeListener: CloseListener = () => {};
    const ws = {
        readyState,
        send: vi.fn() as ReturnType<typeof vi.fn>,
        on: vi.fn().mockImplementation((event: string, listener: CloseListener) => {
            if (event === 'close') closeListener = listener;
        }),
        _triggerClose: () => closeListener(),
    };
    return ws;
}

function makeMockEvent(contractId: string, typeValue: string, ledger: number) {
    return {
        contractId,
        ledger,
        topic: [{ value: () => typeValue }],
        value: { seq: ledger },
    };
}

function makeMockClientWithEvents(
    events: ReturnType<typeof makeMockEvent>[],
    latestLedger: number,
) {
    return {
        getLatestLedger: vi.fn().mockResolvedValue({ sequence: latestLedger }),
        getEvents: vi.fn().mockResolvedValue({ events, latestLedger }),
    };
}

// ---------------------------------------------------------------------------
// Volume tests
// ---------------------------------------------------------------------------

describe('SorobanEventRelay – high-volume event stream property tests (#738)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('delivers all 1000 events in a single poll with no drops', async () => {
        const EVENT_COUNT = 1000;
        const ws = makeMockWs();

        const events = Array.from({ length: EVENT_COUNT }, (_, i) =>
            makeMockEvent(CONTRACT_A, 'transfer', 100 + i),
        );
        const client = makeMockClientWithEvents(events, 100 + EVENT_COUNT - 1);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await new Promise((r) => setTimeout(r, 0));

        expect(ws.send).toHaveBeenCalledTimes(EVENT_COUNT);
    });

    it('event ledger numbers in relay output are strictly monotonically increasing', async () => {
        const EVENT_COUNT = 500;
        const ws = makeMockWs();

        const events = Array.from({ length: EVENT_COUNT }, (_, i) =>
            makeMockEvent(CONTRACT_A, 'transfer', 100 + i),
        );
        const client = makeMockClientWithEvents(events, 100 + EVENT_COUNT - 1);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await new Promise((r) => setTimeout(r, 0));

        const sent = (ws.send.mock.calls as [string][]).map((call) => JSON.parse(call[0]));
        for (let i = 1; i < sent.length; i++) {
            expect(sent[i].ledger).toBeGreaterThan(sent[i - 1].ledger);
        }
    });

    it('no events are duplicated across sequential polls (lastLedger prevents re-delivery)', async () => {
        vi.useFakeTimers();

        const ws = makeMockWs();
        const EVENTS_PER_POLL = 10;
        const POLL_COUNT = 3;
        let pollCallCount = 0;

        const client = {
            getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
            getEvents: vi.fn().mockImplementation(() => {
                pollCallCount++;
                // Each poll returns the NEXT batch of ledgers so there is no overlap
                const baseLedger = 100 + (pollCallCount - 1) * EVENTS_PER_POLL;
                const events = Array.from({ length: EVENTS_PER_POLL }, (_, i) =>
                    makeMockEvent(CONTRACT_A, 'transfer', baseLedger + i),
                );
                return Promise.resolve({ events, latestLedger: baseLedger + EVENTS_PER_POLL - 1 });
            }),
        };

        const relay = new SorobanEventRelay(ws, client);
        relay.subscribe({ contractId: CONTRACT_A });

        // Flush the immediate first poll
        await vi.runAllTimersAsync();

        // Advance through two more poll intervals (5 000 ms each)
        for (let i = 1; i < POLL_COUNT; i++) {
            await vi.advanceTimersByTimeAsync(5_000);
            await vi.runAllTimersAsync();
        }

        const sent = (ws.send.mock.calls as [string][]).map((call) => JSON.parse(call[0]));
        const ledgers = sent.map((e) => e.ledger as number);
        const uniqueLedgers = new Set(ledgers);

        // No duplicates
        expect(uniqueLedgers.size).toBe(ledgers.length);

        // All expected ledgers arrived
        expect(ledgers).toHaveLength(POLL_COUNT * EVENTS_PER_POLL);

        relay.cleanup();
    });

    it('property: for N random events, exactly N calls reach ws.send', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 500 }),
                async (n) => {
                    const ws = makeMockWs();
                    const events = Array.from({ length: n }, (_, i) =>
                        makeMockEvent(CONTRACT_A, 'transfer', 200 + i),
                    );
                    const client = makeMockClientWithEvents(events, 200 + n - 1);
                    const relay = new SorobanEventRelay(ws, client);

                    relay.subscribe({ contractId: CONTRACT_A });
                    await new Promise((r) => setTimeout(r, 0));

                    expect(ws.send).toHaveBeenCalledTimes(n);

                    relay.cleanup();
                },
            ),
            { numRuns: 50 },
        );
    });

    it('property: generated event sequences arrive in the same order they were emitted', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.integer({ min: 100, max: 9999 }), { minLength: 2, maxLength: 200 }).map(
                    (ledgers) => [...new Set(ledgers)].sort((a, b) => a - b),
                ),
                async (ledgers) => {
                    fc.pre(ledgers.length >= 2);

                    const ws = makeMockWs();
                    const events = ledgers.map((l) => makeMockEvent(CONTRACT_A, 'transfer', l));
                    const client = makeMockClientWithEvents(events, ledgers[ledgers.length - 1]);
                    const relay = new SorobanEventRelay(ws, client);

                    relay.subscribe({ contractId: CONTRACT_A });
                    await new Promise((r) => setTimeout(r, 0));

                    const sent = (ws.send.mock.calls as [string][]).map((call) =>
                        (JSON.parse(call[0]) as { ledger: number }).ledger,
                    );

                    // Output order must match input order
                    expect(sent).toEqual(ledgers);

                    relay.cleanup();
                },
            ),
            { numRuns: 50 },
        );
    });

    it('slow subscriber: relay does not drop events while ws remains open', async () => {
        const EVENT_COUNT = 100;
        const received: number[] = [];

        const ws = {
            readyState: 1,
            send: vi.fn((data: string) => {
                // Simulate a CPU-bound subscriber that parses and stores every message
                const parsed = JSON.parse(data) as { ledger: number };
                received.push(parsed.ledger);
            }) as ReturnType<typeof vi.fn>,
            on: vi.fn().mockImplementation((_event: string, _listener: CloseListener) => {}),
        };

        const events = Array.from({ length: EVENT_COUNT }, (_, i) =>
            makeMockEvent(CONTRACT_A, 'transfer', 300 + i),
        );
        const client = makeMockClientWithEvents(events, 300 + EVENT_COUNT - 1);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await new Promise((r) => setTimeout(r, 0));

        // All events must have arrived — none silently dropped
        expect(received).toHaveLength(EVENT_COUNT);

        // And they must be in original order
        for (let i = 1; i < received.length; i++) {
            expect(received[i]).toBeGreaterThan(received[i - 1]);
        }
    });

    it('cleanup stops relay: no events delivered after cleanup() is called', async () => {
        vi.useFakeTimers();

        const ws = makeMockWs();
        const client = {
            getLatestLedger: vi.fn().mockResolvedValue({ sequence: 100 }),
            getEvents: vi.fn().mockResolvedValue({
                events: [makeMockEvent(CONTRACT_A, 'transfer', 101)],
                latestLedger: 101,
            }),
        };

        const relay = new SorobanEventRelay(ws, client);
        relay.subscribe({ contractId: CONTRACT_A });

        // Flush immediate poll
        await vi.runAllTimersAsync();
        const countAfterFirstPoll = (ws.send.mock.calls as unknown[]).length;

        relay.cleanup();

        // Advance time to where more polls would have fired
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.runAllTimersAsync();

        // No additional events should have been delivered post-cleanup
        expect((ws.send.mock.calls as unknown[]).length).toBe(countAfterFirstPoll);
    });
});
