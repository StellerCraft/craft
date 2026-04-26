// @vitest-environment node
/**
 * GitHub Webhook Security & Processing Tests
 *
 * Covers:
 *   - Signature validation (valid / invalid / missing)
 *   - Event routing by x-github-event header (push, pull_request, ping)
 *   - Replay attack prevention (duplicate x-github-delivery IDs)
 *   - Idempotency / retry handling (same event delivered twice)
 *
 * Run: vitest run tests/webhooks/github-verification.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── Fixtures ──────────────────────────────────────────────────────────────────

import pushPayload from '../fixtures/github/push-event.json';
import prPayload from '../fixtures/github/pr-event.json';
import pingPayload from '../fixtures/github/ping-event.json';

// ── Constants ─────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-secret';

// ── Helper: sign a payload ────────────────────────────────────────────────────

/**
 * Generates a valid `x-hub-signature-256` header value for the given payload
 * using the provided secret — mirrors GitHub's own signing logic.
 */
function signPayload(payload: string, secret: string = WEBHOOK_SECRET): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

// ── In-memory delivery ID store (idempotency / replay cache) ──────────────────

const deliveryStore = new Set<string>();

function clearDeliveryStore() {
  deliveryStore.clear();
}

function hasDelivery(id: string): boolean {
  return deliveryStore.has(id);
}

function recordDelivery(id: string): void {
  deliveryStore.add(id);
}

// ── Mock event processors ─────────────────────────────────────────────────────

const mockProcessPush = vi.fn().mockResolvedValue({ ok: true });
const mockProcessPR   = vi.fn().mockResolvedValue({ ok: true });
const mockProcessPing = vi.fn().mockResolvedValue({ ok: true });

// ── Webhook handler (unit under test) ─────────────────────────────────────────

async function handleGitHubWebhook(request: {
  body: string;
  headers: Record<string, string | undefined>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { body, headers } = request;

  // 1. Require signature header
  const signature = headers['x-hub-signature-256'];
  if (!signature) {
    return { status: 401, body: { error: 'Missing x-hub-signature-256 header' } };
  }

  // 2. Verify HMAC signature using timing-safe comparison
  const expected  = signPayload(body, WEBHOOK_SECRET);
  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expected);

  if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
    return { status: 401, body: { error: 'Invalid signature' } };
  }

  // 3. Require event type header
  const eventType = headers['x-github-event'];
  if (!eventType) {
    return { status: 400, body: { error: 'Missing x-github-event header' } };
  }

  // 4. Idempotency / replay-attack guard via x-github-delivery
  const deliveryId = headers['x-github-delivery'];
  if (deliveryId) {
    if (hasDelivery(deliveryId)) {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    recordDelivery(deliveryId);
  }

  // 5. Parse body
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { status: 400, body: { error: 'Invalid JSON body' } };
  }

  // 6. Route to the correct processor
  switch (eventType) {
    case 'push':         await mockProcessPush(payload); break;
    case 'pull_request': await mockProcessPR(payload);   break;
    case 'ping':         await mockProcessPing(payload); break;
    default:
      return { status: 200, body: { received: true, processed: false } };
  }

  return { status: 200, body: { received: true, processed: true } };
}

// ── Test helper ───────────────────────────────────────────────────────────────

function makeRequest(
  payload: object,
  overrides: { secret?: string; signature?: string | null; event?: string; deliveryId?: string } = {}
) {
  const body = JSON.stringify(payload);
  const sig  =
    overrides.signature !== undefined
      ? overrides.signature ?? undefined
      : signPayload(body, overrides.secret ?? WEBHOOK_SECRET);

  return {
    body,
    headers: {
      'content-type': 'application/json',
      ...(sig != null          ? { 'x-hub-signature-256': sig }          : {}),
      ...(overrides.event      ? { 'x-github-event': overrides.event }   : {}),
      ...(overrides.deliveryId ? { 'x-github-delivery': overrides.deliveryId } : {}),
    } as Record<string, string | undefined>,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  clearDeliveryStore();
});

