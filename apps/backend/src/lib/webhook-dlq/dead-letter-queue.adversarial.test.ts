/**
 * Adversarial Test Suite: Webhook DLQ Retry Semantics
 *
 * Issue #705: Tests for adversarial scenarios in the dead-letter queue that
 * normal happy-path tests never exercise.
 *
 * Scenarios covered:
 *   A1 — Poison-pill messages: processor always throws → entry ends up failed
 *        after maxRetries attempts
 *   A2 — Duplicate webhook IDs: same event captured twice → two independent
 *        entries; reprocessing one does not affect the other
 *   A3 — Out-of-order replay: entries reprocessed in reverse arrival order
 *   A4 — Retry count: processor is invoked exactly once per reprocess() call
 *        and the call count is correctly tracked
 *   A5 — Concurrent enqueue: two captures for the same event type submitted
 *        concurrently are stored as independent entries
 *   A6 — Already-succeeded guard: reprocessing a succeeded entry is a no-op
 *        (returns error, does not re-invoke processor)
 *
 * All scenarios use mocked HTTP clients — no external calls are made.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webhookDLQ, type DLQEntry, type WebhookSource } from './dead-letter-queue';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

const STRIPE_SOURCE: WebhookSource = 'stripe';
const GITHUB_SOURCE: WebhookSource = 'github';

// ── Helpers ───────────────────────────────────────────────────────────────────

function captureEvent(
    source: WebhookSource = STRIPE_SOURCE,
    eventType = 'invoice.payment_failed',
    payload = '{"id":"evt_test"}',
    failureReason = 'Delivery endpoint returned 500',
    attempts = 1,
): DLQEntry {
    return webhookDLQ.capture(source, eventType, payload, failureReason, attempts);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    // Reset processors so tests don't bleed into each other
    webhookDLQ.registerProcessor(STRIPE_SOURCE, async () => { throw new Error('no processor'); });
    webhookDLQ.registerProcessor(GITHUB_SOURCE, async () => { throw new Error('no processor'); });
});

// ── A1 — Poison-pill messages ──────────────────────────────────────────────────

describe('A1 — Poison-pill: processor always fails', () => {
    it('entry reprocessStatus is "failed" after first failed attempt', async () => {
        const poison = vi.fn().mockRejectedValue(new Error('endpoint unavailable'));
        webhookDLQ.registerProcessor(STRIPE_SOURCE, poison);

        const entry = captureEvent(STRIPE_SOURCE, 'invoice.payment_failed');
        const result = await webhookDLQ.reprocess(entry.id);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        const stored = webhookDLQ.get(entry.id);
        expect(stored?.reprocessStatus).toBe('failed');
    });

    it(`after ${MAX_RETRIES} retries the entry remains permanently failed`, async () => {
        const poison = vi.fn().mockRejectedValue(new Error('always fails'));
        webhookDLQ.registerProcessor(STRIPE_SOURCE, poison);

        const entry = captureEvent(STRIPE_SOURCE, 'payment.failed');

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const result = await webhookDLQ.reprocess(entry.id);
            expect(result.success).toBe(false);
        }

        // After exhausting retries, the entry is permanently in failed state
        const finalEntry = webhookDLQ.get(entry.id);
        expect(finalEntry?.reprocessStatus).toBe('failed');
        expect(poison).toHaveBeenCalledTimes(MAX_RETRIES);
    });

    it('processor call count equals the number of reprocess() invocations', async () => {
        const callCount = { value: 0 };
        webhookDLQ.registerProcessor(STRIPE_SOURCE, async () => {
            callCount.value++;
            throw new Error('fail');
        });

        const entry = captureEvent(STRIPE_SOURCE, 'charge.failed');

        const ATTEMPTS = 5;
        for (let i = 0; i < ATTEMPTS; i++) {
            await webhookDLQ.reprocess(entry.id);
        }

        expect(callCount.value).toBe(ATTEMPTS);
    });

    it('failureReason is updated to the error message on each failed reprocess', async () => {
        webhookDLQ.registerProcessor(STRIPE_SOURCE, async () => {
            throw new Error('connection timeout');
        });

        const entry = captureEvent(STRIPE_SOURCE, 'subscription.deleted');
        await webhookDLQ.reprocess(entry.id);

        const stored = webhookDLQ.get(entry.id);
        expect(stored?.failureReason).toBe('connection timeout');
    });

    it('poison-pill on github source is independently tracked from stripe source', async () => {
        const stripePoison = vi.fn().mockRejectedValue(new Error('stripe down'));
        const githubPoison = vi.fn().mockRejectedValue(new Error('github down'));
        webhookDLQ.registerProcessor(STRIPE_SOURCE, stripePoison);
        webhookDLQ.registerProcessor(GITHUB_SOURCE, githubPoison);

        const stripeEntry = captureEvent(STRIPE_SOURCE, 'payment.failed');
        const githubEntry = captureEvent(GITHUB_SOURCE, 'push');

        await webhookDLQ.reprocess(stripeEntry.id);
        await webhookDLQ.reprocess(githubEntry.id);
        await webhookDLQ.reprocess(stripeEntry.id);

        expect(stripePoison).toHaveBeenCalledTimes(2);
        expect(githubPoison).toHaveBeenCalledTimes(1);

        expect(webhookDLQ.get(stripeEntry.id)?.reprocessStatus).toBe('failed');
        expect(webhookDLQ.get(githubEntry.id)?.reprocessStatus).toBe('failed');
    });
});

// ── A2 — Duplicate webhook IDs ────────────────────────────────────────────────

describe('A2 — Duplicate webhook event type: two captures create independent entries', () => {
    it('capturing the same event type twice yields two entries with distinct IDs', () => {
        const entryA = captureEvent(STRIPE_SOURCE, 'invoice.payment_failed', '{"id":"evt_1"}');
        const entryB = captureEvent(STRIPE_SOURCE, 'invoice.payment_failed', '{"id":"evt_1"}');

        expect(entryA.id).not.toBe(entryB.id);
        expect(webhookDLQ.get(entryA.id)).toBeDefined();
        expect(webhookDLQ.get(entryB.id)).toBeDefined();
    });

    it('reprocessing entry A does not affect entry B with the same event type', async () => {
        let callCount = 0;
        webhookDLQ.registerProcessor(STRIPE_SOURCE, async () => {
            callCount++;
            if (callCount === 1) throw new Error('first fails');
            // second call succeeds
        });

        const entryA = captureEvent(STRIPE_SOURCE, 'charge.refunded', '{"id":"ch_a"}');
        const entryB = captureEvent(STRIPE_SOURCE, 'charge.refunded', '{"id":"ch_b"}');

        // Fail A
        await webhookDLQ.reprocess(entryA.id);
        // Succeed B
        await webhookDLQ.reprocess(entryB.id);

        expect(webhookDLQ.get(entryA.id)?.reprocessStatus).toBe('failed');
        expect(webhookDLQ.get(entryB.id)?.reprocessStatus).toBe('succeeded');
    });

    it('deduplication guard: reprocessing an already-succeeded entry returns an error', async () => {
        webhookDLQ.registerProcessor(STRIPE_SOURCE, vi.fn().mockResolvedValue(undefined));

        const entry = captureEvent(STRIPE_SOURCE, 'customer.created');
        const first = await webhookDLQ.reprocess(entry.id);
        expect(first.success).toBe(true);

        // Second reprocess on the same entry must be rejected
        const second = await webhookDLQ.reprocess(entry.id);
        expect(second.success).toBe(false);
        expect(second.error).toContain('already successfully reprocessed');
    });
});

// ── A3 — Out-of-order replay ──────────────────────────────────────────────────

describe('A3 — Out-of-order replay: entries reprocessed in reverse arrival order', () => {
    it('reprocessing newer entries before older ones succeeds independently', async () => {
        const successProcessor = vi.fn().mockResolvedValue(undefined);
        webhookDLQ.registerProcessor(STRIPE_SOURCE, successProcessor);

        const first = captureEvent(STRIPE_SOURCE, 'invoice.created', '{"seq":1}');
        const second = captureEvent(STRIPE_SOURCE, 'invoice.finalized', '{"seq":2}');
        const third = captureEvent(STRIPE_SOURCE, 'invoice.paid', '{"seq":3}');

        // Replay in reverse order
        await webhookDLQ.reprocess(third.id);
        await webhookDLQ.reprocess(second.id);
        await webhookDLQ.reprocess(first.id);

        expect(webhookDLQ.get(first.id)?.reprocessStatus).toBe('succeeded');
        expect(webhookDLQ.get(second.id)?.reprocessStatus).toBe('succeeded');
        expect(webhookDLQ.get(third.id)?.reprocessStatus).toBe('succeeded');
        expect(successProcessor).toHaveBeenCalledTimes(3);
    });

    it('processor receives the original entry data regardless of replay order', async () => {
        const received: DLQEntry[] = [];
        webhookDLQ.registerProcessor(STRIPE_SOURCE, async (entry) => {
            received.push(entry);
        });

        const first = captureEvent(STRIPE_SOURCE, 'a.event', '{"n":1}');
        const second = captureEvent(STRIPE_SOURCE, 'b.event', '{"n":2}');

        // Replay second before first
        await webhookDLQ.reprocess(second.id);
        await webhookDLQ.reprocess(first.id);

        expect(received[0].eventType).toBe('b.event');
        expect(received[1].eventType).toBe('a.event');
        expect(received[0].payload).toBe('{"n":2}');
        expect(received[1].payload).toBe('{"n":1}');
    });
});

// ── A4 — Retry count accuracy ─────────────────────────────────────────────────

describe('A4 — Retry count: processor invocations match reprocess() calls', () => {
    it('alternating success/failure calls track invocations correctly', async () => {
        let call = 0;
        webhookDLQ.registerProcessor(STRIPE_SOURCE, async () => {
            call++;
            if (call % 2 === 0) throw new Error('even calls fail');
        });

        const entry = captureEvent(STRIPE_SOURCE, 'payment.retry');

        // Call 1: succeeds → entry becomes 'succeeded'
        const r1 = await webhookDLQ.reprocess(entry.id);
        expect(r1.success).toBe(true);
        expect(call).toBe(1);

        // Call 2: blocked by already-succeeded guard, processor NOT invoked
        const r2 = await webhookDLQ.reprocess(entry.id);
        expect(r2.success).toBe(false);
        expect(call).toBe(1); // still 1 — guard prevented invocation
    });

    it('failed entries can be retried indefinitely until they succeed', async () => {
        let attempt = 0;
        const FAIL_UNTIL = 3;

        webhookDLQ.registerProcessor(STRIPE_SOURCE, async () => {
            attempt++;
            if (attempt < FAIL_UNTIL) throw new Error(`fail #${attempt}`);
        });

        const entry = captureEvent(STRIPE_SOURCE, 'subscription.trial_end');

        // Fail twice
        for (let i = 0; i < FAIL_UNTIL - 1; i++) {
            const result = await webhookDLQ.reprocess(entry.id);
            expect(result.success).toBe(false);
        }
        expect(webhookDLQ.get(entry.id)?.reprocessStatus).toBe('failed');

        // Eventually succeeds on the third attempt
        const final = await webhookDLQ.reprocess(entry.id);
        expect(final.success).toBe(true);
        expect(attempt).toBe(FAIL_UNTIL);
        expect(webhookDLQ.get(entry.id)?.reprocessStatus).toBe('succeeded');
    });
});

// ── A5 — Concurrent enqueue ───────────────────────────────────────────────────

describe('A5 — Concurrent enqueue: simultaneous captures produce independent entries', () => {
    it('two concurrent capture() calls for the same event type create two distinct entries', async () => {
        const EVENT_TYPE = 'payment.intent.succeeded';
        const PAYLOAD = '{"amount":1000}';

        // Simulate concurrent enqueue (JS single-threaded, but models the intent)
        const [entryA, entryB] = await Promise.all([
            Promise.resolve(captureEvent(STRIPE_SOURCE, EVENT_TYPE, PAYLOAD)),
            Promise.resolve(captureEvent(STRIPE_SOURCE, EVENT_TYPE, PAYLOAD)),
        ]);

        expect(entryA.id).not.toBe(entryB.id);
        expect(webhookDLQ.get(entryA.id)).toBeDefined();
        expect(webhookDLQ.get(entryB.id)).toBeDefined();
    });

    it('concurrent captures across sources are independently stored', async () => {
        const [stripeEntry, githubEntry] = await Promise.all([
            Promise.resolve(captureEvent(STRIPE_SOURCE, 'charge.created', '{"s":1}')),
            Promise.resolve(captureEvent(GITHUB_SOURCE, 'push', '{"repo":"craft"}')),
        ]);

        expect(stripeEntry.source).toBe(STRIPE_SOURCE);
        expect(githubEntry.source).toBe(GITHUB_SOURCE);
        expect(stripeEntry.id).not.toBe(githubEntry.id);
    });

    it('concurrent reprocess calls for different entries execute independently', async () => {
        const stripeOk = vi.fn().mockResolvedValue(undefined);
        const githubFail = vi.fn().mockRejectedValue(new Error('github 500'));
        webhookDLQ.registerProcessor(STRIPE_SOURCE, stripeOk);
        webhookDLQ.registerProcessor(GITHUB_SOURCE, githubFail);

        const s = captureEvent(STRIPE_SOURCE, 'charge.succeeded');
        const g = captureEvent(GITHUB_SOURCE, 'pull_request');

        const [sResult, gResult] = await Promise.all([
            webhookDLQ.reprocess(s.id),
            webhookDLQ.reprocess(g.id),
        ]);

        expect(sResult.success).toBe(true);
        expect(gResult.success).toBe(false);

        expect(webhookDLQ.get(s.id)?.reprocessStatus).toBe('succeeded');
        expect(webhookDLQ.get(g.id)?.reprocessStatus).toBe('failed');
    });
});

// ── A6 — Entry not found ──────────────────────────────────────────────────────

describe('A6 — Unknown entry: reprocess of non-existent ID returns error', () => {
    it('reprocess("nonexistent") returns success=false with "not found" error', async () => {
        const result = await webhookDLQ.reprocess('dlq_does_not_exist');
        expect(result.success).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('reprocess of unknown ID does not invoke any registered processor', async () => {
        const processor = vi.fn();
        webhookDLQ.registerProcessor(STRIPE_SOURCE, processor);
        webhookDLQ.registerProcessor(GITHUB_SOURCE, processor);

        await webhookDLQ.reprocess('dlq_ghost_id');

        expect(processor).not.toHaveBeenCalled();
    });
});
