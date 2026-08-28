-- Migration: 019_fix_auth_audit_logs_rls.sql
-- Issue: #975 — Close RLS Blanket-Read Gap on Cross-Region auth_audit_logs
--
-- Problem:
--   The SELECT policy created in 010_auth_audit_logs_cross_region.sql contained
--   a second OR clause:
--
--     EXISTS (
--       SELECT 1 FROM profiles
--       WHERE profiles.id = auth.uid()
--       AND profiles.subscription_tier IN ('premium', 'enterprise')
--     )
--
--   This clause has NO join to the row's user_id, so any premium or enterprise
--   subscriber can SELECT every other user's audit rows (emails, IPs, event
--   details) across all three regions — a live cross-tenant data leak.
--
-- Fix:
--   Drop and recreate the SELECT policy scoped strictly to the row owner or
--   service_role.  The subscription-tier bypass is removed entirely.
--   No other policies or the original migration (010) are touched.
--
-- Rollback:
--   See rollback section at the bottom of this file.

-- ── Drop the vulnerable policy ────────────────────────────────────────────────

DROP POLICY IF EXISTS "auth_audit_logs_user_policy" ON auth_audit_logs;

-- ── Recreate with correct scope ───────────────────────────────────────────────
--
-- A row is visible only when:
--   1. The authenticated user owns the row (auth.uid() = user_id), OR
--   2. The caller is the Supabase service_role (used by server-side admin APIs).
--
-- Premium/enterprise subscription tier is NOT a sufficient condition for
-- reading another user's audit trail.  Any admin dashboard that previously
-- relied on the tier bypass must be moved to a service-role-backed server API
-- route instead of direct client-side RLS.

CREATE POLICY "auth_audit_logs_user_policy" ON auth_audit_logs
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.role() = 'service_role'
  );

-- ── Comment ───────────────────────────────────────────────────────────────────

COMMENT ON POLICY "auth_audit_logs_user_policy" ON auth_audit_logs IS
  'SELECT access is restricted to the row owner (auth.uid() = user_id) or the '
  'service_role.  The previous subscription-tier bypass (premium/enterprise) '
  'was a cross-tenant data leak and has been removed by migration 019.';

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- To revert this migration (NOT recommended — reverts the security fix):
--
-- DROP POLICY IF EXISTS "auth_audit_logs_user_policy" ON auth_audit_logs;
-- CREATE POLICY "auth_audit_logs_user_policy" ON auth_audit_logs
--   FOR SELECT USING (
--     auth.uid() = user_id OR
--     EXISTS (
--       SELECT 1 FROM profiles
--       WHERE profiles.id = auth.uid()
--       AND profiles.subscription_tier IN ('premium', 'enterprise')
--     )
--   );
