import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AuditLogService,
  createAuditLogService,
  AuditLogEntry,
  AuditAction,
  AuditResourceType,
} from './audit-log.service';
import { decrypt, encrypt } from '@/lib/crypto/field-encryption';

// Mock field-encryption module
vi.mock('@/lib/crypto/field-encryption', () => ({
  encrypt: vi.fn((data: string) => `encrypted_${Buffer.from(data).toString('base64')}`),
  decrypt: vi.fn((data: string) => {
    if (!data.startsWith('encrypted_')) {
      throw new Error('Invalid encrypted field format');
    }
    return Buffer.from(data.slice('encrypted_'.length), 'base64').toString('utf8');
  }),
}));

interface MockStoredRow {
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  encrypted_payload: string;
  created_at: string;
}

describe('AuditLogService', () => {
  let storedRows: MockStoredRow[];
  let insertError: { message: string } | null;
  let mockSupabase: any;
  let service: AuditLogService;

  beforeEach(() => {
    storedRows = [];
    insertError = null;
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn((table: string) => {
        if (table !== 'audit_logs') {
          throw new Error(`Unexpected table: ${table}`);
        }

        return {
          insert: vi.fn(async (row: MockStoredRow) => {
            if (insertError) {
              return { data: null, error: insertError };
            }
            storedRows.push(row);
            return { data: [row], error: null };
          }),
          select: vi.fn(() => {
            let filtered = [...storedRows];
            const queryBuilder = {
              eq: vi.fn((column: keyof MockStoredRow, value: any) => {
                filtered = filtered.filter((r) => r[column] === value);
                return queryBuilder;
              }),
              in: vi.fn((column: keyof MockStoredRow, values: any[]) => {
                filtered = filtered.filter((r) => values.includes(r[column]));
                return queryBuilder;
              }),
              order: vi.fn((column: keyof MockStoredRow, { ascending = true } = {}) => {
                filtered.sort((a, b) => {
                  if (a[column] < b[column]) return ascending ? -1 : 1;
                  if (a[column] > b[column]) return ascending ? 1 : -1;
                  return 0;
                });
                return queryBuilder;
              }),
              then: (resolve: (result: { data: MockStoredRow[]; error: null }) => void) => {
                return Promise.resolve({ data: filtered, error: null }).then(resolve);
              },
            };
            return queryBuilder;
          }),
        };
      }),
    };

    service = new AuditLogService(mockSupabase);
  });

  describe('createAuditLogService factory', () => {
    it('creates and returns an AuditLogService instance', () => {
      const factoryService = createAuditLogService(mockSupabase);
      expect(factoryService).toBeInstanceOf(AuditLogService);
    });
  });

  describe('write path (log)', () => {
    it('persists a complete audit log entry with encrypted payload', async () => {
      const entry: AuditLogEntry = {
        actorId: 'user_123',
        action: 'TOKEN_CREATED',
        resourceType: 'github_token',
        resourceId: 'token_abc',
        before: { active: false },
        after: { active: true, scope: 'repo' },
        correlationId: 'corr_test_001',
      };

      await service.log(entry);

      expect(mockSupabase.from).toHaveBeenCalledWith('audit_logs');
      expect(storedRows).toHaveLength(1);

      const savedRow = storedRows[0];
      expect(savedRow.actor_id).toBe('user_123');
      expect(savedRow.action).toBe('TOKEN_CREATED');
      expect(savedRow.resource_type).toBe('github_token');
      expect(savedRow.resource_id).toBe('token_abc');
      expect(typeof savedRow.created_at).toBe('string');
      expect(new Date(savedRow.created_at).toISOString()).toBe(savedRow.created_at);

      // Verify payload encryption
      expect(encrypt).toHaveBeenCalled();
      const decrypted = JSON.parse(decrypt(savedRow.encrypted_payload));
      expect(decrypted).toEqual({
        before: { active: false },
        after: { active: true, scope: 'repo' },
        correlationId: 'corr_test_001',
      });
    });

    it('handles optional fields by storing null in encrypted payload', async () => {
      const minimalEntry: AuditLogEntry = {
        actorId: 'user_minimal',
        action: 'DOMAIN_REMOVED',
        resourceType: 'domain',
        resourceId: 'dom_xyz',
      };

      await service.log(minimalEntry);

      expect(storedRows).toHaveLength(1);
      const decrypted = JSON.parse(decrypt(storedRows[0].encrypted_payload));
      expect(decrypted).toEqual({
        before: null,
        after: null,
        correlationId: null,
      });
    });

    it('gracefully handles database insert errors without throwing to the caller', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      insertError = { message: 'Database connection failed' };

      const entry: AuditLogEntry = {
        actorId: 'user_fail',
        action: 'BILLING_PLAN_CHANGED',
        resourceType: 'billing',
        resourceId: 'sub_123',
      };

      await expect(service.log(entry)).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[audit-log] Failed to persist audit entry',
        expect.objectContaining({
          action: 'BILLING_PLAN_CHANGED',
          actorId: 'user_fail',
          error: 'Database connection failed',
        }),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('query/filter paths and correlation-ID propagation', () => {
    beforeEach(async () => {
      // Seed audit entries for multi-filter and correlation querying
      const entries: AuditLogEntry[] = [
        {
          actorId: 'user_A',
          action: 'TOKEN_CREATED',
          resourceType: 'github_token',
          resourceId: 'token_1',
          before: null as any,
          after: { name: 'Deploy Key 1' },
          correlationId: 'corr_A_1',
        },
        {
          actorId: 'user_A',
          action: 'DOMAIN_ADDED',
          resourceType: 'domain',
          resourceId: 'dom_1',
          after: { domain: 'alpha.example.com' },
          correlationId: 'corr_A_1',
        },
        {
          actorId: 'user_A',
          action: 'DOMAIN_VERIFIED',
          resourceType: 'domain',
          resourceId: 'dom_1',
          after: { verified: true },
          correlationId: 'corr_A_1',
        },
        {
          actorId: 'user_B',
          action: 'BILLING_PLAN_CHANGED',
          resourceType: 'billing',
          resourceId: 'bill_1',
          before: { plan: 'free' },
          after: { plan: 'pro' },
          correlationId: 'corr_B_1',
        },
        {
          actorId: 'user_B',
          action: 'PROFILE_SENSITIVE_UPDATED',
          resourceType: 'profile',
          resourceId: 'prof_1',
          after: { twoFactorEnabled: true },
          correlationId: 'corr_B_2',
        },
      ];

      for (const entry of entries) {
        await service.log(entry);
      }
    });

    it('queries entries filtered by actorId', async () => {
      const { data } = await mockSupabase
        .from('audit_logs')
        .select('*')
        .eq('actor_id', 'user_A');

      expect(data).toHaveLength(3);
      data.forEach((row: MockStoredRow) => {
        expect(row.actor_id).toBe('user_A');
      });
    });

    it('queries entries filtered by a combination of resourceType and action', async () => {
      const { data } = await mockSupabase
        .from('audit_logs')
        .select('*')
        .eq('resource_type', 'domain')
        .eq('action', 'DOMAIN_VERIFIED');

      expect(data).toHaveLength(1);
      expect(data[0].resource_id).toBe('dom_1');
      expect(data[0].action).toBe('DOMAIN_VERIFIED');

      const payload = JSON.parse(decrypt(data[0].encrypted_payload));
      expect(payload.after).toEqual({ verified: true });
      expect(payload.correlationId).toBe('corr_A_1');
    });

    it('preserves correlation-ID end-to-end across multiple correlated events', async () => {
      const { data } = await mockSupabase
        .from('audit_logs')
        .select('*')
        .eq('actor_id', 'user_A')
        .order('created_at', { ascending: true });

      expect(data).toHaveLength(3);

      const decryptedPayloads = data.map((row: MockStoredRow) =>
        JSON.parse(decrypt(row.encrypted_payload))
      );

      // All 3 events for user_A share the exact same correlation ID
      expect(decryptedPayloads.every((p: any) => p.correlationId === 'corr_A_1')).toBe(true);
      expect(decryptedPayloads[0].after).toEqual({ name: 'Deploy Key 1' });
      expect(decryptedPayloads[1].after).toEqual({ domain: 'alpha.example.com' });
      expect(decryptedPayloads[2].after).toEqual({ verified: true });
    });

    it('isolates different correlation IDs correctly', async () => {
      const { data } = await mockSupabase
        .from('audit_logs')
        .select('*')
        .eq('actor_id', 'user_B');

      expect(data).toHaveLength(2);

      const payload1 = JSON.parse(decrypt(data[0].encrypted_payload));
      const payload2 = JSON.parse(decrypt(data[1].encrypted_payload));

      expect(payload1.correlationId).toBe('corr_B_1');
      expect(payload2.correlationId).toBe('corr_B_2');
      expect(payload1.correlationId).not.toBe(payload2.correlationId);
    });

    it('returns empty array when filter combination matches no records', async () => {
      const { data } = await mockSupabase
        .from('audit_logs')
        .select('*')
        .eq('actor_id', 'non_existent_user');

      expect(data).toEqual([]);
    });
  });
});
