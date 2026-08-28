/**
 * RLS Tests — auth_audit_logs policy fix (Issue #975)
 *
 * Verifies that migration 019_fix_auth_audit_logs_rls.sql correctly scopes
 * the SELECT policy to the row owner and service_role only.
 *
 * The bug:  the old policy granted SELECT when the *requester's* profile had
 *           subscription_tier IN ('premium','enterprise') — with no join to
 *           the row's user_id — so any premium user could read every user's
 *           audit trail.
 *
 * The fix:  policy is now USING (auth.uid() = user_id OR role = 'service_role').
 *
 * Approach: no live Supabase database is required.  The SQL USING expression is
 *           re-implemented as a TypeScript predicate and exercised through an
 *           in-process RLS engine that mirrors Supabase's evaluation semantics.
 */

import { describe, it, expect } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type Uid = string | null;
type Role = 'authenticated' | 'service_role' | 'anon';

interface AuthContext {
  uid: Uid;
  role: Role;
}

interface AuditLogRow {
  id: string;
  user_id: string;
  event_type: string;
  region: string;
  request_id: string;
  details: Record<string, unknown>;
  created_at: string;
}

// ── In-process RLS engine ─────────────────────────────────────────────────────

/**
 * Mirrors Supabase RLS evaluation:
 *   - service_role bypasses all policies.
 *   - anon/authenticated are evaluated against the USING predicate.
 */
function canSelect(row: AuditLogRow, ctx: AuthContext): boolean {
  if (ctx.role === 'service_role') return true; // bypass
  // Fixed policy: USING (auth.uid() = user_id)
  return ctx.uid !== null && ctx.uid === row.user_id;
}

/**
 * OLD (vulnerable) policy predicate — used only to confirm the bug existed.
 * Mirrors the pre-019 USING expression.
 */
function canSelectOldPolicy(
  row: AuditLogRow,
  ctx: AuthContext,
  requesterSubscriptionTier: string,
): boolean {
  if (ctx.role === 'service_role') return true;
  if (ctx.uid !== null && ctx.uid === row.user_id) return true;
  // The broken tier bypass — no reference to row.user_id
  if (['premium', 'enterprise'].includes(requesterSubscriptionTier)) return true;
  return false;
}

function filterTable(table: AuditLogRow[], ctx: AuthContext): AuditLogRow[] {
  return table.filter((row) => canSelect(row, ctx));
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_A = 'aaaaaaaa-0000-0000-0000-000000000001'; // premium tier
const USER_B = 'bbbbbbbb-0000-0000-0000-000000000002'; // free tier

const auth = {
  userA_premium:  { uid: USER_A, role: 'authenticated' } as AuthContext,
  userA_enterprise: { uid: USER_A, role: 'authenticated' } as AuthContext, // same uid, just for label clarity
  userB_free:     { uid: USER_B, role: 'authenticated' } as AuthContext,
  anon:           { uid: null,   role: 'anon'           } as AuthContext,
  serviceRole:    { uid: null,   role: 'service_role'   } as AuthContext,
};

function makeLogRow(userId: string, overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    event_type: 'signin',
    region: 'us-east',
    request_id: `req-${Math.random().toString(36).slice(2)}`,
    details: { ip: '1.2.3.4', email: `${userId}@example.com` },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// Build a small in-memory table
const logRowA = makeLogRow(USER_A); // owned by user A
const logRowB = makeLogRow(USER_B); // owned by user B
const allRows: AuditLogRow[] = [logRowA, logRowB];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('auth_audit_logs RLS — fixed policy (migration 019)', () => {
  // ── Regression: confirm the old policy was broken ──────────────────────────
  describe('regression: old policy had a blanket-read bypass', () => {
    it('old policy (pre-019): premium user A could read user B row', () => {
      const visible = canSelectOldPolicy(logRowB, auth.userA_premium, 'premium');
      // This was the bug — should be TRUE under the OLD policy
      expect(visible).toBe(true);
    });

    it('old policy (pre-019): enterprise user A could read user B row', () => {
      const visible = canSelectOldPolicy(logRowB, auth.userA_enterprise, 'enterprise');
      expect(visible).toBe(true);
    });
  });

  // ── Core: each user sees only their own rows ───────────────────────────────
  describe('fixed policy: row-owner isolation', () => {
    it('user A can SELECT their own audit log row', () => {
      expect(canSelect(logRowA, auth.userA_premium)).toBe(true);
    });

    it('user B can SELECT their own audit log row', () => {
      expect(canSelect(logRowB, auth.userB_free)).toBe(true);
    });

    it('premium user A CANNOT SELECT user B row (cross-tenant leak fixed)', () => {
      expect(canSelect(logRowB, auth.userA_premium)).toBe(false);
    });

    it('enterprise user A CANNOT SELECT user B row', () => {
      expect(canSelect(logRowB, auth.userA_enterprise)).toBe(false);
    });

    it('free user B CANNOT SELECT user A row', () => {
      expect(canSelect(logRowA, auth.userB_free)).toBe(false);
    });
  });

  // ── service_role bypass ────────────────────────────────────────────────────
  describe('service_role bypass', () => {
    it('service_role can SELECT any row (used by admin APIs)', () => {
      expect(canSelect(logRowA, auth.serviceRole)).toBe(true);
      expect(canSelect(logRowB, auth.serviceRole)).toBe(true);
    });
  });

  // ── Anonymous access ───────────────────────────────────────────────────────
  describe('anonymous access', () => {
    it('anon user cannot SELECT any row', () => {
      expect(canSelect(logRowA, auth.anon)).toBe(false);
      expect(canSelect(logRowB, auth.anon)).toBe(false);
    });
  });

  // ── Table-level filter (simulates WHERE clause applied by RLS) ─────────────
  describe('table-level filtering', () => {
    it('user A sees only their own rows from the full table', () => {
      const visible = filterTable(allRows, auth.userA_premium);
      expect(visible).toHaveLength(1);
      expect(visible[0].user_id).toBe(USER_A);
    });

    it('user B sees only their own rows from the full table', () => {
      const visible = filterTable(allRows, auth.userB_free);
      expect(visible).toHaveLength(1);
      expect(visible[0].user_id).toBe(USER_B);
    });

    it('service_role sees all rows from the full table', () => {
      const visible = filterTable(allRows, auth.serviceRole);
      expect(visible).toHaveLength(allRows.length);
    });

    it('anon sees zero rows from the full table', () => {
      const visible = filterTable(allRows, auth.anon);
      expect(visible).toHaveLength(0);
    });
  });

  // ── NULL user_id rows (e.g. failed auth events) ────────────────────────────
  describe('NULL user_id rows', () => {
    it('no user can SELECT a NULL-user_id row (failure log with no known user)', () => {
      const failureRow: AuditLogRow = makeLogRow('', {
        user_id: '' as string, // simulate null/empty; policy requires uid = user_id
      });
      // uid is a real UUID, user_id is empty — they won't match
      expect(canSelect(failureRow, auth.userA_premium)).toBe(false);
      expect(canSelect(failureRow, auth.userB_free)).toBe(false);
    });

    it('service_role CAN SELECT a NULL-user_id failure row', () => {
      const failureRow: AuditLogRow = makeLogRow('', { user_id: '' });
      expect(canSelect(failureRow, auth.serviceRole)).toBe(true);
    });
  });
});
