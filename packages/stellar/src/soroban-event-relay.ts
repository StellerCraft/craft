/**
 * Soroban Contract Event Subscription and WebSocket Relay (#619)
 *
 * Subscribes to Soroban contract events via the RPC `getEvents` polling loop
 * and relays matching events to connected WebSocket clients.
 *
 * ## Design
 * - Each subscriber registers a contract ID and optional event type filter.
 * - A per-subscriber polling loop queries `getEvents` from the last seen ledger.
 * - Events are filtered server-side before being sent to the client.
 * - Subscriptions are cleaned up when the WebSocket closes or on explicit unsubscribe.
 * - A per-client subscription limit prevents resource exhaustion.
 */

import { SorobanRpc } from 'stellar-sdk';

/** Maximum concurrent subscriptions allowed per client. */
export const MAX_SUBSCRIPTIONS_PER_CLIENT = 10;

/** Polling interval in milliseconds. */
const POLL_INTERVAL_MS = 5_000;

/** Seconds before an unACKed event is re-delivered. */
export const ACK_TIMEOUT_MS = 30_000;

/** Maximum delivery attempts before an event is moved to the dead-letter buffer. */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Default maximum number of entries the dead-letter buffer may hold. */
export const DEFAULT_MAX_DEAD_LETTER_BUFFER_SIZE = 1_000;

export interface SorobanEventRelayOptions {
    /** Polling interval in milliseconds. Default: 5000 */
    pollIntervalMs?: number;
    /** Maximum concurrent subscriptions per client. Default: 10 */
    maxSubscriptionsPerClient?: number;
    /** Milliseconds before an unACKed event is re-delivered. Default: 30000 */
    ackTimeoutMs?: number;
    /** Maximum delivery attempts before moving to dead-letter. Default: 5 */
    maxDeliveryAttempts?: number;
    /**
     * Maximum number of entries allowed in the dead-letter buffer.
     * Once this limit is reached the oldest entry is evicted before the new
     * one is pushed (ring-buffer behaviour).
     * Default: 1000
     */
    maxDeadLetterBufferSize?: number;
}

export interface SubscriptionFilter {
    /** Contract address (C...) to subscribe to. */
    contractId: string;
    /** Optional event type filter (e.g. "transfer"). Matches all types when omitted. */
    eventType?: string;
}

export interface SorobanEvent {
    /** Unique ID for this delivery; pass to {@link SorobanEventRelay.acknowledgeEvent}. */
    eventId: string;
    contractId: string;
    type: string;
    ledger: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
}

interface StagedEvent {
    event: SorobanEvent;
    attempts: number;
    timer: ReturnType<typeof setTimeout>;
    subscriptionKey: string;
}

/** Minimal WebSocket interface — compatible with the browser/Node ws API. */
export interface WebSocketLike {
    readyState: number;
    send(data: string): void;
    on(event: 'close', listener: () => void): void;
}

/** WebSocket readyState constant for an open connection. */
const WS_OPEN = 1;

interface Subscription {
    filter: SubscriptionFilter;
    lastLedger: number;
    timer: ReturnType<typeof setInterval>;
}

/**
 * Manages Soroban contract event subscriptions for a single WebSocket client.
 *
 * Usage:
 * ```ts
 * const relay = new SorobanEventRelay(ws, sorobanClient, {
 *   pollIntervalMs: 3000,
 *   ackTimeoutMs: 15000,
 * });
 * relay.subscribe({ contractId: 'C...', eventType: 'transfer' });
 * // Events are sent to `ws` as JSON strings.
 * // Cleanup happens automatically on ws close.
 * ```
 */
export class SorobanEventRelay {
    private readonly subscriptions = new Map<string, Subscription>();
    private readonly stagingBuffer = new Map<string, StagedEvent>();
    private readonly _deadLetterBuffer: SorobanEvent[] = [];
    private eventCounter = 0;
    private readonly pollIntervalMs: number;
    private readonly maxSubscriptionsPerClient: number;
    private readonly ackTimeoutMs: number;
    private readonly maxDeliveryAttempts: number;
    private readonly maxDeadLetterBufferSize: number;

    constructor(
        private readonly ws: WebSocketLike,
        private readonly client: Pick<SorobanRpc.Server, 'getEvents' | 'getLatestLedger'>,
        options?: SorobanEventRelayOptions,
    ) {
        this.pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS;
        this.maxSubscriptionsPerClient = options?.maxSubscriptionsPerClient ?? MAX_SUBSCRIPTIONS_PER_CLIENT;
        this.ackTimeoutMs = options?.ackTimeoutMs ?? ACK_TIMEOUT_MS;
        this.maxDeliveryAttempts = options?.maxDeliveryAttempts ?? MAX_DELIVERY_ATTEMPTS;
        this.maxDeadLetterBufferSize = options?.maxDeadLetterBufferSize ?? DEFAULT_MAX_DEAD_LETTER_BUFFER_SIZE;
        ws.on('close', () => this.cleanup());
    }

    /** Events that exceeded {@link MAX_DELIVERY_ATTEMPTS} without an ACK. */
    get deadLetterBuffer(): readonly SorobanEvent[] {
        return this._deadLetterBuffer;
    }

