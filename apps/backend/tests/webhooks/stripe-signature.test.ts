// @vitest-environment node
/**
 * Stripe Webhook Signature Verification Tests (#340)
 *
 * Covers:
 *   - Valid signature acceptance
 *   - Invalid / missing signature rejection
 *   - Replay attack prevention (timestamp tolerance)
 *   - Webhook idempotency
 *   - All supported Stripe event types
 *
 * No real Stripe API calls are made — all verification uses
 * stripe.webhooks.generateTestHeaderString / constructEvent locally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

// ── Constants ─────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests_only';

// Stripe's default tolerance is 300 s; we use the same value.
const TOLERANCE_SECONDS = 300;

const SUPPORTED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
] as const;

type SupportedEventType = (typeof SUPPORTED_EVENTS)[number];

// ── Stripe instance (no API key needed for local webhook verification) ─────────

const stripe = new Stripe('sk_test_placeholder', {
  apiVersion: '2026-02-25.clover',
  typescript: true,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a signed Stripe-Signature header for the given payload.
 * `timestampOffset` shifts the embedded timestamp relative to now (seconds).
 */
function buildSignatureHeader(payload: string, timestampOffset = 0): string {
  const timestamp = Math.floor(Date.now() / 1000) + timestampOffset;
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
    timestamp,
  });
}

function makePayload(type: string, data: object = {}): string {
  return JSON.stringify({
    id: `evt_test_${type.replace(/\./g, '_')}`,
    object: 'event',
    type,
    data: { object: data },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
}

// ── Mock payment handler (replaces paymentService.handleWebhook) ──────────────

const mockHandleWebhook = vi.fn().mockResolvedValue(undefined);

// ── Webhook handler (mirrors apps/backend/src/app/api/webhooks/stripe/route.ts) ─

const processedEventIds = new Set<string>();

async function handleStripeWebhook(request: {
  body: string;
  headers: Record<string, string | undefined>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { body, headers } = request;

  const signature = headers['stripe-signature'];

  if (!signature) {
    return { status: 400, body: { error: 'Missing stripe-signature header' } };
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET);
  } catch (err: any) {
    return { status: 400, body: { error: 'Invalid signature' } };
  }

  // Idempotency guard
  if (processedEventIds.has(event.id)) {
    return { status: 200, body: { received: true, duplicate: true } };
  }
  processedEventIds.add(event.id);

  const supportedSet = new Set<string>(SUPPORTED_EVENTS);
  if (!supportedSet.has(event.type)) {
    return { status: 200, body: { received: true, processed: false } };
  }

  try {
    await mockHandleWebhook(event);
    return { status: 200, body: { received: true, processed: true } };
  } catch {
    return { status: 500, body: { error: 'Webhook processing failed' } };
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  processedEventIds.clear();
});

// ── 1. Valid Signature Acceptance ─────────────────────────────────────────────

describe('Valid Signature Acceptance', () => {
  it('accepts a request with a correctly signed payload', async () => {
    const body = makePayload('checkout.session.completed');
    const res = await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': buildSignatureHeader(body) },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('calls the webhook handler for a valid supported event', async () => {
    const body = makePayload('invoice.payment_succeeded');
    await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': buildSignatureHeader(body) },
    });
    expect(mockHandleWebhook).toHaveBeenCalledOnce();
  });

  it('returns processed: true for a supported event type', async () => {
    const body = makePayload('customer.subscription.created');
    const res = await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': buildSignatureHeader(body) },
    });
    expect(res.body.processed).toBe(true);
  });
});

// ── 2. Invalid / Missing Signature Rejection ──────────────────────────────────

