-- ── Dependency chain: job queue / DLQ (see issue #1336) ─────────────────────
-- These four migrations must apply in this exact order:
--   1. 013_github_webhook_delivery_tracking.sql — webhook delivery tracking (root of the chain)
--   2. 014_job_queue.sql — job_queue / job_dlq tables and job_priority / job_status enums
--   3. 015_job_queue_claim_rpc.sql — claim_next_job() RPC — requires job_queue from 014_job_queue.sql  <-- this file
--   4. 018_dlq_reprocess_atomicity.sql — job_dlq 'in_progress' reprocess state — requires job_dlq from 014_job_queue.sql
-- Supabase applies migrations in lexicographic filename order. If these files
-- are renumbered (e.g. to resolve the duplicate 014_ prefix), the new numbers
-- MUST stay strictly ascending in the order above. This is enforced by
-- apps/backend/tests/database/job-queue-migration-chain.test.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- Migration: 015_job_queue_claim_rpc.sql
-- Atomic "claim next job" function used by workers to avoid double-processing.
--
-- Priority mapping (CASE → integer) keeps ordering deterministic:
--   high → 1, normal → 2, low → 3
--
-- The function:
--   1. Finds the single highest-priority pending job whose scheduled_at ≤ NOW()
--   2. Atomically sets status = 'running', worker_id, and started_at
--   3. Returns the full row so the caller doesn't need a second SELECT

CREATE OR REPLACE FUNCTION claim_next_job(p_worker_id TEXT)
RETURNS SETOF job_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job_id UUID;
BEGIN
    -- Step 1: Select the next eligible job ID under a row lock
    SELECT id
    INTO v_job_id
    FROM job_queue
    WHERE status      = 'pending'
      AND scheduled_at <= NOW()
    ORDER BY
        CASE priority
            WHEN 'high'   THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low'    THEN 3
            ELSE               4
        END,
        scheduled_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;   -- skip rows already locked by other workers

    -- Step 2: No eligible job found
    IF v_job_id IS NULL THEN
        RETURN;
    END IF;

    -- Step 3: Atomically claim it
    RETURN QUERY
    UPDATE job_queue
    SET
        status     = 'running',
        worker_id  = p_worker_id,
        started_at = NOW(),
        attempts   = attempts + 1,
        updated_at = NOW()
    WHERE id = v_job_id
    RETURNING *;
END;
$$;

-- Grant execute to the service role only
GRANT EXECUTE ON FUNCTION claim_next_job(TEXT) TO service_role;
