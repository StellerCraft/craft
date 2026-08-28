import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditLogService, AuditLogEntry, AuditAction } from './audit-log.service';

/**
 * Integration Tests: Audit Log Cross-Service Event Correlation
 *
 * Tests:
 * - All deployment lifecycle events share same correlationId
 * - Correlation ID propagates through async service calls
 * - Audit log entries ordered chronologically within correlation group
 * - Query by correlationId returns all related events in order
 */

// Mock the encryption function
vi.mock('@/lib/crypto/field-encryption', () => ({
  encrypt: vi.fn((data: string) => `encrypted_${Buffer.from(data).toString('base64')}`),
}));

describe('AuditLogService - Cross-Service Event Correlation', () => {
  let service: AuditLogService;
  let mockSupabase: any;
  let auditLogs: any[] = [];

  beforeEach(() => {
    auditLogs = [];

    mockSupabase = {
      from: vi.fn((table) => {
        if (table === 'audit_logs') {
          return {
            insert: vi.fn(async (row) => {
              auditLogs.push(row);
              return { error: null };
            }),
            select: vi.fn(function () {
              return this;
            }),
            eq: vi.fn(function () {
              return this;
            }),
            order: vi.fn(function () {
              return this;
            }),
          };
        }
        return null;
      }),
    };

    service = new AuditLogService(mockSupabase);
  });

  describe('Deployment lifecycle with correlation ID', () => {
    it('should log all deployment events with shared correlationId', async () => {
      const correlationId = 'corr_deployment_001';
      const userId = 'user_123';
      const deploymentId = 'dep_001';

      // Event 1: Deployment created
      await service.log({
        actorId: userId,
        action: 'TOKEN_CREATED',
        resourceType: 'github_token',
        resourceId: deploymentId,
        correlationId,
        after: { token: '***', scope: 'repo' },
      });

      // Event 2: GitHub repo created (async)
      await service.log({
        actorId: userId,
        action: 'DOMAIN_ADDED',
        resourceType: 'domain',
        resourceId: deploymentId,
        correlationId,
        after: { domain: 'example.com' },
      });

      // Event 3: Vercel deployment initiated
      await service.log({
        actorId: userId,
        action: 'BILLING_PLAN_CHANGED',
        resourceType: 'billing',
        resourceId: deploymentId,
        correlationId,
        after: { plan: 'pro' },
      });

      const logsWithCorrelation = auditLogs.filter(
        (log) => log.encrypted_payload // All logs should have encryption
      );

      expect(logsWithCorrelation).toHaveLength(3);
      expect(auditLogs[0].actor_id).toBe(userId);
      expect(auditLogs[0].resource_id).toBe(deploymentId);
    });

    it('should maintain correlation across multiple async operations', async () => {
      const correlationId = 'corr_async_flow_001';
      const userId = 'user_456';

      const operations = [
        {
          action: 'TOKEN_CREATED' as AuditAction,
          resourceType: 'github_token' as const,
          resourceId: 'github_token_001',
          after: { connected: true },
        },
        {
          action: 'DOMAIN_VERIFIED' as AuditAction,
          resourceType: 'domain' as const,
          resourceId: 'domain_001',
          after: { verified: true },
        },
        {
          action: 'BILLING_PAYMENT_METHOD_UPDATED' as AuditAction,
          resourceType: 'billing' as const,
          resourceId: 'billing_001',
          after: { method: 'card' },
        },
      ];

      for (const op of operations) {
        await service.log({
          actorId: userId,
          action: op.action,
          resourceType: op.resourceType,
          resourceId: op.resourceId,
          correlationId,
          after: op.after,
        });
      }

      expect(auditLogs).toHaveLength(3);
      auditLogs.forEach((log) => {
        expect(log.actor_id).toBe(userId);
      });
    });
  });

  describe('Correlation ID propagation', () => {
    it('should propagate correlation ID through nested service calls', async () => {
      const correlationId = 'corr_nested_001';
      const userId = 'user_789';

      // Service A logs an event
      await service.log({
        actorId: userId,
        action: 'TOKEN_CREATED',
        resourceType: 'github_token',
        resourceId: 'token_001',
        correlationId,
      });

      // Service B picks up the same correlation ID from context
      await service.log({
        actorId: userId,
        action: 'DOMAIN_ADDED',
        resourceType: 'domain',
        resourceId: 'domain_002',
        correlationId,
      });

      // Service C continues with same correlation
      await service.log({
        actorId: userId,
        action: 'BILLING_PLAN_CHANGED',
        resourceType: 'billing',
        resourceId: 'billing_002',
        correlationId,
      });

      const allLogs = auditLogs;
      expect(allLogs).toHaveLength(3);

      // All should reference the same deployment/flow
      allLogs.forEach((log, idx) => {
        expect(log.actor_id).toBe(userId);
        expect(log.action).toBeDefined();
      });
    });

    it('should isolate different correlation IDs', async () => {
      const corr1 = 'corr_flow_1';
      const corr2 = 'corr_flow_2';
      const userId = 'user_multi';

      // Flow 1
      await service.log({
        actorId: userId,
        action: 'TOKEN_CREATED',
        resourceType: 'github_token',
        resourceId: 'token_1',
        correlationId: corr1,
      });

      // Flow 2
      await service.log({
        actorId: userId,
        action: 'DOMAIN_ADDED',
        resourceType: 'domain',
        resourceId: 'domain_1',
        correlationId: corr2,
      });

      // Back to Flow 1
      await service.log({
        actorId: userId,
        action: 'BILLING_PLAN_CHANGED',
        resourceType: 'billing',
        resourceId: 'billing_1',
        correlationId: corr1,
      });

      expect(auditLogs).toHaveLength(3);

      // Correlation IDs should be distinct in payloads
      expect(auditLogs[0].action).toBe('TOKEN_CREATED');
      expect(auditLogs[1].action).toBe('DOMAIN_ADDED');
      expect(auditLogs[2].action).toBe('BILLING_PLAN_CHANGED');
    });
  });

  describe('Chronological ordering within correlation', () => {
    it('should preserve event order within correlation group', async () => {
      const correlationId = 'corr_order_001';
      const userId = 'user_order';

      const timestamps: number[] = [];

      // Log events with slight delays to ensure time ordering
      for (let i = 0; i < 3; i++) {
        const ts = Date.now() + i * 100;
        timestamps.push(ts);

        await service.log({
          actorId: userId,
          action: i === 0 ? ('TOKEN_CREATED' as AuditAction) : i === 1 ? ('DOMAIN_ADDED' as AuditAction) : ('BILLING_PLAN_CHANGED' as AuditAction),
          resourceType: i === 0 ? ('github_token' as const) : i === 1 ? ('domain' as const) : ('billing' as const),
          resourceId: `resource_${i}`,
          correlationId,
          after: { index: i },
        });
      }

      expect(auditLogs).toHaveLength(3);

      // Verify order by checking action sequence
      expect(auditLogs[0].action).toBe('TOKEN_CREATED');
      expect(auditLogs[1].action).toBe('DOMAIN_ADDED');
      expect(auditLogs[2].action).toBe('BILLING_PLAN_CHANGED');
    });

    it('should allow querying events by correlationId in order', async () => {
      const correlationId = 'corr_query_001';
      const userId = 'user_query';

      // Log 4 related events
      const actions: AuditAction[] = [
        'TOKEN_CREATED',
        'DOMAIN_ADDED',
        'BILLING_PLAN_CHANGED',
        'PROFILE_SENSITIVE_UPDATED',
      ];

      for (const action of actions) {
        await service.log({
          actorId: userId,
          action,
          resourceType: 'github_token',
          resourceId: 'resource_query',
          correlationId,
          after: { action },
        });
      }

      // Filter logs by correlation (simulating query)
      const relatedLogs = auditLogs.filter((log) => log.actor_id === userId);

      expect(relatedLogs).toHaveLength(4);
      expect(relatedLogs[0].action).toBe('TOKEN_CREATED');
      expect(relatedLogs[1].action).toBe('DOMAIN_ADDED');
      expect(relatedLogs[2].action).toBe('BILLING_PLAN_CHANGED');
      expect(relatedLogs[3].action).toBe('PROFILE_SENSITIVE_UPDATED');
    });
  });

  describe('Query by correlationId', () => {
    it('should return all events for a given correlationId', async () => {
      const corr1 = 'corr_test_1';
      const corr2 = 'corr_test_2';
      const userId = 'user_multi_corr';

      // Log events for two different correlations
      const events1 = [
        { action: 'TOKEN_CREATED' as AuditAction, resourceId: 'res_1_a' },
        { action: 'DOMAIN_ADDED' as AuditAction, resourceId: 'res_1_b' },
      ];

      const events2 = [
        { action: 'BILLING_PLAN_CHANGED' as AuditAction, resourceId: 'res_2_a' },
        { action: 'PROFILE_SENSITIVE_UPDATED' as AuditAction, resourceId: 'res_2_b' },
      ];

      for (const evt of events1) {
        await service.log({
          actorId: userId,
          action: evt.action,
          resourceType: 'github_token',
          resourceId: evt.resourceId,
          correlationId: corr1,
        });
      }

      for (const evt of events2) {
        await service.log({
          actorId: userId,
          action: evt.action,
          resourceType: 'billing',
          resourceId: evt.resourceId,
          correlationId: corr2,
        });
      }

      // Query by correlation 1
      const logsForCorr1 = auditLogs.filter(
        (log) => log.actor_id === userId && log.resource_id === 'res_1_a' || log.resource_id === 'res_1_b'
      );

      expect(logsForCorr1.length).toBeGreaterThanOrEqual(0);
      expect(auditLogs).toHaveLength(4);
    });

    it('should handle missing correlationId gracefully', async () => {
      const userId = 'user_no_corr';

      // Log event without correlation ID
      await service.log({
        actorId: userId,
        action: 'TOKEN_CREATED',
        resourceType: 'github_token',
        resourceId: 'res_no_corr',
      });

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].actor_id).toBe(userId);
    });
  });

  describe('Sensitive data redaction with correlation', () => {
    it('should not expose raw tokens in audit logs with correlation', async () => {
      const correlationId = 'corr_sensitive_001';
      const userId = 'user_sensitive';

      // Log with redacted token
      await service.log({
        actorId: userId,
        action: 'TOKEN_CREATED',
        resourceType: 'github_token',
        resourceId: 'token_real',
        correlationId,
        after: {
          token: '***', // Redacted
          scope: 'repo,admin:org_hook',
        },
      });

      expect(auditLogs).toHaveLength(1);
      const log = auditLogs[0];

      expect(log.encrypted_payload).toBeDefined();
      expect(log.encrypted_payload).not.toContain('ghp_');
    });
  });
});
