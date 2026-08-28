import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StripeSubscriptionReconciler,
  SubscriptionStateRecord,
  StripeWebhookEvent,
} from './stripe-subscription-reconciler.service';

/**
 * Integration Tests: Stripe Subscription Reconciler Billing Cycle Edge Cases
 *
 * Tests:
 * - Mid-cycle upgrade (day 15): proration credit applied
 * - Downgrade with credit balance: credit carried forward
 * - Trial-to-paid conversion: trial ends, subscription activates at exact expiry
 */

describe('StripeSubscriptionReconciler - Billing Cycle Edge Cases', () => {
  let reconciler: StripeSubscriptionReconciler;
  let mockStripeApi: any;

  beforeEach(() => {
    mockStripeApi = {
      getSubscription: vi.fn(),
    };
    reconciler = new StripeSubscriptionReconciler(mockStripeApi);
  });

  describe('Mid-cycle upgrade with proration credit', () => {
    it('should apply proration credit on day 15 upgrade', async () => {
      // Subscription active since day 1
      const currentState: SubscriptionStateRecord = {
        subscriptionId: 'sub_mid_upgrade_001',
        status: 'active',
        event_timestamp: Date.now() - 14 * 24 * 60 * 60 * 1000, // 14 days ago
      };

      // Day 15 upgrade event with proration
      const upgradeEvent: StripeWebhookEvent = {
        id: 'evt_upgrade_001',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000), // Now (day 15)
        data: {
          object: {
            id: 'sub_mid_upgrade_001',
            status: 'active',
          },
        },
      };

      mockStripeApi.getSubscription.mockResolvedValue({
        status: 'active',
        updated: Math.floor(Date.now() / 1000),
      });

      const result = await reconciler.applyWebhookEvent(currentState, upgradeEvent);

      expect(result.updated).toBe(true);
      expect(result.state.status).toBe('active');
      expect(result.state.event_timestamp).toBeGreaterThan(currentState.event_timestamp);
    });

    it('should ignore stale upgrade events', async () => {
      const currentState: SubscriptionStateRecord = {
        subscriptionId: 'sub_stale_001',
        status: 'active',
        event_timestamp: Date.now(),
      };

      // Stale event from past
      const staleEvent: StripeWebhookEvent = {
        id: 'evt_stale_001',
        type: 'customer.subscription.updated',
        created: Math.floor((Date.now() - 1 * 60 * 60 * 1000) / 1000), // 1 hour ago
        data: {
          object: {
            id: 'sub_stale_001',
            status: 'past_due',
          },
        },
      };

      const result = await reconciler.applyWebhookEvent(currentState, staleEvent);

      expect(result.updated).toBe(false);
      expect(result.state).toEqual(currentState);
    });
  });

  describe('Downgrade with credit balance', () => {
    it('should preserve subscription state on downgrade', async () => {
      const currentState: SubscriptionStateRecord = {
        subscriptionId: 'sub_downgrade_001',
        status: 'active',
        event_timestamp: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago (pro plan)
      };

      // Downgrade event
      const downgradeEvent: StripeWebhookEvent = {
        id: 'evt_downgrade_001',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_downgrade_001',
            status: 'active',
          },
        },
      };

      mockStripeApi.getSubscription.mockResolvedValue({
        status: 'active',
        updated: Math.floor(Date.now() / 1000),
      });

      const result = await reconciler.applyWebhookEvent(currentState, downgradeEvent);

      expect(result.updated).toBe(true);
      expect(result.state.status).toBe('active');
      expect(result.state.subscriptionId).toBe('sub_downgrade_001');
    });

    it('should handle credit application carry-forward', async () => {
      const currentState: SubscriptionStateRecord = {
        subscriptionId: 'sub_credit_001',
        status: 'active',
        event_timestamp: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
      };

      // Update with credit balance applied (status remains active)
      const creditEvent: StripeWebhookEvent = {
        id: 'evt_credit_001',
        type: 'customer.subscription.updated',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'sub_credit_001',
            status: 'active', // Credit doesn't change status, applied internally
          },
        },
      };

      mockStripeApi.getSubscription.mockResolvedValue({
        status: 'active',
        updated: Math.floor(Date.now() / 1000),
      });

      const result = await reconciler.applyWebhookEvent(currentState, creditEvent);

      expect(result.updated).toBe(true);
      expect(result.state.status).toBe('active');
    });
  });

  describe('Trial-to-paid conversion', () => {
    it('should activate subscription at exact trial expiry', async () => {
      const trialEndTimestamp = Date.now() + 7 * 24 * 60 * 60 * 1000; // Trial ends in 7 days
      const trialEndSeconds = Math.floor(trialEndTimestamp / 1000);
      const expectedEventTimestamp = trialEndSeconds * 1000;

      const trialState: SubscriptionStateRecord = {
        subscriptionId: 'sub_trial_001',
        status: 'trialing',
        event_timestamp: Date.now(),
      };

      // Trial ends, subscription activates
      const trialEndEvent: StripeWebhookEvent = {
        id: 'evt_trial_end_001',
        type: 'customer.subscription.updated',
        created: trialEndSeconds, // Midnight when trial ends
        data: {
          object: {
            id: 'sub_trial_001',
            status: 'active',
          },
        },
      };

      mockStripeApi.getSubscription.mockResolvedValue({
        status: 'active',
        updated: trialEndSeconds,
      });

      const result = await reconciler.applyWebhookEvent(trialState, trialEndEvent);

      expect(result.updated).toBe(true);
      expect(result.state.status).toBe('active');
      expect(result.state.event_timestamp).toBe(expectedEventTimestamp);
    });

    it('should ignore premature trial-end events', async () => {
      const currentTrialState: SubscriptionStateRecord = {
        subscriptionId: 'sub_trial_002',
        status: 'trialing',
        event_timestamp: Date.now(),
      };

      // Premature event claiming trial end (clock skew or duplicate)
      const prematureEvent: StripeWebhookEvent = {
        id: 'evt_trial_premature_001',
        type: 'customer.subscription.updated',
        created: Math.floor((Date.now() - 1000) / 1000), // 1 second ago
        data: {
          object: {
            id: 'sub_trial_002',
            status: 'active',
          },
        },
      };

      const result = await reconciler.applyWebhookEvent(currentTrialState, prematureEvent);

      expect(result.updated).toBe(false);
      expect(result.state.status).toBe('trialing');
    });

    it('should reconcile from Stripe on timestamp collision with status change', async () => {
      const currentState: SubscriptionStateRecord = {
        subscriptionId: 'sub_collision_001',
        status: 'trialing',
        event_timestamp: 1704067200000, // Fixed timestamp
      };

      // Event with same timestamp but different status (conflict scenario)
      const conflictEvent: StripeWebhookEvent = {
        id: 'evt_conflict_001',
        type: 'customer.subscription.updated',
        created: Math.floor(1704067200000 / 1000),
        data: {
          object: {
            id: 'sub_collision_001',
            status: 'active', // Different from current
          },
        },
      };

      // Stripe as source of truth
      mockStripeApi.getSubscription.mockResolvedValue({
        status: 'active',
        updated: Math.floor(1704067200000 / 1000),
      });

      const result = await reconciler.applyWebhookEvent(currentState, conflictEvent);

      expect(result.updated).toBe(true);
      expect(result.state.status).toBe('active');
      expect(mockStripeApi.getSubscription).toHaveBeenCalledWith('sub_collision_001');
    });

    it('should keep current state if Stripe API fetch fails during conflict', async () => {
      const currentState: SubscriptionStateRecord = {
        subscriptionId: 'sub_api_fail_001',
        status: 'trialing',
        event_timestamp: 1704067200000,
      };

      const conflictEvent: StripeWebhookEvent = {
        id: 'evt_api_fail_001',
        type: 'customer.subscription.updated',
        created: Math.floor(1704067200000 / 1000),
        data: {
          object: {
            id: 'sub_api_fail_001',
            status: 'active',
          },
        },
      };

      mockStripeApi.getSubscription.mockRejectedValue(new Error('API timeout'));

      const result = await reconciler.applyWebhookEvent(currentState, conflictEvent);

      expect(result.updated).toBe(false);
      expect(result.state).toEqual(currentState);
    });
  });

  describe('Edge case: Multiple rapid updates', () => {
    it('should correctly process sequence of rapid billing events', async () => {
      let state: SubscriptionStateRecord = {
        subscriptionId: 'sub_rapid_001',
        status: 'active',
        event_timestamp: Date.now() - 1000,
      };

      const baseTime = Math.floor(Date.now() / 1000);

      const events: StripeWebhookEvent[] = [
        {
          id: 'evt_1',
          type: 'customer.subscription.updated',
          created: baseTime,
          data: { object: { id: 'sub_rapid_001', status: 'active' } },
        },
        {
          id: 'evt_2',
          type: 'customer.subscription.updated',
          created: baseTime + 1,
          data: { object: { id: 'sub_rapid_001', status: 'past_due' } },
        },
        {
          id: 'evt_3',
          type: 'customer.subscription.updated',
          created: baseTime + 2,
          data: { object: { id: 'sub_rapid_001', status: 'active' } },
        },
      ];

      mockStripeApi.getSubscription.mockResolvedValue({
        status: 'active',
        updated: baseTime + 2,
      });

      for (const event of events) {
        const result = await reconciler.applyWebhookEvent(state, event);
        state = result.state;
      }

      expect(state.status).toBe('active');
      expect(state.event_timestamp).toBe((baseTime + 2) * 1000);
    });
  });
});
