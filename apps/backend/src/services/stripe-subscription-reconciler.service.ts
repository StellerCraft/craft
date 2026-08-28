/**
 * StripeSubscriptionReconciler
 *
 * Reconciles out-of-order webhook events using timestamp-based ordering.
 * Ignores stale events and reconciles conflicts by fetching from Stripe API.
 *
 * State reconciliation strategy:
 *   1. Track event_timestamp for each subscription state update
 *   2. Before applying webhook event, compare timestamps
 *   3. Ignore events with older timestamps (stale)
 *   4. On conflict detection, fetch from Stripe API and use as source of truth
 *   5. Update local state with Stripe data
 */

export interface SubscriptionStateRecord {
    subscriptionId: string;
    status: 'active' | 'past_due' | 'canceled' | 'trialing';
    event_timestamp: number; // Unix ms when this state was last updated
    lastEventId?: string;    // Stripe event id that was last applied
}

export interface StripeWebhookEvent {
    id: string;
    type: string;
    created: number; // Unix seconds from Stripe
    data: {
        object: {
            id: string;
            status: string;
        };
    };
}

interface StripeApiClient {
    getSubscription(subscriptionId: string): Promise<{ status: string; updated: number }>;
}

export class StripeSubscriptionReconciler {
    constructor(private readonly stripeApi: StripeApiClient) {}

    /**
     * Apply a Stripe webhook event to the current subscription state using a
     * four-branch timestamp-based decision tree.
     *
     * Note: `event.created` is Unix **seconds** (Stripe convention) and is
     * converted to Unix **milliseconds** internally before comparison with
     * `current.event_timestamp`, which is always stored in milliseconds.
     * Keep this conversion in mind when extending this method.
     *
     * Decision branches:
     *
     * 1. **Stale** — `event.created * 1000 < current.event_timestamp`:
     *    The event arrived out-of-order and is older than the state we already
     *    have. Ignored entirely. Returns `{ updated: false, state: current }`.
     *
     * 2. **No-op (idempotent replay)** — same timestamp AND same status:
     *    The event is an exact duplicate of the current state (e.g. Stripe
     *    redelivery). No change needed. Returns `{ updated: false, state: current }`.
     *
     * 3. **Conflict** — same timestamp BUT different status:
     *    Two events share the same `created` second but disagree on status.
     *    Delegates to `reconcileFromStripe`, which fetches live data from the
     *    Stripe API and uses it as the source of truth. Returns
     *    `{ updated: true, state: <stripe-fetched state> }` on success, or
     *    `{ updated: false, state: current }` if the Stripe API call fails.
     *
     * 4. **Apply** — `event.created * 1000 > current.event_timestamp`:
     *    Normal forward-progress case. The new status from the event is applied
     *    and `event_timestamp` is advanced. Returns `{ updated: true, state: <new state> }`.
     *
     * In all branches `state` is always returned — either the untouched
     * `current` record or a newly derived `SubscriptionStateRecord`.
     *
     * @param current - The most recently persisted subscription state record.
     * @param event   - The incoming Stripe webhook event to reconcile against
     *                  `current`. `event.created` is in Unix seconds.
     * @returns An object with:
     *   - `updated`: `true` if the returned `state` differs from `current`,
     *     `false` if `current` was left unchanged.
     *   - `state`: The authoritative `SubscriptionStateRecord` after reconciliation,
     *     always set (never null/undefined).
     */
    async applyWebhookEvent(
        current: SubscriptionStateRecord,
        event: StripeWebhookEvent,
    ): Promise<{ updated: boolean; state: SubscriptionStateRecord }> {
        // Convert Stripe timestamp (seconds) to milliseconds
        const eventTimestampMs = event.created * 1000;

        // Staleness must be validated BEFORE the event-id dedup fast path.
        // Without this ordering, a late redelivery of an event whose ID still
        // matches `current.lastEventId` could skip the staleness guard and
        // re-apply state older than what `current.event_timestamp` already
        // reflects (e.g. after a conflict-resolution branch advanced the
        // timestamp via `reconcileFromStripe` without changing the stored ID).
        if (eventTimestampMs < current.event_timestamp) {
            return { updated: false, state: current };
        }

        // Dedup by event id: same id already applied → fast no-op
        if (event.id === current.lastEventId) {
            return { updated: false, state: current };
        }

        // Extract new status from event
        const newStatus = event.data.object.status as SubscriptionStateRecord['status'];

        // Check if state actually changed
        if (newStatus === current.status && eventTimestampMs === current.event_timestamp) {
            return { updated: false, state: current };
        }

        // If timestamp is equal but status differs, it's a conflict — fetch from Stripe
        if (eventTimestampMs === current.event_timestamp && newStatus !== current.status) {
            return this.reconcileFromStripe(event.data.object.id, current, event.id);
        }

        // Normal case: newer timestamp, apply the event
        const updated: SubscriptionStateRecord = {
            subscriptionId: current.subscriptionId,
            status: newStatus,
            event_timestamp: eventTimestampMs,
            lastEventId: event.id,
        };

        return { updated: true, state: updated };
    }

    /**
     * Resolve a status conflict by treating the Stripe API as the source of truth.
     *
     * Called only from `applyWebhookEvent` when two events share the same
     * `created` timestamp but carry different statuses — a situation where
     * local event ordering cannot determine the correct outcome.
     *
     * Behaviour:
     * - Fetches the live subscription from the Stripe API using `subscriptionId`.
     * - Constructs a new `SubscriptionStateRecord` from the Stripe response,
     *   advancing `event_timestamp` to `stripeData.updated * 1000` (ms).
     * - Returns `{ updated: true, state: <reconciled> }` on success.
     * - If the Stripe API call throws for any reason (network error, rate limit,
     *   invalid ID, etc.), the error is swallowed and the method returns
     *   `{ updated: false, state: current }`, preserving the last known good state
     *   rather than propagating a failure that would block webhook processing.
     *
     * @param subscriptionId - The Stripe subscription ID to look up.
     * @param current        - The current local state, returned unchanged on API failure.
     * @returns `{ updated: true, state }` with fresh Stripe data, or
     *          `{ updated: false, state: current }` if the API call fails.
     */
    private async reconcileFromStripe(
        subscriptionId: string,
        current: SubscriptionStateRecord,
        eventId?: string,
    ): Promise<{ updated: boolean; state: SubscriptionStateRecord }> {
        try {
            const stripeData = await this.stripeApi.getSubscription(subscriptionId);
            const stripeTimestampMs = stripeData.updated * 1000;

            const reconciled: SubscriptionStateRecord = {
                subscriptionId,
                status: stripeData.status as SubscriptionStateRecord['status'],
                event_timestamp: stripeTimestampMs,
                lastEventId: eventId,
            };

            return { updated: true, state: reconciled };
        } catch {
            // If fetch fails, keep current state
            return { updated: false, state: current };
        }
    }
}
