/**
 * Integration tests for StripeSubscriptionReconciler
 *
 * Covers:
 *   - Replayed customer.subscription.updated events are idempotent
 *   - Out-of-sequence events (updated before created) are handled gracefully
 *   - Trial period expiry: subscription moves from trialing to active
 *   - Stripe test clock simulation via mocked StripeApiClient
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    StripeSubscriptionReconciler,
    type SubscriptionStateRecord,
    type StripeWebhookEvent,
} from './stripe-subscription-reconciler.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

// All event_timestamp values are in Unix milliseconds (Stripe created * 1000).
// Stripe's "created" fields are Unix seconds; multiply by 1000 to get ms.
// e.g. created: 1_700_000 → event_timestamp: 1_700_000_000
function makeState(
    overrides: Partial<SubscriptionStateRecord> = {},
): SubscriptionStateRecord {
    return {
        subscriptionId: 'sub_test123',
        status: 'active',
        event_timestamp: 1_700_000_000,   // same epoch as makeEvent({ created: 1_700_000 })
        ...overrides,
    };
}

function makeEvent(
    overrides: Partial<StripeWebhookEvent> & { status?: string } = {},
): StripeWebhookEvent {
    const { status = 'active', ...rest } = overrides;
    return {
        id: 'evt_test',
        type: 'customer.subscription.updated',
        created: 1_700_000,        // Unix seconds → 1_700_000_000 ms
        data: { object: { id: 'sub_test123', status } },
        ...rest,
    };
}

// ── Stripe API mock ───────────────────────────────────────────────────────────

const mockGetSubscription = vi.fn();
const mockStripeApi = { getSubscription: mockGetSubscription };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StripeSubscriptionReconciler — replayed webhook idempotency', () => {
    let reconciler: StripeSubscriptionReconciler;

    beforeEach(() => {
        vi.clearAllMocks();
        reconciler = new StripeSubscriptionReconciler(mockStripeApi);
    });

    it('returns updated=true on first application', async () => {
        const current = makeState({ event_timestamp: 1_699_999_000 });
        const event = makeEvent({ created: 1_700_000, status: 'active' });

        const { updated } = await reconciler.applyWebhookEvent(current, event);

        expect(updated).toBe(true);
    });

    it('returns updated=false when the same event is replayed (identical timestamp + status)', async () => {
        const current = makeState({
            status: 'active',
            event_timestamp: 1_700_000_000,
        });
        const event = makeEvent({ created: 1_700_000, status: 'active' });

        const { updated, state } = await reconciler.applyWebhookEvent(current, event);

        expect(updated).toBe(false);
        expect(state).toStrictEqual(current);
    });

    it('replaying the same event twice produces identical final state', async () => {
        const initial = makeState({ event_timestamp: 1_699_000_000 });
        const event = makeEvent({ created: 1_700_000, status: 'past_due' });

        const first = await reconciler.applyWebhookEvent(initial, event);
        const second = await reconciler.applyWebhookEvent(first.state, event);

        expect(second.updated).toBe(false);
        expect(second.state).toStrictEqual(first.state);
    });

    it('does not call Stripe API for a clean idempotent replay', async () => {
        const current = makeState({
            status: 'active',
            event_timestamp: 1_700_000_000,
        });
        const event = makeEvent({ created: 1_700_000, status: 'active' });

        await reconciler.applyWebhookEvent(current, event);

        expect(mockGetSubscription).not.toHaveBeenCalled();
    });

    it('dedup by event id: same id replayed is a fast no-op', async () => {
        // First application
        const initial = makeState({ event_timestamp: 1_699_000_000 });
        const event = makeEvent({ id: 'evt_dedup', created: 1_700_000, status: 'active' });

        const first = await reconciler.applyWebhookEvent(initial, event);
        expect(first.updated).toBe(true);
        expect(first.state.lastEventId).toBe('evt_dedup');

        // Redelivery of the exact same event id
        const second = await reconciler.applyWebhookEvent(first.state, event);

        expect(second.updated).toBe(false);
        expect(second.state).toStrictEqual(first.state);
        // Stripe API should not be called for the redelivery
        expect(mockGetSubscription).not.toHaveBeenCalled();
    });

    it('still reconciles on same-timestamp conflict from a different event id', async () => {
        const current = makeState({
            status: 'active',
            event_timestamp: 1_700_000_000,
            lastEventId: 'evt_previous',
        });
        const conflictEvent = makeEvent({
            id: 'evt_conflict',
            created: 1_700_000,
            status: 'past_due',
        });

        mockGetSubscription.mockResolvedValueOnce({
            status: 'past_due',
            updated: 1_700_000,
        });

        const { updated, state } = await reconciler.applyWebhookEvent(current, conflictEvent);

        // Different event id → goes through reconciliation
        expect(mockGetSubscription).toHaveBeenCalledWith('sub_test123');
        expect(updated).toBe(true);
        expect(state.lastEventId).toBe('evt_conflict');
    });

    it('does not let a stale redelivered event bypass staleness via the event-id dedup fast path', async () => {
        // Simulate a state where lastEventId still matches the redelivered event
        // but event_timestamp has advanced past it (e.g. after a conflict-resolution
        // branch updated the timestamp without changing the stored ID).
        const current = makeState({
            status: 'past_due',
            event_timestamp: 1_700_001_000,
            lastEventId: 'evt_stale',
        });
        const staleRedelivery = makeEvent({
            id: 'evt_stale',
            created: 1_700_000,
            status: 'active',
        });

        const { updated, state } = await reconciler.applyWebhookEvent(current, staleRedelivery);

        expect(updated).toBe(false);
        expect(state).toStrictEqual(current);
        expect(mockGetSubscription).not.toHaveBeenCalled();
    });
});

describe('StripeSubscriptionReconciler — out-of-sequence events', () => {
    let reconciler: StripeSubscriptionReconciler;

    beforeEach(() => {
        vi.clearAllMocks();
        reconciler = new StripeSubscriptionReconciler(mockStripeApi);
    });

    it('ignores an event whose timestamp is older than the current state', async () => {
        // Current state reflects a newer event (e.g. from "created")
        const current = makeState({ event_timestamp: 1_700_001_000 });  // 1 s newer than event
        // Stale event: 1 second earlier
        const staleEvent = makeEvent({ created: 1_700_000, status: 'trialing' });

        const { updated, state } = await reconciler.applyWebhookEvent(current, staleEvent);

        expect(updated).toBe(false);
        expect(state).toStrictEqual(current);
    });

    it('does not mutate state when an out-of-order updated event arrives before created', async () => {
        // Simulates receiving customer.subscription.updated before customer.subscription.created
        const created = makeState({
            status: 'trialing',
            event_timestamp: 1_700_001_000,  // "created" event landed first (1 s newer)
        });
        const outOfOrderUpdated = makeEvent({ created: 1_700_000, status: 'active' });

        const { updated } = await reconciler.applyWebhookEvent(created, outOfOrderUpdated);

        expect(updated).toBe(false);
    });

    it('applies an event that arrives slightly after current state timestamp', async () => {
        const current = makeState({ event_timestamp: 1_699_999_000, status: 'trialing' });
        const laterEvent = makeEvent({ created: 1_700_000, status: 'active' });

        const { updated, state } = await reconciler.applyWebhookEvent(current, laterEvent);

        expect(updated).toBe(true);
        expect(state.status).toBe('active');
    });

    it('fetches from Stripe when same timestamp yields conflicting statuses', async () => {
        // Both current state and incoming event share the exact same ms timestamp
        // but report different statuses — Stripe is the source of truth
        const current = makeState({
            status: 'active',
            event_timestamp: 1_700_000_000,
        });
        const conflictEvent = makeEvent({ created: 1_700_000, status: 'past_due' });

        mockGetSubscription.mockResolvedValueOnce({
            status: 'past_due',
            updated: 1_700_000,
        });

        const { updated, state } = await reconciler.applyWebhookEvent(current, conflictEvent);

        expect(mockGetSubscription).toHaveBeenCalledWith('sub_test123');
        expect(updated).toBe(true);
        expect(state.status).toBe('past_due');
    });

    it('keeps current state if Stripe API call fails during conflict resolution', async () => {
        const current = makeState({
            status: 'active',
            event_timestamp: 1_700_000_000,
        });
        const conflictEvent = makeEvent({ created: 1_700_000, status: 'canceled' });

        mockGetSubscription.mockRejectedValueOnce(new Error('Stripe unavailable'));

        const { updated, state } = await reconciler.applyWebhookEvent(current, conflictEvent);

        expect(updated).toBe(false);
        expect(state).toStrictEqual(current);
    });
});

describe('StripeSubscriptionReconciler — trial period expiry via Stripe clock simulation', () => {
    let reconciler: StripeSubscriptionReconciler;

    beforeEach(() => {
        vi.clearAllMocks();
        reconciler = new StripeSubscriptionReconciler(mockStripeApi);
    });

    it('moves subscription from trialing to active when trial expires', async () => {
        const trialingState = makeState({
            status: 'trialing',
            event_timestamp: 1_700_000_000,    // ms: matches created: 1_700_000 baseline
        });
        // Stripe clock advanced: trial_end reached, Stripe fires customer.subscription.updated
        const trialEndEvent = makeEvent({
            created: 1_700_100,   // 100 s after trial start → trial ended
            status: 'active',
        });

        const { updated, state } = await reconciler.applyWebhookEvent(trialingState, trialEndEvent);

        expect(updated).toBe(true);
        expect(state.status).toBe('active');
        expect(state.event_timestamp).toBe(1_700_100_000);
    });

    it('does not advance state if trial-end event arrives before trial start event', async () => {
        // Simulate clock skew: trial_end arrives before trial_start in the queue
        const activeState = makeState({
            status: 'active',
            event_timestamp: 1_700_200_000,   // ms: current state is 200 s newer than baseline
        });
        const lateTrialStart = makeEvent({
            created: 1_699_000,    // older than current active state
            status: 'trialing',
        });

        const { updated } = await reconciler.applyWebhookEvent(activeState, lateTrialStart);

        expect(updated).toBe(false);
    });

    it('correctly sequences trialing → active when Stripe clock is advanced', async () => {
        // Step 1: subscription created in trialing state
        let state = makeState({ status: 'trialing', event_timestamp: 1_700_000_000 });

        // Stripe test clock advances to trial_end timestamp
        const clockAdvancedEvent = makeEvent({ created: 1_700_500, status: 'active' });
        const { state: afterExpiry } = await reconciler.applyWebhookEvent(state, clockAdvancedEvent);

        expect(afterExpiry.status).toBe('active');

        // Step 2: a duplicate event from the same clock advance is idempotent
        const duplicateEvent = makeEvent({ created: 1_700_500, status: 'active' });
        const { updated: secondUpdate } = await reconciler.applyWebhookEvent(afterExpiry, duplicateEvent);

        expect(secondUpdate).toBe(false);
    });

    it('handles past_due state after trial if payment fails', async () => {
        const trialingState = makeState({
            status: 'trialing',
            event_timestamp: 1_700_000_000,
        });
        // Trial ended but payment failed → Stripe fires past_due
        const paymentFailedEvent = makeEvent({ created: 1_700_100, status: 'past_due' });

        const { updated, state } = await reconciler.applyWebhookEvent(trialingState, paymentFailedEvent);

        expect(updated).toBe(true);
        expect(state.status).toBe('past_due');
    });

    it('Stripe API provides authoritative state when clock conflicts occur', async () => {
        // Two events at the exact same Stripe clock tick report different statuses
        const current = makeState({
            status: 'trialing',
            event_timestamp: 1_700_100_000,
        });
        const conflictAtSameTick = makeEvent({ created: 1_700_100, status: 'active' });

        // Stripe clock simulation: getSubscription returns what Stripe believes is truth
        mockGetSubscription.mockResolvedValueOnce({
            status: 'active',
            updated: 1_700_100,
        });

        const { updated, state } = await reconciler.applyWebhookEvent(current, conflictAtSameTick);

        expect(mockGetSubscription).toHaveBeenCalledWith('sub_test123');
        expect(updated).toBe(true);
        expect(state.status).toBe('active');
    });
});
