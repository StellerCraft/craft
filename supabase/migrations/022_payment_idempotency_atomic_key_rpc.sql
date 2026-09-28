-- Generate or retrieve a payment idempotency key atomically.
-- The unique expression index from migration 021 serializes concurrent requests
-- for the same user, operation, and request fingerprint.

CREATE OR REPLACE FUNCTION generate_payment_idempotency_key(
  p_user_id UUID,
  p_operation_type TEXT,
  p_request_fingerprint TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_key TEXT;
BEGIN
  SELECT idempotency_key
  INTO v_key
  FROM payment_idempotency_keys
  WHERE user_id = p_user_id
    AND operation_type = p_operation_type
    AND expires_at > v_now
    AND (p_request_fingerprint IS NULL OR request_fingerprint = p_request_fingerprint)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_key IS NOT NULL THEN
    RETURN v_key;
  END IF;

  INSERT INTO payment_idempotency_keys (
    user_id,
    idempotency_key,
    operation_type,
    request_fingerprint,
    expires_at,
    created_at
  )
  VALUES (
    p_user_id,
    'idempotency_' || REPLACE(gen_random_uuid()::TEXT, '-', '') || '_' || FLOOR(EXTRACT(EPOCH FROM v_now) * 1000)::BIGINT,
    p_operation_type,
    p_request_fingerprint,
    v_now + INTERVAL '24 hours',
    v_now
  )
  ON CONFLICT (user_id, operation_type, (COALESCE(request_fingerprint, '')))
  DO UPDATE SET
    idempotency_key = CASE
      WHEN payment_idempotency_keys.expires_at <= v_now THEN EXCLUDED.idempotency_key
      ELSE payment_idempotency_keys.idempotency_key
    END,
    expires_at = CASE
      WHEN payment_idempotency_keys.expires_at <= v_now THEN EXCLUDED.expires_at
      ELSE payment_idempotency_keys.expires_at
    END,
    created_at = CASE
      WHEN payment_idempotency_keys.expires_at <= v_now THEN EXCLUDED.created_at
      ELSE payment_idempotency_keys.created_at
    END,
    stripe_response = CASE
      WHEN payment_idempotency_keys.expires_at <= v_now THEN NULL
      ELSE payment_idempotency_keys.stripe_response
    END
  RETURNING idempotency_key INTO v_key;

  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION generate_payment_idempotency_key(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generate_payment_idempotency_key(UUID, TEXT, TEXT) TO service_role;