describe('Invalid / Missing Signature Rejection', () => {
  it('returns 400 when stripe-signature header is absent', async () => {
    const body = makePayload('checkout.session.completed');
    const res = await handleStripeWebhook({ body, headers: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing stripe-signature header');
  });

  it('returns 400 for a completely wrong signature value', async () => {
    const body = makePayload('checkout.session.completed');
    const res = await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': 't=1234567890,v1=deadbeefdeadbeef' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('returns 400 when the body is tampered after signing', async () => {
    const body = makePayload('checkout.session.completed');
    const sig = buildSignatureHeader(body);
    const tamperedBody = body.replace('checkout.session.completed', 'invoice.payment_failed');
    const res = await handleStripeWebhook({
      body: tamperedBody,
      headers: { 'stripe-signature': sig },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('returns 400 when signed with a different secret', async () => {
    const body = makePayload('checkout.session.completed');
    const wrongSig = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: 'whsec_wrong_secret',
    });
    const res = await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': wrongSig },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('does not call the webhook handler when signature is invalid', async () => {
    const body = makePayload('invoice.payment_succeeded');
    await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': 't=0,v1=badhash' },
    });
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });
});

// ── 3. Replay Attack Prevention (Timestamp Tolerance) ─────────────────────────

describe('Replay Attack Prevention', () => {
  it('accepts a request with a timestamp within the tolerance window', async () => {
    const body = makePayload('customer.subscription.updated');
    // 60 s in the past — well within the 300 s window
    const sig = buildSignatureHeader(body, -60);
    const res = await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    expect(res.status).toBe(200);
  });

  it('rejects a request whose timestamp is outside the tolerance window', async () => {
    const body = makePayload('customer.subscription.updated');
    // 400 s in the past — beyond the 300 s tolerance
    const sig = buildSignatureHeader(body, -(TOLERANCE_SECONDS + 100));
    const res = await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('accepts a request with a future timestamp (Stripe only enforces past tolerance)', async () => {
    // Stripe's constructEvent only rejects timestamps that are too old,
    // not timestamps in the future. This test documents that behaviour.
    const body = makePayload('invoice.payment_failed');
    const sig = buildSignatureHeader(body, TOLERANCE_SECONDS + 300);
    const res = await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    expect(res.status).toBe(200);
  });

  it('does not process a replayed (expired) event', async () => {
    const body = makePayload('checkout.session.completed');
    const expiredSig = buildSignatureHeader(body, -(TOLERANCE_SECONDS + 1));
    await handleStripeWebhook({ body, headers: { 'stripe-signature': expiredSig } });
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });
});

// ── 4. Webhook Idempotency ────────────────────────────────────────────────────

describe('Webhook Idempotency', () => {
  it('processes an event only once when delivered twice with the same event ID', async () => {
    const body = makePayload('invoice.payment_succeeded');
    const sig = buildSignatureHeader(body);
    await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    const second = await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    expect(mockHandleWebhook).toHaveBeenCalledOnce();
    expect(second.body.duplicate).toBe(true);
  });

  it('returns 200 on a duplicate delivery so Stripe stops retrying', async () => {
    const body = makePayload('customer.subscription.deleted');
    const sig = buildSignatureHeader(body);
    await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    const retry = await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    expect(retry.status).toBe(200);
  });

  it('processes two distinct events independently', async () => {
    const body1 = makePayload('invoice.payment_succeeded');
    const body2 = makePayload('invoice.payment_failed');
    await handleStripeWebhook({ body: body1, headers: { 'stripe-signature': buildSignatureHeader(body1) } });
    await handleStripeWebhook({ body: body2, headers: { 'stripe-signature': buildSignatureHeader(body2) } });
    expect(mockHandleWebhook).toHaveBeenCalledTimes(2);
  });

  it('does not call the handler on a duplicate event', async () => {
    const body = makePayload('customer.subscription.created');
    const sig = buildSignatureHeader(body);
    await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    vi.clearAllMocks();
    await handleStripeWebhook({ body, headers: { 'stripe-signature': sig } });
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });
});

// ── 5. All Supported Event Types ──────────────────────────────────────────────

describe('Supported Event Types', () => {
  it.each(SUPPORTED_EVENTS)('handles "%s" event correctly', async (eventType) => {
    const body = makePayload(eventType);
    const res = await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': buildSignatureHeader(body) },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.processed).toBe(true);
    expect(mockHandleWebhook).toHaveBeenCalledOnce();
    vi.clearAllMocks();
    processedEventIds.clear();
  });

  it('acknowledges unsupported event types with 200 but does not process them', async () => {
    const body = makePayload('payment_intent.created');
    const res = await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': buildSignatureHeader(body) },
    });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
    expect(res.body.processed).toBe(false);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  it('returns 500 when the handler throws for a supported event', async () => {
    mockHandleWebhook.mockRejectedValueOnce(new Error('DB error'));
    const body = makePayload('checkout.session.completed');
    const res = await handleStripeWebhook({
      body,
      headers: { 'stripe-signature': buildSignatureHeader(body) },
    });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Webhook processing failed');
  });
});
