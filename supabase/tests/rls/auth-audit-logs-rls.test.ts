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
 * Cross-region coverage (Issue #1318): the blanket-read gap was a cross-region
 *           leak, so a multi-user, multi-region fixture is exercised end-to-end
 *           through a fan-out query path that mirrors how regional-auth reads
 *           auth_audit_logs (one query per regional database, results merged —
 *           see validateAuditLogConsistency in
 *           supabase/functions/regional-auth/consistency-validators.ts).
 *           Traceability: supabase/migrations/019_fix_auth_audit_logs_rls.sql.
 *
 * Approach: no live Supabase database is required.  The SQL USING expression is
 *           re-implemented as a TypeScript predicate and exercised through an
 *           in-process RLS engine that mirrors Supabase's evaluation semantics.
 */

import { describe, it, expect, beforeEach } from 'vitest';

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

// ── Cross-region scenario (Issue #1318) ───────────────────────────────────────
//
// Policy under test: supabase/migrations/019_fix_auth_audit_logs_rls.sql
//   USING (auth.uid() = user_id OR auth.role() = 'service_role')
//
// Each region (see the region CHECK constraint in
// 010_auth_audit_logs_cross_region.sql) is a separate database with its own
// auth_audit_logs table. A cross-region read fans out to every regional table,
// applies RLS independently inside each region, and merges the results — the
// exact path the pre-019 tier bypass leaked through.

describe('auth_audit_logs RLS — cross-region multi-user reads (migration 019)', () => {
  const REGIONS = ['us-east', 'eu-west', 'ap-southeast'] as const;
  type Region = (typeof REGIONS)[number];

  const USER_C = 'cccccccc-0000-0000-0000-000000000003'; // shares us-east with user A

  const ctx = {
    userA: { uid: USER_A, role: 'authenticated' } as AuthContext,
    userB: { uid: USER_B, role: 'authenticated' } as AuthContext,
    userC: { uid: USER_C, role: 'authenticated' } as AuthContext,
    anon: { uid: null, role: 'anon' } as AuthContext,
    serviceRole: { uid: null, role: 'service_role' } as AuthContext,
  };

  /** One auth_audit_logs table per regional database. */
  type RegionalTables = Record<Region, AuditLogRow[]>;

  function buildRegionalTables(): RegionalTables {
    return {
      // User A has rows in two distinct regions; user C shares us-east with A.
      'us-east': [
        makeLogRow(USER_A, { region: 'us-east', event_type: 'signin' }),
        makeLogRow(USER_A, { region: 'us-east', event_type: 'refresh' }),
        makeLogRow(USER_C, { region: 'us-east', event_type: 'signin' }),
      ],
      'eu-west': [
        makeLogRow(USER_A, { region: 'eu-west', event_type: 'refresh' }),
        makeLogRow(USER_B, { region: 'eu-west', event_type: 'signup' }),
      ],
      'ap-southeast': [
        makeLogRow(USER_B, { region: 'ap-southeast', event_type: 'signin' }),
        makeLogRow(USER_C, { region: 'ap-southeast', event_type: 'logout' }),
      ],
    };
  }

  /**
   * Cross-region query path: SELECT * FROM auth_audit_logs [WHERE user_id = ?]
   * issued against every regional database under the caller's auth context,
   * with RLS evaluated inside each region before the results are merged.
   */
  function selectAcrossRegions(
    tables: RegionalTables,
    auth: AuthContext,
    filter: { userId?: string } = {},
  ): AuditLogRow[] {
    return REGIONS.flatMap((region) =>
      tables[region]
        .filter((row) => canSelect(row, auth)) // RLS runs inside each region
        .filter((row) => filter.userId === undefined || row.user_id === filter.userId),
    );
  }

  /** Same fan-out under the pre-019 policy, used to prove the scenario is the leak shape. */
  function selectAcrossRegionsOldPolicy(tables: RegionalTables, auth: AuthContext, tier: string): AuditLogRow[] {
    return REGIONS.flatMap((region) => tables[region].filter((row) => canSelectOldPolicy(row, auth, tier)));
  }

  const allRegionalRows = (tables: RegionalTables) => REGIONS.flatMap((r) => tables[r]);

  let tables: RegionalTables;

  beforeEach(() => {
    tables = buildRegionalTables();
  });

  it('fixture: the same user_id has rows in two distinct regions', () => {
    const regionsForA = new Set(allRegionalRows(tables).filter((r) => r.user_id === USER_A).map((r) => r.region));
    expect(regionsForA.size).toBeGreaterThanOrEqual(2);
    expect([...regionsForA]).toEqual(expect.arrayContaining(['us-east', 'eu-west']));
  });

  it('regression: pre-019 policy leaked other users\' rows from every region to a premium user', () => {
    const leaked = selectAcrossRegionsOldPolicy(tables, ctx.userA, 'premium');
    const foreignRegions = new Set(leaked.filter((r) => r.user_id !== USER_A).map((r) => r.region));
    expect(foreignRegions).toEqual(new Set(['us-east', 'eu-west', 'ap-southeast']));
  });

  describe('a user reads only their own rows regardless of region', () => {
    it('user A sees all of their rows from both us-east and eu-west', () => {
      const visible = selectAcrossRegions(tables, ctx.userA);
      const expected = allRegionalRows(tables).filter((r) => r.user_id === USER_A);

      expect(visible.map((r) => r.id).sort()).toEqual(expected.map((r) => r.id).sort());
      expect(new Set(visible.map((r) => r.region))).toEqual(new Set(['us-east', 'eu-west']));
      expect(visible.every((r) => r.user_id === USER_A)).toBe(true);
    });

    it('user B sees only their own rows across eu-west and ap-southeast', () => {
      const visible = selectAcrossRegions(tables, ctx.userB);
      expect(visible).toHaveLength(2);
      expect(visible.every((r) => r.user_id === USER_B)).toBe(true);
      expect(new Set(visible.map((r) => r.region))).toEqual(new Set(['eu-west', 'ap-southeast']));
    });

    it.each(REGIONS)('no foreign row is returned from %s for any authenticated user', (region) => {
      for (const auth of [ctx.userA, ctx.userB, ctx.userC]) {
        const fromRegion = selectAcrossRegions(tables, auth).filter((r) => r.region === region);
        expect(fromRegion.every((r) => r.user_id === auth.uid)).toBe(true);
      }
    });
  });

  describe('a user cannot read another user\'s rows, even when both share a region', () => {
    it('user A and user C both have us-east rows but each sees only their own', () => {
      const aInUsEast = selectAcrossRegions(tables, ctx.userA).filter((r) => r.region === 'us-east');
      const cInUsEast = selectAcrossRegions(tables, ctx.userC).filter((r) => r.region === 'us-east');

      expect(aInUsEast).toHaveLength(2);
      expect(aInUsEast.every((r) => r.user_id === USER_A)).toBe(true);
      expect(cInUsEast).toHaveLength(1);
      expect(cInUsEast[0].user_id).toBe(USER_C);
    });

    it('explicitly filtering on another user_id returns zero rows across all regions', () => {
      expect(selectAcrossRegions(tables, ctx.userA, { userId: USER_C })).toEqual([]);
      expect(selectAcrossRegions(tables, ctx.userC, { userId: USER_A })).toEqual([]);
      expect(selectAcrossRegions(tables, ctx.userB, { userId: USER_A })).toEqual([]);
    });

    it('anon sees nothing in any region', () => {
      expect(selectAcrossRegions(tables, ctx.anon)).toEqual([]);
    });
  });

  describe('service_role bypass in the cross-region scenario', () => {
    it('service_role reads every row from every region', () => {
      const visible = selectAcrossRegions(tables, ctx.serviceRole);
      expect(visible).toHaveLength(allRegionalRows(tables).length);
      expect(new Set(visible.map((r) => r.region))).toEqual(new Set(REGIONS));
    });

    it('service_role reads a single user\'s rows across all regions (validateAuditLogConsistency path)', () => {
      const perRegionCounts = Object.fromEntries(
        REGIONS.map((region) => [
          region,
          tables[region].filter((row) => canSelect(row, ctx.serviceRole) && row.user_id === USER_A).length,
        ]),
      );
      expect(perRegionCounts).toEqual({ 'us-east': 2, 'eu-west': 1, 'ap-southeast': 0 });
    });

    it('service_role sees rows belonging to multiple users that share a region', () => {
      const usEast = selectAcrossRegions(tables, ctx.serviceRole).filter((r) => r.region === 'us-east');
      expect(new Set(usEast.map((r) => r.user_id))).toEqual(new Set([USER_A, USER_C]));
    });
  });
});
