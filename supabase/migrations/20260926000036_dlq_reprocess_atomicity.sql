-- ── Dependency chain: job queue / DLQ (see issue #1336) ─────────────────────
-- These four migrations must apply in this exact order:
--   1. 013_github_webhook_delivery_tracking.sql — webhook delivery tracking (root of the chain)
--   2. 014_job_queue.sql — job_queue / job_dlq tables and job_priority / job_status enums
--   3. 015_job_queue_claim_rpc.sql — claim_next_job() RPC — requires job_queue from 014_job_queue.sql
--   4. 018_dlq_reprocess_atomicity.sql — job_dlq 'in_progress' reprocess state — requires job_dlq from 014_job_queue.sql  <-- this file
-- Supabase applies migrations in lexicographic filename order. If these files
-- are renumbered (e.g. to resolve the duplicate 014_ prefix), the new numbers
-- MUST stay strictly ascending in the order above. This is enforced by
-- apps/backend/tests/database/job-queue-migration-chain.test.ts.
-- ─────────────────────────────────────────────────────────────────────────────

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
