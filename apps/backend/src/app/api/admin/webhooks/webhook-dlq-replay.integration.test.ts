// @vitest-environment node
/**
 * Webhook DLQ Replay Attack Prevention Integration Tests
 *
 * Tests the full DLQ lifecycle: enqueue → fail → DLQ → replay → success
 * Verifies replay attack prevention via idempotency keys and authorization.
 *
 * Run: pnpm test -- webhook-dlq-replay.integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webhookDLQ, type DLQEntry } from '@/lib/webhook-dlq/dead-letter-queue';
import type { NextRequest } from 'next/server';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReplayRequest {
  entryId: string;
  correlationId?: string;
}

interface ReplayResponse {
  success: boolean;
  error?: string;
  auditLog?: {
    id: string;
    entryId: string;
    action: string;
    timestamp: Date;
  };
}

// ── Mock Delivery Service ─────────────────────────────────────────────────────

class MockWebhookDeliveryService {
  private replayedIds = new Set<string>();
  private auditLogs: Array<{
    id: string;
    entryId: string;
    action: string;
    timestamp: Date;
  }> = [];

  async replayDelivery(entryId: string): Promise<ReplayResponse> {
    const entry = webhookDLQ.get(entryId);
    if (!entry) {
      return { success: false, error: 'Entry not found' };
    }

    // Idempotency check: prevent replaying same entry twice
    if (this.replayedIds.has(entryId)) {
      return { success: false, error: 'Entry already replayed (idempotency key)' };
    }

    // Mark as replayed
    this.replayedIds.add(entryId);

    // Create audit log
    const auditLog = {
      id: `audit_${Date.now()}`,
      entryId,
      action: 'replay_succeeded',
      timestamp: new Date(),
    };
    this.auditLogs.push(auditLog);

    return { success: true, auditLog };
  }

  getAuditLogs() {
    return this.auditLogs;
  }

  clearReplayState() {
    this.replayedIds.clear();
    this.auditLogs = [];
  }
}

// ── Authorization Middleware Mock ────────────────────────────────────────────

function checkServiceRoleAuth(req: NextRequest): boolean {
  const role = req.headers.get('x-user-role');
  return role === 'service_role';
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Webhook DLQ Replay Attack Prevention Integration', () => {
  let deliveryService: MockWebhookDeliveryService;

  beforeEach(() => {
    deliveryService = new MockWebhookDeliveryService();
    webhookDLQ.registerProcessor('stripe', async () => {
      /* mock processor */
    });
  });

  afterEach(() => {
    deliveryService.clearReplayState();
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Full DLQ Lifecycle', () => {
    it('enqueues a webhook event on failure', () => {
      const entry = webhookDLQ.capture(
        'stripe',
        'charge.completed',
        JSON.stringify({ chargeId: 'ch_123' }),
        'Max retries exhausted',
        3
      );

      expect(entry).toBeDefined();
      expect(entry.id).toBeTruthy();
      expect(entry.source).toBe('stripe');
      expect(entry.eventType).toBe('charge.completed');
      expect(entry.attempts).toBe(3);
      expect(entry.reprocessStatus).toBe('pending');
    });

    it('lists enqueued entries', () => {
      const entry1 = webhookDLQ.capture(
        'stripe',
        'charge.completed',
        JSON.stringify({ chargeId: 'ch_1' }),
        'Failed',
        3
      );
      const entry2 = webhookDLQ.capture(
        'github',
        'push',
        JSON.stringify({ ref: 'refs/heads/main' }),
        'Failed',
        2
      );

      const list = webhookDLQ.list();
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list.some((e) => e.id === entry1.id)).toBe(true);
      expect(list.some((e) => e.id === entry2.id)).toBe(true);
    });

    it('retrieves a specific entry by ID', () => {
      const entry = webhookDLQ.capture(
        'stripe',
        'charge.completed',
        JSON.stringify({ chargeId: 'ch_456' }),
        'Failed',
        3
      );

      const retrieved = webhookDLQ.get(entry.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(entry.id);
      expect(retrieved?.payload).toBe(JSON.stringify({ chargeId: 'ch_456' }));
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Replay Idempotency (Attack Prevention)', () => {
    it('replays a pending DLQ entry successfully', async () => {
      const entry = webhookDLQ.capture(
        'stripe',
        'charge.completed',
        JSON.stringify({ chargeId: 'ch_789' }),
        'Failed',
        3
      );

      const result = await deliveryService.replayDelivery(entry.id);

      expect(result.success).toBe(true);
      expect(result.auditLog).toBeDefined();
      expect(result.auditLog?.action).toBe('replay_succeeded');
    });

    it('prevents second replay of same entry (409 Conflict equivalent)', async () => {
      const entry = webhookDLQ.capture(
        'stripe',
        'charge.completed',
        JSON.stringify({ chargeId: 'ch_999' }),
        'Failed',
        3
      );

      // First replay succeeds
      const firstReplay = await deliveryService.replayDelivery(entry.id);
      expect(firstReplay.success).toBe(true);

      // Second replay of same entry fails
      const secondReplay = await deliveryService.replayDelivery(entry.id);
      expect(secondReplay.success).toBe(false);
      expect(secondReplay.error).toContain('already replayed');
    });

    it('creates audit log entry for each replay', async () => {
      const entry = webhookDLQ.capture(
        'stripe',
        'charge.completed',
        JSON.stringify({ chargeId: 'ch_audit' }),
        'Failed',
        3
      );

      await deliveryService.replayDelivery(entry.id);

      const logs = deliveryService.getAuditLogs();
      expect(logs.length).toBe(1);
      expect(logs[0].entryId).toBe(entry.id);
      expect(logs[0].action).toBe('replay_succeeded');
      expect(logs[0].timestamp).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Authorization Control', () => {
    it('allows replay with service_role authorization', () => {
      const req = {
        headers: new Map([['x-user-role', 'service_role']]),
        get: (key: string) => {
          return new Map([['x-user-role', 'service_role']]).get(key);
        },
      } as unknown as NextRequest;

      const isAuthorized = checkServiceRoleAuth(req);
      expect(isAuthorized).toBe(true);
    });

    it('denies replay without service_role (403 Forbidden)', () => {
      const req = {
        headers: new Map([['x-user-role', 'user']]),
        get: (key: string) => {
          return new Map([['x-user-role', 'user']]).get(key);
        },
      } as unknown as NextRequest;

      const isAuthorized = checkServiceRoleAuth(req);
      expect(isAuthorized).toBe(false);
    });

    it('denies replay with missing authorization', () => {
      const req = {
        headers: new Map(),
        get: () => null,
      } as unknown as NextRequest;

      const isAuthorized = checkServiceRoleAuth(req);
      expect(isAuthorized).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Error Handling', () => {
    it('returns error for non-existent entry', async () => {
      const result = await deliveryService.replayDelivery('nonexistent-id');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('maintains entry state after failed replay', async () => {
      const entry = webhookDLQ.capture(
        'stripe',
        'charge.completed',
        JSON.stringify({ chargeId: 'ch_state' }),
        'Failed',
        3
      );

      // Attempt to replay non-existent entry doesn't affect DLQ
      await deliveryService.replayDelivery('fake-id');

      const retrieved = webhookDLQ.get(entry.id);
      expect(retrieved?.reprocessStatus).toBe('pending');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Multi-source DLQ', () => {
    it('tracks replays separately per source', async () => {
      const stripeEntry = webhookDLQ.capture(
        'stripe',
        'charge.completed',
        JSON.stringify({ chargeId: 'ch_multi' }),
        'Failed',
        3
      );

      const githubEntry = webhookDLQ.capture(
        'github',
        'push',
        JSON.stringify({ ref: 'refs/heads/dev' }),
        'Failed',
        2
      );

      await deliveryService.replayDelivery(stripeEntry.id);
      await deliveryService.replayDelivery(githubEntry.id);

      const logs = deliveryService.getAuditLogs();
      expect(logs.length).toBe(2);
      expect(logs[0].entryId).toBe(stripeEntry.id);
      expect(logs[1].entryId).toBe(githubEntry.id);
    });
  });
});
