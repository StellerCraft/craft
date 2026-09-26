-- Migration: 021_usage_records_atomic_increment_rpc.sql
-- Atomic increment RPC for usage_records.idempotency_key conflicts.
-- Prevents the lost-update race when two concurrent calls hit the same
-- (user_id, operation_type) within the same second.

CREATE OR REPLACE FUNCTION increment_usage_record_quantity(
  p_user_id UUID,
  p_operation_type TEXT,
  p_quantity INTEGER,
  p_metadata JSONB,
  p_billing_period_start DATE,
  p_billing_period_end DATE,
  p_idempotency_key TEXT
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  operation_type TEXT,
  quantity INTEGER,
  metadata JSONB,
  billing_period_start DATE,
  billing_period_end DATE,
  idempotency_key TEXT,
  stripe_usage_record_id TEXT,
  reported_to_stripe BOOLEAN,
  report_error TEXT,
  reported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH upserted AS (
    INSERT INTO usage_records (
      user_id,
      operation_type,
      quantity,
      metadata,
      billing_period_start,
      billing_period_end,
      idempotency_key,
      reported_to_stripe,
      created_at,
      updated_at
    )
    VALUES (
      p_user_id,
      p_operation_type,
      p_quantity,
      COALESCE(p_metadata, '{}'::jsonb),
      p_billing_period_start,
      p_billing_period_end,
      p_idempotency_key,
      FALSE,
      NOW(),
      NOW()
    )
    ON CONFLICT (idempotency_key)
    DO UPDATE SET
      quantity = usage_records.quantity + EXCLUDED.quantity,
      metadata = COALESCE(usage_records.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
      updated_at = NOW()
    RETURNING *
  )
  SELECT
    upserted.id,
    upserted.user_id,
    upserted.operation_type,
    upserted.quantity,
    upserted.metadata,
    upserted.billing_period_start,
    upserted.billing_period_end,
    upserted.idempotency_key,
    upserted.stripe_usage_record_id,
    upserted.reported_to_stripe,
    upserted.report_error,
    upserted.reported_at,
    upserted.created_at,
    upserted.updated_at
  FROM upserted;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_usage_record_quantity(
  UUID,
  TEXT,
  INTEGER,
  JSONB,
  DATE,
  DATE,
  TEXT
) TO service_role;
