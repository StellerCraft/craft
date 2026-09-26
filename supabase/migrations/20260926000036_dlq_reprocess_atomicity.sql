-- Migration 018: Fix DLQ Reprocessing Atomicity
--
-- Fixes race condition in reprocessDLQEntry() where marking as 'succeeded'
-- before enqueue() could permanently strand jobs if enqueue() fails.
-- Introduces 'in_progress' intermediate state to maintain atomicity.
--
-- Issue: #897 — Correct Premature Success Marking in DLQ Reprocessing

ALTER TABLE job_dlq
  DROP CONSTRAINT IF EXISTS job_dlq_reprocess_status_check,
  ADD CONSTRAINT job_dlq_reprocess_status_check
    CHECK (reprocess_status IN ('pending', 'in_progress', 'succeeded', 'failed'));
