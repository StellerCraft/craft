/**
 * Stripe Payment Flow Tests (#374)
 *
 * Tests for the complete Stripe payment flow:
 * - Checkout session creation
 * - Payment processing
 * - Subscription activation
 * - Webhook event handling
 * - Payment failure scenarios
 *
 * Uses Stripe test mode fixtures exclusively.
 * Run: vitest run tests/payments/stripe-flow.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';
type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing';
type PaymentStatus = 'succeeded' | 'failed' | 'pending' | 'refunded';

interface CheckoutSession {
  id: string;
  url: string;
  priceId: string;
  customerId: string;
  status: 'open' | 'complete' | 'expired';
  successUrl: string;
  cancelUrl: string;
}

interface Subscription {
  id: string;
  customerId: string;
  priceId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  customerId: string;
  subscriptionId?: string;
}

interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stripe test-mode fixtures
// ---------------------------------------------------------------------------

const PRICE_IDS: Record<SubscriptionTier, string> = {
  free: 'price_test_free',
  starter: 'price_test_starter',
  pro: 'price_test_pro',
  enterprise: 'price_test_enterprise',
};

const TIER_BY_PRICE: Record<string, SubscriptionTier> = Object.fromEntries(
  Object.entries(PRICE_IDS).map(([tier, price]) => [price, tier as SubscriptionTier])
);

// ---------------------------------------------------------------------------
// Minimal in-memory Stripe service (test-mode only)
// ---------------------------------------------------------------------------

class StripePaymentService {
  private sessions = new Map<string, CheckoutSession>();
  private subscriptions = new Map<string, Subscription>();
  private paymentIntents = new Map<string, PaymentIntent>();
  private customerSubscriptions = new Map<string, string>(); // customerId -> subscriptionId
  private idCounter = 0;

  private nextId(prefix: string): string {
    return `${prefix}_test_${++this.idCounter}`;
  }

  createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string
  ): CheckoutSession {
    if (!customerId) throw new Error('customerId is required');
    if (!TIER_BY_PRICE[priceId]) throw new Error(`Unknown priceId: ${priceId}`);

    const session: CheckoutSession = {
      id: this.nextId('cs'),
      url: `https://checkout.stripe.com/pay/${this.nextId('cs')}`,
      priceId,
      customerId,
      status: 'open',
      successUrl,
      cancelUrl,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  completeCheckoutSession(sessionId: string): Subscription {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.status !== 'open') throw new Error('Session is not open');

    session.status = 'complete';

    const tier = TIER_BY_PRICE[session.priceId];
    const sub: Subscription = {
      id: this.nextId('sub'),
      customerId: session.customerId,
      priceId: session.priceId,
      tier,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
    };
    this.subscriptions.set(sub.id, sub);
    this.customerSubscriptions.set(session.customerId, sub.id);
    return sub;
  }

  getSubscription(subscriptionId: string): Subscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  getCustomerSubscription(customerId: string): Subscription | undefined {
    const subId = this.customerSubscriptions.get(customerId);
    return subId ? this.subscriptions.get(subId) : undefined;
  }

  cancelSubscription(subscriptionId: string): Subscription {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new Error('Subscription not found');
    sub.cancelAtPeriodEnd = true;
    return sub;
  }

  processPayment(customerId: string, amount: number, currency = 'usd'): PaymentIntent {
    if (amount <= 0) throw new Error('Amount must be positive');
    const pi: PaymentIntent = {
      id: this.nextId('pi'),
      amount,
      currency,
      status: 'succeeded',
      customerId,
    };
    this.paymentIntents.set(pi.id, pi);
    return pi;
  }

  simulatePaymentFailure(customerId: string, amount: number): PaymentIntent {
    const pi: PaymentIntent = {
      id: this.nextId('pi'),
      amount,
      currency: 'usd',
      status: 'failed',
      customerId,
    };
    this.paymentIntents.set(pi.id, pi);
    return pi;
  }

  handleWebhookEvent(event: WebhookEvent): { handled: boolean; action: string } {
    switch (event.type) {
      case 'checkout.session.completed': {
        const sessionId = (event.data as { sessionId: string }).sessionId;
        this.completeCheckoutSession(sessionId);
        return { handled: true, action: 'subscription_activated' };
      }
      case 'customer.subscription.updated': {
        const { subscriptionId, status } = event.data as {
          subscriptionId: string;
          status: SubscriptionStatus;
        };
        const sub = this.subscriptions.get(subscriptionId);
        if (sub) sub.status = status;
        return { handled: true, action: 'subscription_updated' };
      }
      case 'customer.subscription.deleted': {
        const { subscriptionId } = event.data as { subscriptionId: string };
        const sub = this.subscriptions.get(subscriptionId);
        if (sub) sub.status = 'canceled';
        return { handled: true, action: 'subscription_canceled' };
      }
      case 'invoice.payment_failed': {
        const { subscriptionId } = event.data as { subscriptionId: string };
        const sub = this.subscriptions.get(subscriptionId);
        if (sub) sub.status = 'past_due';
        return { handled: true, action: 'subscription_past_due' };
      }
      default:
        return { handled: false, action: 'unhandled_event' };
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stripe Payment Flow', () => {
  let service: StripePaymentService;
  const customerId = 'cus_test_user1';

  beforeEach(() => {
    service = new StripePaymentService();
  });

  // -------------------------------------------------------------------------
  describe('Checkout Session Creation', () => {
    it('creates a checkout session with a valid priceId', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        'https://app.test/success',
        'https://app.test/cancel'
      );

      expect(session.id).toMatch(/^cs_test_/);
      expect(session.status).toBe('open');
      expect(session.priceId).toBe(PRICE_IDS.pro);
      expect(session.customerId).toBe(customerId);
      expect(session.url).toContain('checkout.stripe.com');
    });

    it('throws when customerId is missing', () => {
      expect(() =>
        service.createCheckoutSession('', PRICE_IDS.starter, '/success', '/cancel')
      ).toThrow('customerId is required');
    });

    it('throws for an unknown priceId', () => {
      expect(() =>
        service.createCheckoutSession(customerId, 'price_unknown', '/success', '/cancel')
      ).toThrow('Unknown priceId');
    });

    it('creates separate sessions for each tier', () => {
      const tiers: SubscriptionTier[] = ['starter', 'pro', 'enterprise'];
      const sessions = tiers.map((tier) =>
        service.createCheckoutSession(customerId, PRICE_IDS[tier], '/success', '/cancel')
      );

      const ids = sessions.map((s) => s.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  describe('Payment Processing', () => {
    it('processes a successful payment', () => {
      const pi = service.processPayment(customerId, 2900);

      expect(pi.id).toMatch(/^pi_test_/);
      expect(pi.status).toBe('succeeded');
      expect(pi.amount).toBe(2900);
      expect(pi.currency).toBe('usd');
    });

    it('rejects a payment with non-positive amount', () => {
      expect(() => service.processPayment(customerId, 0)).toThrow('Amount must be positive');
      expect(() => service.processPayment(customerId, -100)).toThrow('Amount must be positive');
    });

    it('simulates a payment failure', () => {
      const pi = service.simulatePaymentFailure(customerId, 2900);

      expect(pi.status).toBe('failed');
      expect(pi.customerId).toBe(customerId);
    });
  });

  // -------------------------------------------------------------------------
  describe('Subscription Activation', () => {
    it('activates a subscription after checkout completes', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        '/success',
        '/cancel'
      );
      const sub = service.completeCheckoutSession(session.id);

      expect(sub.status).toBe('active');
      expect(sub.tier).toBe('pro');
      expect(sub.customerId).toBe(customerId);
      expect(sub.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now());
    });

    it('maps each priceId to the correct tier', () => {
      const tiers: SubscriptionTier[] = ['starter', 'pro', 'enterprise'];

      for (const tier of tiers) {
        const svc = new StripePaymentService();
        const session = svc.createCheckoutSession(
          customerId,
          PRICE_IDS[tier],
          '/success',
          '/cancel'
        );
        const sub = svc.completeCheckoutSession(session.id);
        expect(sub.tier).toBe(tier);
      }
    });

    it('throws when completing an already-completed session', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.starter,
        '/success',
        '/cancel'
      );
      service.completeCheckoutSession(session.id);

      expect(() => service.completeCheckoutSession(session.id)).toThrow('not open');
    });

    it('retrieves the subscription by customer', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        '/success',
        '/cancel'
      );
      service.completeCheckoutSession(session.id);

      const sub = service.getCustomerSubscription(customerId);
      expect(sub).toBeDefined();
      expect(sub?.tier).toBe('pro');
    });

    it('sets cancelAtPeriodEnd to false on activation', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.starter,
        '/success',
        '/cancel'
      );
      const sub = service.completeCheckoutSession(session.id);
      expect(sub.cancelAtPeriodEnd).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('Subscription Cancellation', () => {
    it('marks subscription to cancel at period end', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        '/success',
        '/cancel'
      );
      const sub = service.completeCheckoutSession(session.id);

      const canceled = service.cancelSubscription(sub.id);
      expect(canceled.cancelAtPeriodEnd).toBe(true);
      expect(canceled.status).toBe('active'); // still active until period ends
    });

    it('throws when canceling a non-existent subscription', () => {
      expect(() => service.cancelSubscription('sub_nonexistent')).toThrow('not found');
    });
  });

  // -------------------------------------------------------------------------
  describe('Webhook Event Handling', () => {
    it('handles checkout.session.completed and activates subscription', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        '/success',
        '/cancel'
      );

      const result = service.handleWebhookEvent({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { sessionId: session.id },
      });

      expect(result.handled).toBe(true);
      expect(result.action).toBe('subscription_activated');

      const sub = service.getCustomerSubscription(customerId);
      expect(sub?.status).toBe('active');
    });

    it('handles customer.subscription.updated', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        '/success',
        '/cancel'
      );
      const sub = service.completeCheckoutSession(session.id);

      const result = service.handleWebhookEvent({
        id: 'evt_2',
        type: 'customer.subscription.updated',
        data: { subscriptionId: sub.id, status: 'past_due' },
      });

      expect(result.handled).toBe(true);
      expect(service.getSubscription(sub.id)?.status).toBe('past_due');
    });

    it('handles customer.subscription.deleted', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.starter,
        '/success',
        '/cancel'
      );
      const sub = service.completeCheckoutSession(session.id);

      service.handleWebhookEvent({
        id: 'evt_3',
        type: 'customer.subscription.deleted',
        data: { subscriptionId: sub.id },
      });

      expect(service.getSubscription(sub.id)?.status).toBe('canceled');
    });

    it('handles invoice.payment_failed and marks subscription past_due', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        '/success',
        '/cancel'
      );
      const sub = service.completeCheckoutSession(session.id);

      service.handleWebhookEvent({
        id: 'evt_4',
        type: 'invoice.payment_failed',
        data: { subscriptionId: sub.id },
      });

      expect(service.getSubscription(sub.id)?.status).toBe('past_due');
    });

    it('returns handled=false for unknown event types', () => {
      const result = service.handleWebhookEvent({
        id: 'evt_5',
        type: 'unknown.event',
        data: {},
      });

      expect(result.handled).toBe(false);
      expect(result.action).toBe('unhandled_event');
    });
  });

  // -------------------------------------------------------------------------
  describe('Payment Failure Scenarios', () => {
    it('does not activate subscription on payment failure', () => {
      service.simulatePaymentFailure(customerId, 2900);
      const sub = service.getCustomerSubscription(customerId);
      expect(sub).toBeUndefined();
    });

    it('transitions subscription to past_due after failed invoice', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        '/success',
        '/cancel'
      );
      const sub = service.completeCheckoutSession(session.id);
      expect(sub.status).toBe('active');

      service.handleWebhookEvent({
        id: 'evt_fail',
        type: 'invoice.payment_failed',
        data: { subscriptionId: sub.id },
      });

      expect(service.getSubscription(sub.id)?.status).toBe('past_due');
    });

    it('recovers subscription status after successful retry', () => {
      const session = service.createCheckoutSession(
        customerId,
        PRICE_IDS.pro,
        '/success',
        '/cancel'
      );
      const sub = service.completeCheckoutSession(session.id);

      // Fail
      service.handleWebhookEvent({
        id: 'evt_fail',
        type: 'invoice.payment_failed',
        data: { subscriptionId: sub.id },
      });
      expect(service.getSubscription(sub.id)?.status).toBe('past_due');

      // Recover via subscription.updated
      service.handleWebhookEvent({
        id: 'evt_recover',
        type: 'customer.subscription.updated',
        data: { subscriptionId: sub.id, status: 'active' },
      });
      expect(service.getSubscription(sub.id)?.status).toBe('active');
    });
  });
});