// ── 1. Signature Validation ───────────────────────────────────────────────────

describe('Signature Validation', () => {
  it('accepts a request with a valid x-hub-signature-256 header', async () => {
    const res = await handleGitHubWebhook(makeRequest(pushPayload, { event: 'push', deliveryId: 'del-1' }));
    expect(res.status).toBe(200);
  });

  it('rejects a request with no signature header (401)', async () => {
    const res = await handleGitHubWebhook(makeRequest(pushPayload, { signature: null, event: 'push' }));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Missing x-hub-signature-256 header');
  });

  it('rejects a request with a tampered signature (401)', async () => {
    const req = makeRequest(pushPayload, { event: 'push' });
    req.headers['x-hub-signature-256'] = 'sha256=deadbeefdeadbeefdeadbeefdeadbeef';
    const res = await handleGitHubWebhook(req);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('rejects a request signed with the wrong secret (401)', async () => {
    const res = await handleGitHubWebhook(makeRequest(pushPayload, { secret: 'wrong-secret', event: 'push' }));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('rejects when the body is modified after signing (401)', async () => {
    const req = makeRequest(pushPayload, { event: 'push' });
    req.body = JSON.stringify({ ...pushPayload, ref: 'refs/heads/evil' });
    const res = await handleGitHubWebhook(req);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid signature');
  });

  it('rejects a signature with wrong length (timing-safe length check)', async () => {
    const req = makeRequest(pushPayload, { event: 'push' });
    req.headers['x-hub-signature-256'] = 'sha256=tooshort';
    const res = await handleGitHubWebhook(req);
    expect(res.status).toBe(401);
  });
});

// ── 2. Event Routing ──────────────────────────────────────────────────────────

describe('Event Routing', () => {
  it('routes push events to the push processor', async () => {
    const res = await handleGitHubWebhook(makeRequest(pushPayload, { event: 'push', deliveryId: 'del-push' }));
    expect(res.status).toBe(200);
    expect(mockProcessPush).toHaveBeenCalledOnce();
    expect(mockProcessPush).toHaveBeenCalledWith(pushPayload);
  });

  it('routes pull_request events to the PR processor', async () => {
    const res = await handleGitHubWebhook(makeRequest(prPayload, { event: 'pull_request', deliveryId: 'del-pr' }));
    expect(res.status).toBe(200);
    expect(mockProcessPR).toHaveBeenCalledOnce();
    expect(mockProcessPR).toHaveBeenCalledWith(prPayload);
  });

  it('routes ping events to the ping processor', async () => {
    const res = await handleGitHubWebhook(makeRequest(pingPayload, { event: 'ping', deliveryId: 'del-ping' }));
    expect(res.status).toBe(200);
    expect(mockProcessPing).toHaveBeenCalledOnce();
  });

  it('acknowledges unknown event types without processing (200, processed: false)', async () => {
    const res = await handleGitHubWebhook(makeRequest(pushPayload, { event: 'deployment', deliveryId: 'del-dep' }));
    expect(res.status).toBe(200);
    expect(res.body.processed).toBe(false);
    expect(mockProcessPush).not.toHaveBeenCalled();
  });

  it('returns 400 when x-github-event header is missing', async () => {
    const body = JSON.stringify(pushPayload);
    const res  = await handleGitHubWebhook({ body, headers: { 'x-hub-signature-256': signPayload(body) } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing x-github-event header');
  });

  it.each(['push', 'pull_request', 'ping'])(
    'correctly identifies the "%s" event type from the header',
    async (eventType) => {
      const payload = eventType === 'pull_request' ? prPayload : eventType === 'ping' ? pingPayload : pushPayload;
      const res = await handleGitHubWebhook(makeRequest(payload, { event: eventType, deliveryId: `del-${eventType}` }));
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    }
  );
});

// ── 3. Replay Attack Prevention ───────────────────────────────────────────────

describe('Replay Attack Prevention', () => {
  it('processes a delivery ID the first time it is seen', async () => {
    const res = await handleGitHubWebhook(makeRequest(pushPayload, { event: 'push', deliveryId: 'unique-abc' }));
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBeUndefined();
    expect(mockProcessPush).toHaveBeenCalledOnce();
  });

  it('returns 200 no-op for a duplicate x-github-delivery ID', async () => {
    const req = makeRequest(pushPayload, { event: 'push', deliveryId: 'replay-xyz' });
    await handleGitHubWebhook(req);
    vi.clearAllMocks();
    const res = await handleGitHubWebhook(req);
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(mockProcessPush).not.toHaveBeenCalled();
  });

  it('processes different delivery IDs independently', async () => {
    await handleGitHubWebhook(makeRequest(pushPayload, { event: 'push', deliveryId: 'del-001' }));
    await handleGitHubWebhook(makeRequest(pushPayload, { event: 'push', deliveryId: 'del-002' }));
    expect(mockProcessPush).toHaveBeenCalledTimes(2);
  });

  it('does not block requests that omit the delivery ID header', async () => {
    const res = await handleGitHubWebhook(makeRequest(pushPayload, { event: 'push' }));
    expect(res.status).toBe(200);
    expect(mockProcessPush).toHaveBeenCalledOnce();
  });
});

// ── 4. Idempotency & Retries ──────────────────────────────────────────────────

describe('Idempotency & Retries', () => {
  it('handles a GitHub retry without duplicate processing', async () => {
    const req    = makeRequest(pushPayload, { event: 'push', deliveryId: 'retry-del-1' });
    const first  = await handleGitHubWebhook(req);
    const second = await handleGitHubWebhook(req);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockProcessPush).toHaveBeenCalledOnce();
    expect(second.body.duplicate).toBe(true);
  });

  it('returns 200 on retry so GitHub stops retrying', async () => {
    const req   = makeRequest(prPayload, { event: 'pull_request', deliveryId: 'retry-del-2' });
    await handleGitHubWebhook(req);
    const retry = await handleGitHubWebhook(req);
    expect(retry.status).toBe(200);
  });

  it('processes a new event after a duplicate is detected', async () => {
    const req = makeRequest(pushPayload, { event: 'push', deliveryId: 'idem-del-1' });
    await handleGitHubWebhook(req);
    await handleGitHubWebhook(req);
    const newReq = makeRequest(pushPayload, { event: 'push', deliveryId: 'idem-del-2' });
    const res    = await handleGitHubWebhook(newReq);
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBeUndefined();
    expect(mockProcessPush).toHaveBeenCalledTimes(2);
  });

  it('does not call any processor when a duplicate is detected', async () => {
    const req = makeRequest(pingPayload, { event: 'ping', deliveryId: 'idem-del-3' });
    await handleGitHubWebhook(req);
    vi.clearAllMocks();
    await handleGitHubWebhook(req);
    expect(mockProcessPush).not.toHaveBeenCalled();
    expect(mockProcessPR).not.toHaveBeenCalled();
    expect(mockProcessPing).not.toHaveBeenCalled();
  });
});

// ── 5. Edge Cases ─────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('returns 400 for malformed JSON body with a valid signature', async () => {
    const body = 'not-valid-json';
    const res  = await handleGitHubWebhook({
      body,
      headers: {
        'x-hub-signature-256': signPayload(body),
        'x-github-event':      'push',
        'x-github-delivery':   'del-bad-json',
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid JSON body');
  });

  it('returns 400 for an empty body (fails JSON.parse)', async () => {
    const body = '';
    const res  = await handleGitHubWebhook({
      body,
      headers: {
        'x-hub-signature-256': signPayload(body),
        'x-github-event':      'ping',
        'x-github-delivery':   'del-empty',
      },
    });
    expect(res.status).toBe(400);
  });

  it('signPayload produces a sha256= prefixed HMAC hex string', () => {
    expect(signPayload('hello')).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('two different payloads produce different signatures', () => {
    expect(signPayload(JSON.stringify({ a: 1 }))).not.toBe(signPayload(JSON.stringify({ a: 2 })));
  });
});
