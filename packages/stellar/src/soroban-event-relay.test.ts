/**
 * Soroban Contract Event Subscription and WebSocket Relay Tests (#619)
 *
 * Tests event subscription, delivery to subscribers, subscriber cleanup on
 * disconnect, and per-subscriber filtering.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    SorobanEventRelay,
    MAX_SUBSCRIPTIONS_PER_CLIENT,
    ACK_TIMEOUT_MS,
    MAX_DELIVERY_ATTEMPTS,
    DEFAULT_MAX_DEAD_LETTER_BUFFER_SIZE,
    type SorobanEvent,
    type SorobanEventRelayOptions,
} from './soroban-event-relay';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTRACT_A = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const CONTRACT_B = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4';

type CloseListener = () => void;

function makeMockWs(readyState = 1) {
    let closeListener: CloseListener = () => {};
    const ws = {
        readyState,
        send: vi.fn(),
        on: vi.fn().mockImplementation((event: string, listener: CloseListener) => {
            if (event === 'close') closeListener = listener;
        }),
        _triggerClose: () => closeListener(),
    };
    return ws;
}

function makeMockEvent(contractId: string, typeValue: string, ledger = 100) {
    return {
        contractId,
        ledger,
        topic: [{ value: () => typeValue }],
        value: { amount: '100' },
    };
}

function makeMockClient(events: ReturnType<typeof makeMockEvent>[] = [], latestLedger = 100) {
    return {
        getLatestLedger: vi.fn().mockResolvedValue({ sequence: latestLedger }),
        getEvents: vi.fn().mockResolvedValue({
            events,
            latestLedger,
        }),
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SorobanEventRelay – subscription management', () => {
    it('subscribes and tracks subscription count', () => {
        const ws = makeMockWs();
        const client = makeMockClient();
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        expect(relay.subscriptionCount).toBe(1);
    });

    it('does not duplicate an existing subscription', () => {
        const ws = makeMockWs();
        const client = makeMockClient();
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        relay.subscribe({ contractId: CONTRACT_A }); // duplicate
        expect(relay.subscriptionCount).toBe(1);
    });

    it('enforces the per-client subscription limit', () => {
        const ws = makeMockWs();
        const client = makeMockClient();
        const relay = new SorobanEventRelay(ws, client);

        for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_CLIENT; i++) {
            relay.subscribe({ contractId: `C${'A'.repeat(54)}`, eventType: `event-${i}` });
        }

        const error = relay.subscribe({ contractId: CONTRACT_B, eventType: 'overflow' });
        expect(error).toContain('limit reached');
        expect(relay.subscriptionCount).toBe(MAX_SUBSCRIPTIONS_PER_CLIENT);
    });

    it('unsubscribes and decrements count', () => {
        const ws = makeMockWs();
        const client = makeMockClient();
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        relay.unsubscribe({ contractId: CONTRACT_A });
        expect(relay.subscriptionCount).toBe(0);
    });
});

describe('SorobanEventRelay – event delivery', () => {
    it('delivers matching events to the WebSocket', async () => {
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });

        // Wait for the immediate async poll to settle.
        await new Promise((r) => setTimeout(r, 0));

        expect(ws.send).toHaveBeenCalledOnce();
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.contractId).toBe(CONTRACT_A);
        expect(sent.ledger).toBe(101);
    });

    it('filters events by eventType server-side', async () => {
        const ws = makeMockWs();
        const events = [
            makeMockEvent(CONTRACT_A, 'transfer', 101),
            makeMockEvent(CONTRACT_A, 'mint', 102),
        ];
        const client = makeMockClient(events, 102);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A, eventType: 'transfer' });
        await new Promise((r) => setTimeout(r, 0));

        // Only the 'transfer' event should be sent.
        expect(ws.send).toHaveBeenCalledOnce();
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.ledger).toBe(101);
    });

    it('does not send events when WebSocket is closed', async () => {
        const ws = makeMockWs(3); // readyState 3 = CLOSED
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await new Promise((r) => setTimeout(r, 0));

        expect(ws.send).not.toHaveBeenCalled();
    });
});

describe('SorobanEventRelay – guaranteed delivery (#780)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('includes an eventId in the delivered payload', async () => {
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await new Promise(r => setTimeout(r, 0));

        expect(ws.send).toHaveBeenCalledOnce();
        const sent = JSON.parse(ws.send.mock.calls[0][0]) as SorobanEvent;
        expect(sent.eventId).toBeDefined();
        expect(typeof sent.eventId).toBe('string');
    });

    it('does not re-deliver an event after it has been acknowledged', async () => {
        vi.useFakeTimers();
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        // Flush the mock promise chain from the async poll (getLatestLedger + getEvents)
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(ws.send).toHaveBeenCalledOnce();
        const sent = JSON.parse(ws.send.mock.calls[0][0]) as SorobanEvent;

        relay.acknowledgeEvent(sent.eventId);
        vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1);

        expect(ws.send).toHaveBeenCalledOnce();
    });

    it('re-delivers an event after the ACK timeout expires', async () => {
        vi.useFakeTimers();
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(ws.send).toHaveBeenCalledOnce();

        vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1);

        expect(ws.send).toHaveBeenCalledTimes(2);
    });

    it(`moves an event to the dead-letter buffer after ${MAX_DELIVERY_ATTEMPTS} unACKed attempts`, async () => {
        vi.useFakeTimers();
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(ws.send).toHaveBeenCalledOnce();

        // Advance past the ACK timeout MAX_DELIVERY_ATTEMPTS times;
        // the 5th timeout fires, sees attempts === MAX, and routes to DLB
        for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
            vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1);
        }

        expect(ws.send).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);
        expect(relay.deadLetterBuffer).toHaveLength(1);
        expect(relay.deadLetterBuffer[0].contractId).toBe(CONTRACT_A);
    });

    it('re-delivered events carry the same eventId as the original delivery', async () => {
        vi.useFakeTimers();
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        const firstSent = JSON.parse(ws.send.mock.calls[0][0]) as SorobanEvent;

        vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1);

        const secondSent = JSON.parse(ws.send.mock.calls[1][0]) as SorobanEvent;
        expect(secondSent.eventId).toBe(firstSent.eventId);
    });
});

describe('SorobanEventRelay – configurable options', () => {
    it('respects custom pollIntervalMs in options', async () => {
        vi.useFakeTimers();
        vi.clearAllTimers();
        const ws = makeMockWs();
        const client = makeMockClient([], 100);
        const customPollInterval = 1000;
        const relay = new SorobanEventRelay(ws, client, { pollIntervalMs: customPollInterval });

        relay.subscribe({ contractId: CONTRACT_A });
        await Promise.resolve();
        await Promise.resolve();

        // Should use custom interval, not the default POLL_INTERVAL_MS
        expect(client.getEvents).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('respects custom maxSubscriptionsPerClient in options', () => {
        const ws = makeMockWs();
        const client = makeMockClient();
        const customLimit = 3;
        const relay = new SorobanEventRelay(ws, client, { maxSubscriptionsPerClient: customLimit });

        for (let i = 0; i < customLimit; i++) {
            relay.subscribe({ contractId: `C${'A'.repeat(54)}`, eventType: `event-${i}` });
        }

        const error = relay.subscribe({ contractId: CONTRACT_B, eventType: 'overflow' });
        expect(error).toContain('limit reached');
        expect(error).toContain(String(customLimit));
    });

    it('respects custom ackTimeoutMs in options', async () => {
        vi.useFakeTimers();
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const customAckTimeout = 5000;
        const relay = new SorobanEventRelay(ws, client, { ackTimeoutMs: customAckTimeout });

        relay.subscribe({ contractId: CONTRACT_A });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(ws.send).toHaveBeenCalledOnce();

        // Advance by the custom timeout (should trigger re-delivery)
        vi.advanceTimersByTime(customAckTimeout + 1);
        expect(ws.send).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });

    it('respects custom maxDeliveryAttempts in options', async () => {
        vi.useFakeTimers();
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const customMaxAttempts = 2;
        const relay = new SorobanEventRelay(ws, client, {
            ackTimeoutMs: 1000,
            maxDeliveryAttempts: customMaxAttempts
        });

        relay.subscribe({ contractId: CONTRACT_A });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(ws.send).toHaveBeenCalledOnce();

        // Advance timers customMaxAttempts times
        for (let i = 0; i < customMaxAttempts; i++) {
            vi.advanceTimersByTime(1001);
        }

        expect(ws.send).toHaveBeenCalledTimes(customMaxAttempts);
        expect(relay.deadLetterBuffer).toHaveLength(1);

        vi.useRealTimers();
    });
});

describe('SorobanEventRelay – cleanup on disconnect', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('cleans up all subscriptions when WebSocket closes', () => {
        const ws = makeMockWs();
        const client = makeMockClient();
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        relay.subscribe({ contractId: CONTRACT_B });
        expect(relay.subscriptionCount).toBe(2);

        ws._triggerClose();
        expect(relay.subscriptionCount).toBe(0);
    });

    it('clears staged ACK timers when unsubscribing', async () => {
        vi.useFakeTimers();
        const ws = makeMockWs();
        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Event has been delivered and an ACK timer is set.
        expect(ws.send).toHaveBeenCalledOnce();

        // Unsubscribe, which should clear the staged event's timer.
        relay.unsubscribe({ contractId: CONTRACT_A });

        // Advance time past the ACK timeout.
        vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1);

        // No re-delivery should occur because the timer was cancelled.
        expect(ws.send).toHaveBeenCalledOnce();

        // Event should not be in dead-letter buffer (it was cleared on unsubscribe).
        expect(relay.deadLetterBuffer).toHaveLength(0);
    });

    it('does not re-deliver events after unsubscribe despite pending ACKs', async () => {
        vi.useFakeTimers();
        const ws = makeMockWs();
        const events = [
            makeMockEvent(CONTRACT_A, 'transfer', 101),
            makeMockEvent(CONTRACT_A, 'mint', 102),
        ];
        const client = makeMockClient(events, 102);
        const relay = new SorobanEventRelay(ws, client);

        relay.subscribe({ contractId: CONTRACT_A });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Two events delivered.
        expect(ws.send).toHaveBeenCalledTimes(2);

        // Unsubscribe to clear pending ACK timers.
        relay.unsubscribe({ contractId: CONTRACT_A });

        // Advance time multiple times past the ACK timeout.
        for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
            vi.advanceTimersByTime(ACK_TIMEOUT_MS + 1);
        }

        // No additional deliveries should occur.
        expect(ws.send).toHaveBeenCalledTimes(2);

        // Dead-letter buffer should be empty (events were cleared, not DLBed).
        expect(relay.deadLetterBuffer).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// #1107 – dead-letter buffer size cap regression tests
// ---------------------------------------------------------------------------

describe('SorobanEventRelay – dead-letter buffer size cap (#1107)', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('exposes DEFAULT_MAX_DEAD_LETTER_BUFFER_SIZE constant', () => {
        expect(DEFAULT_MAX_DEAD_LETTER_BUFFER_SIZE).toBeGreaterThan(0);
    });

    it('caps the dead-letter buffer at the configured maxDeadLetterBufferSize', async () => {
        vi.useFakeTimers();

        const cap = 3;
        const ws = makeMockWs();

        // Build N+2 events so we can drive more failures than the cap allows
        const totalEvents = cap + 2;
        const events = Array.from({ length: totalEvents }, (_, i) =>
            makeMockEvent(CONTRACT_A, 'transfer', 100 + i),
        );
        const client = makeMockClient(events, 100 + totalEvents - 1);

        const relay = new SorobanEventRelay(ws, client, {
            ackTimeoutMs: 1_000,
            maxDeliveryAttempts: 1, // one attempt → immediately DLB on first timeout
            maxDeadLetterBufferSize: cap,
        });

        relay.subscribe({ contractId: CONTRACT_A });

        // Flush all promises from the initial poll
        for (let i = 0; i < 5; i++) await Promise.resolve();

        // All events have been delivered once (attempts=1); advance past the
        // ACK timeout so every event moves to the dead-letter buffer.
        vi.advanceTimersByTime(1_001);

        // The buffer must not exceed the configured cap.
        expect(relay.deadLetterBuffer.length).toBeLessThanOrEqual(cap);
    });

    it('evicts the oldest entry when the cap is reached (FIFO ring-buffer)', async () => {
        vi.useFakeTimers();

        const cap = 2;
        const ws = makeMockWs();

        // Three events — enough to overflow a cap of 2.
        const events = [
            makeMockEvent(CONTRACT_A, 'transfer', 101),
            makeMockEvent(CONTRACT_A, 'transfer', 102),
            makeMockEvent(CONTRACT_A, 'transfer', 103),
        ];
        const client = makeMockClient(events, 103);

        const relay = new SorobanEventRelay(ws, client, {
            ackTimeoutMs: 1_000,
            maxDeliveryAttempts: 1,
            maxDeadLetterBufferSize: cap,
        });

        relay.subscribe({ contractId: CONTRACT_A });
        // Flush all promises from the initial poll (getLatestLedger + getEvents + delivery chain)
        for (let i = 0; i < 10; i++) await Promise.resolve();

        vi.advanceTimersByTime(1_001);
        // Flush microtasks from the DLB push callbacks
        for (let i = 0; i < 5; i++) await Promise.resolve();

        // Buffer must not exceed cap.
        expect(relay.deadLetterBuffer.length).toBeLessThanOrEqual(cap);
        // The oldest event (ledger 101) should have been evicted; the two
        // most-recent events (ledger 102 and 103) should remain.
        const ledgers = relay.deadLetterBuffer.map((e) => e.ledger);
        expect(ledgers).not.toContain(101);
        expect(ledgers).toContain(103);
    });

    it('does not evict entries when the buffer is below the cap', async () => {
        vi.useFakeTimers();

        const cap = 10;
        const ws = makeMockWs();

        const events = [makeMockEvent(CONTRACT_A, 'transfer', 101)];
        const client = makeMockClient(events, 101);

        const relay = new SorobanEventRelay(ws, client, {
            ackTimeoutMs: 1_000,
            maxDeliveryAttempts: 1,
            maxDeadLetterBufferSize: cap,
        });

        relay.subscribe({ contractId: CONTRACT_A });
        // Flush all promises from the initial poll
        for (let i = 0; i < 10; i++) await Promise.resolve();

        vi.advanceTimersByTime(1_001);
        // Flush microtasks from the DLB push callbacks
        for (let i = 0; i < 5; i++) await Promise.resolve();

        // Exactly one entry, well within the cap.
        expect(relay.deadLetterBuffer).toHaveLength(1);
    });
});