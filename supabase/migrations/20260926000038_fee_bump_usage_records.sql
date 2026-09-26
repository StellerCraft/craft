-- Migration: 020_fee_bump_usage_records.sql
-- Issue: #1111 — Persist Fee-Bump Usage Records So a Restart Cannot Silently
--                Reset Monthly Billing Counters
--
-- Problem:
--   orchestrateFeeBump() in @craft/stellar defaults to an in-memory
--   FeeBumpUsageStore. A server restart mid-billing-period silently resets
--   every user's fee-bump count and cumulative fees paid to zero, with no
--   reconciliation against what was actually charged.
--
-- Fix:
--   Provide a durable table backing SupabaseFeeBumpUsageStore
--   (apps/backend/src/services/fee-bump-usage.service.ts). One row per user,
--   upserted on each fee-bump.

CREATE TABLE IF NOT EXISTS fee_bump_usage_records (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Number of platform-sponsored fee-bump transactions for this user.
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),

  -- Cumulative fee paid on the user's behalf, in stroops.
  total_fees_paid BIGINT NOT NULL DEFAULT 0 CHECK (total_fees_paid >= 0),

  -- Timestamp of the most recent fee-bump.
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_bump_usage_last_used
  ON fee_bump_usage_records(last_used_at);

-- Enable row level security
ALTER TABLE fee_bump_usage_records ENABLE ROW LEVEL SECURITY;

-- RLS Policy: users can read their own usage; service_role manages writes.
CREATE POLICY "fee_bump_usage_select_policy" ON fee_bump_usage_records
  FOR SELECT USING (
    auth.uid() = user_id OR auth.role() = 'service_role'
  );

CREATE POLICY "fee_bump_usage_service_policy" ON fee_bump_usage_records
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Keep updated_at current on every write.
CREATE OR REPLACE FUNCTION update_fee_bump_usage_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fee_bump_usage_update_timestamp ON fee_bump_usage_records;
CREATE TRIGGER fee_bump_usage_update_timestamp
  BEFORE UPDATE ON fee_bump_usage_records
  FOR EACH ROW
  EXECUTE FUNCTION update_fee_bump_usage_timestamp();

COMMENT ON TABLE fee_bump_usage_records IS
  'Durable per-user fee-bump usage counters for monthly billing. Backs '
  'SupabaseFeeBumpUsageStore so counts survive server restarts (issue #1111).';

-- rollback: DROP TRIGGER IF EXISTS fee_bump_usage_update_timestamp ON fee_bump_usage_records;
-- rollback: DROP FUNCTION IF EXISTS update_fee_bump_usage_timestamp;
-- rollback: DROP POLICY IF EXISTS fee_bump_usage_service_policy ON fee_bump_usage_records;
-- rollback: DROP POLICY IF EXISTS fee_bump_usage_select_policy ON fee_bump_usage_records;
-- rollback: ALTER TABLE fee_bump_usage_records DISABLE ROW LEVEL SECURITY;
-- rollback: DROP INDEX IF EXISTS idx_fee_bump_usage_last_used;
-- rollback: DROP TABLE IF EXISTS fee_bump_usage_records;
