-- Migration: 017_cron_job_failure_increment_rpc.sql
-- Atomic increment function for cron_job_failures.consecutive_failures.
-- Replaces the read-then-upsert pattern that could lose increments under
-- concurrent calls (see issue #986).
--
-- Uses INSERT ... ON CONFLICT DO UPDATE so two concurrent calls for the
-- same job_name both reliably increment the counter.

CREATE OR REPLACE FUNCTION increment_cron_failure(p_job_name TEXT, p_error TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO cron_job_failures (job_name, consecutive_failures, last_failure_at, last_error, updated_at)
    VALUES (p_job_name, 1, NOW(), p_error, NOW())
    ON CONFLICT (job_name)
    DO UPDATE SET
        consecutive_failures = cron_job_failures.consecutive_failures + 1,
        last_failure_at      = NOW(),
        last_error           = p_error,
        updated_at           = NOW()
    RETURNING consecutive_failures INTO v_count;

    RETURN v_count;
END;
$$;

-- Grant execute to the service role only (matches 015_job_queue_claim_rpc.sql pattern)
GRANT EXECUTE ON FUNCTION increment_cron_failure(TEXT, TEXT) TO service_role;
