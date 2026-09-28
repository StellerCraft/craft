-- Payment Idempotency Atomic Key Generation (Issue #1138)
-- Prevents concurrent duplicate key generation by using database-level unique constraint
-- with atomic upsert, replacing the previous client-side select-then-insert pattern.

-- Add request_fingerprint column to support per-fingerprint idempotency keys
ALTER TABLE payment_idempotency_keys
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

-- Add unique constraint on (user_id, operation_type, request_fingerprint) for atomic upserts.
-- Uses COALESCE to treat NULL values as distinct, so multiple records can have NULL fingerprints.
-- The constraint allows concurrent upserts to converge on a single key per unique combination.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_idempotency_keys_atomic_upsert
  ON payment_idempotency_keys (user_id, operation_type, COALESCE(request_fingerprint, ''));

-- Add index for efficient lookup during upsert retry
CREATE INDEX IF NOT EXISTS idx_payment_idempotency_keys_user_operation_fingerprint
  ON payment_idempotency_keys (user_id, operation_type, request_fingerprint)
  WHERE expires_at > NOW();

-- rollback: DROP INDEX IF EXISTS idx_payment_idempotency_keys_user_operation_fingerprint;
-- rollback: DROP INDEX IF EXISTS idx_payment_idempotency_keys_atomic_upsert;
-- rollback: ALTER TABLE payment_idempotency_keys DROP COLUMN IF EXISTS request_fingerprint;
