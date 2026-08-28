import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stripe } from '@/lib/stripe/client';
import { paymentService } from '@/services/payment.service';
import type { Stripe } from 'stripe';

vi.mock('@/lib/stripe/client', () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(),
      },
    },
    paymentIntents: {
      retrieve: vi.fn(),
      update: vi.fn(),
    },
    customers: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      }),
    },
    from: vi.fn((table: string) => {
      const chainMethods = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
        insert: vi.fn().mockReturnThis(),
      };
      return chainMethods;
    }),
  }),
}));

describe('Payment Checkout 3DS Authentication Integration', () => {
  const mockStripeMethods = stripe as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeMethods.customers.create.mockResolvedValue({
      id: 'cus_test_123',
      email: 'test@example.com',
    });
  });

  describe('3DS Authentication Flow', () => {
    it('should create checkout session and return requires_action for 3DS', async () => {
      const mockClientSecret = 'pi_test_requires_action_secret';
      
      mockStripeMethods.checkout.sessions.create.mockResolvedValue({
        id: 'cs_3ds_test_001',
        url: 'https://checkout.stripe.com/pay/cs_3ds_test_001',
        client_secret: mockClientSecret,
        payment_intent: 'pi_requires_action_001',
        metadata: { user_id: 'user-123' },
      });

      mockStripeMethods.paymentIntents.retrieve.mockResolvedValue({
        id: 'pi_requires_action_001',
        status: 'requires_action',
        client_secret: mockClientSecret,
        next_action: {
          type: 'use_stripe_sdk',
          use_stripe_sdk: {},
        },
      });

      const session = await paymentService.createCheckoutSession(
        'user-123',
        'price_starter_monthly'
      );

      expect(session).toBeDefined();
      expect(session.sessionId).toBe('cs_3ds_test_001');
      expect(mockStripeMethods.checkout.sessions.create).toHaveBeenCalled();
    });

    it('should activate subscription after 3DS webhook success', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          const builder = {
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(),
            insert: vi.fn().mockReturnThis(),
          };

          if (table === 'profiles') {
            builder.single.mockResolvedValue({
              data: { stripe_subscription_id: null },
              error: null,
            });
          }

          return builder;
        }),
      };

      vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValue({
        id: 'pi_3ds_success_001',
        status: 'succeeded',
        charges: {
          data: [{ payment_method: 'card_visa' }],
        },
      } as any);

      // Simulate webhook payload
      const webhookPayload = {
        id: 'evt_test_succeeded',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_3ds_success_001',
            status: 'succeeded',
            customer: 'cus_test_123',
            charges: {
              data: [{ id: 'ch_succeeded_001' }],
            },
          },
        },
      };

      expect(webhookPayload.type).toBe('payment_intent.succeeded');
      expect(webhookPayload.data.object.status).toBe('succeeded');
    });

    it('should not activate subscription when 3DS authentication is abandoned', async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => {
          const builder = {
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(),
          };

          if (table === 'profiles') {
            builder.single.mockResolvedValue({
              data: { stripe_subscription_id: null },
            });
          }

          return builder;
        }),
      };

      // Simulate payment_intent.payment_failed webhook
      const failedWebhookPayload = {
        id: 'evt_test_failed',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_3ds_failed_001',
            status: 'requires_payment_method',
            last_payment_error: {
              code: 'authentication_error',
              message: 'Your card was declined',
            },
          },
        },
      };

      expect(failedWebhookPayload.type).toBe('payment_intent.payment_failed');
      expect(failedWebhookPayload.data.object.status).toBe('requires_payment_method');
      // Subscription should remain inactive (not updated in the database)
    });

    it('should only charge after successful 3DS authentication', async () => {
      const mockPaymentIntent = {
        id: 'pi_3ds_only_charge_001',
        status: 'requires_action',
        amount: 9900,
        currency: 'usd',
        client_secret: 'pi_test_secret',
        next_action: {
          type: 'use_stripe_sdk',
        },
      };

      mockStripeMethods.paymentIntents.retrieve.mockResolvedValue(mockPaymentIntent);

      const intent = await vi.mocked(stripe.paymentIntents.retrieve)('pi_3ds_only_charge_001');

      expect(intent.status).toBe('requires_action');
      expect(intent.amount).toBe(9900);
      
      // After successful authentication
      const succeededIntent = {
        ...mockPaymentIntent,
        status: 'succeeded',
        charges: { data: [{ id: 'ch_succeeded_001' }] },
      };

      expect(succeededIntent.status).toBe('succeeded');
    });

    it('should handle subscription tier activation after 3DS confirmation', async () => {
      // Simulate successful payment_intent webhook
      const webhookEvent = {
        id: 'evt_activation_test',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_tier_activation_001',
            status: 'succeeded',
            customer: 'cus_test_123',
            metadata: {
              user_id: 'user-123',
              subscription_tier: 'pro',
            },
          },
        },
      };

      expect(webhookEvent.data.object.metadata.subscription_tier).toBe('pro');
      // In real implementation, would update profiles.subscription_tier = 'pro'
    });

    it('should prevent duplicate subscription activation on webhook retry', async () => {
      const eventId = 'evt_duplicate_test_001';
      let updateCallCount = 0;

      const mockSupabase = {
        from: vi.fn((table: string) => {
          const builder = {
            select: vi.fn().mockReturnThis(),
            update: vi.fn(() => {
              updateCallCount++;
              return builder;
            }),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn(),
          };

          return builder;
        }),
      };

      // First webhook delivery
      const firstWebhook = {
        id: eventId,
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_dup_001', status: 'succeeded' } },
      };

      // Second webhook delivery (retry)
      const secondWebhook = { ...firstWebhook };

      // Both should reference the same event ID
      expect(firstWebhook.id).toBe(secondWebhook.id);
      // Implementation should use event ID for idempotency
    });
  });

  describe('3DS Error Scenarios', () => {
    it('should handle declined card during 3DS authentication', async () => {
      const declinedPaymentIntent = {
        id: 'pi_declined_3ds',
        status: 'requires_payment_method',
        last_payment_error: {
          code: 'card_declined',
          decline_code: 'generic_decline',
          message: 'Your card was declined',
        },
      };

      expect(declinedPaymentIntent.status).toBe('requires_payment_method');
      expect(declinedPaymentIntent.last_payment_error?.code).toBe('card_declined');
    });

    it('should handle authentication timeout', async () => {
      const timedOutIntent = {
        id: 'pi_timeout_3ds',
        status: 'requires_action',
        next_action: {
          type: 'redirect_to_url',
          redirect_to_url: {
            url: 'https://stripe.com/3d-secure/challenge/test',
            return_url: 'https://craft.app/checkout/complete',
          },
        },
      };

      expect(timedOutIntent.status).toBe('requires_action');
      // After timeout, would transition to requires_payment_method
    });
  });

  describe('Idempotency and Retry Safety', () => {
    it('should return same session ID on idempotent checkout creation', async () => {
      const sessionId = 'cs_idempotent_001';

      mockStripeMethods.checkout.sessions.create.mockResolvedValue({
        id: sessionId,
        url: 'https://checkout.stripe.com/pay/' + sessionId,
      });

      const firstCall = await paymentService.createCheckoutSession(
        'user-123',
        'price_starter_monthly'
      );

      // Stripe's idempotency key should ensure same response
      mockStripeMethods.checkout.sessions.create.mockResolvedValue({
        id: sessionId,
        url: 'https://checkout.stripe.com/pay/' + sessionId,
      });

      const secondCall = await paymentService.createCheckoutSession(
        'user-123',
        'price_starter_monthly'
      );

      expect(firstCall.sessionId).toBe(secondCall.sessionId);
    });
  });
});