    /**
     * Subscribe to events for a contract, optionally filtered by event type.
     * Returns an error string if the subscription limit is reached.
     */
    subscribe(filter: SubscriptionFilter): string | null {
        const key = subscriptionKey(filter);

        if (this.subscriptions.has(key)) return null; // already subscribed

        if (this.subscriptions.size >= this.maxSubscriptionsPerClient) {
            return `Subscription limit reached (max ${this.maxSubscriptionsPerClient} per client)`;
        }

        const timer = setInterval(() => this.poll(key), this.pollIntervalMs);

        this.subscriptions.set(key, {
            filter,
            lastLedger: 0,
            timer,
        });

        // Kick off an immediate first poll.
        this.poll(key);

        return null;
    }

    /** Unsubscribe from a specific contract/event-type combination. */
    unsubscribe(filter: SubscriptionFilter): void {
        const key = subscriptionKey(filter);
        const sub = this.subscriptions.get(key);
        if (sub) {
            clearInterval(sub.timer);
            this.subscriptions.delete(key);

            // Clean up any staged events belonging to this subscription.
            for (const [eventId, staged] of this.stagingBuffer.entries()) {
                if (staged.subscriptionKey === key) {
                    clearTimeout(staged.timer);
                    this.stagingBuffer.delete(eventId);
                }
            }
        }
    }

    /** Number of active subscriptions for this client. */
    get subscriptionCount(): number {
        return this.subscriptions.size;
    }

    /**
     * Acknowledge receipt of an event.
     * Clears the re-delivery timer so the event is not re-sent.
     * Unrecognised IDs are silently ignored (idempotent).
     */
    acknowledgeEvent(eventId: string): void {
        const staged = this.stagingBuffer.get(eventId);
        if (staged) {
            clearTimeout(staged.timer);
            this.stagingBuffer.delete(eventId);
        }
    }

    /** Clean up all subscriptions (called on WebSocket close). */
    cleanup(): void {
        for (const sub of this.subscriptions.values()) {
            clearInterval(sub.timer);
        }
        this.subscriptions.clear();

        for (const staged of this.stagingBuffer.values()) {
            clearTimeout(staged.timer);
        }
        this.stagingBuffer.clear();
    }

    // -------------------------------------------------------------------------
    // Private
    // -------------------------------------------------------------------------

    private async poll(key: string): Promise<void> {
        const sub = this.subscriptions.get(key);
        if (!sub || this.ws.readyState !== WS_OPEN) return;

        try {
            const latestLedger = await this.client.getLatestLedger();
            const startLedger = sub.lastLedger > 0 ? sub.lastLedger + 1 : latestLedger.sequence;

            const response = await this.client.getEvents({
                startLedger,
                filters: [
                    {
                        type: 'contract',
                        contractIds: [sub.filter.contractId],
                    },
                ],
            });

            // Update the last seen ledger.
            if (response.latestLedger > sub.lastLedger) {
                sub.lastLedger = response.latestLedger;
            }

            for (const rpcEvent of response.events) {
                // Server-side filter by event type when specified.
                if (sub.filter.eventType) {
                    const typeTopic = rpcEvent.topic?.[0]?.value?.();
                    if (typeTopic !== sub.filter.eventType) continue;
                }

                if (this.ws.readyState !== WS_OPEN) break;

                const eventId = `${rpcEvent.contractId}:${rpcEvent.ledger}:${this.eventCounter++}`;
                const payload: SorobanEvent = {
                    eventId,
                    contractId: rpcEvent.contractId,
                    type: sub.filter.eventType ?? 'contract',
                    ledger: rpcEvent.ledger,
                    value: rpcEvent.value,
                };

                this.deliverWithAck(eventId, payload, 1, key);
            }
        } catch {
            // Polling errors are non-fatal; the next interval will retry.
        }
    }

    /**
     * Send an event to the subscriber and set an ACK timer.
     * If the subscriber does not call {@link acknowledgeEvent} within the
     * configured ACK timeout, the event is re-delivered (up to the configured
     * max attempts) before being moved to the dead-letter buffer.
     */
    private deliverWithAck(eventId: string, event: SorobanEvent, attempts: number, subKey: string): void {
        if (this.ws.readyState !== WS_OPEN) return;

        this.ws.send(JSON.stringify(event));

        const timer = setTimeout(() => {
            this.stagingBuffer.delete(eventId);
            if (attempts < this.maxDeliveryAttempts) {
                this.deliverWithAck(eventId, event, attempts + 1, subKey);
            } else {
                if (this._deadLetterBuffer.length >= this.maxDeadLetterBufferSize) {
                    this._deadLetterBuffer.shift();
                }
                this._deadLetterBuffer.push(event);
            }
        }, this.ackTimeoutMs);

        this.stagingBuffer.set(eventId, { event, attempts, timer, subscriptionKey: subKey });
    }
}

function subscriptionKey(filter: SubscriptionFilter): string {
    return `${filter.contractId}:${filter.eventType ?? '*'}`;
}
