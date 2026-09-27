-- Atomically claim one pending dead-letter entry for reprocessing.
-- A database-side claim prevents workers on separate app instances from
-- enqueueing the same DLQ entry concurrently.

CREATE OR REPLACE FUNCTION claim_dlq_reprocess_entry(p_dlq_id UUID)
RETURNS SETOF job_dlq
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE job_dlq
    SET reprocess_status = 'in_progress'
    WHERE id = p_dlq_id
      AND reprocess_status = 'pending'
    RETURNING *;
$$;

REVOKE ALL ON FUNCTION claim_dlq_reprocess_entry(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_dlq_reprocess_entry(UUID) TO service_role;