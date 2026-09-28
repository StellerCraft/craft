-- ── Dependency chain: job queue / DLQ (see issue #1336) ─────────────────────
-- These four migrations must apply in this exact order:
--   1. 013_github_webhook_delivery_tracking.sql — webhook delivery tracking (root of the chain)
--   2. 014_job_queue.sql — job_queue / job_dlq tables and job_priority / job_status enums  <-- this file
--   3. 015_job_queue_claim_rpc.sql — claim_next_job() RPC — requires job_queue from 014_job_queue.sql
--   4. 018_dlq_reprocess_atomicity.sql — job_dlq 'in_progress' reprocess state — requires job_dlq from 014_job_queue.sql
-- Supabase applies migrations in lexicographic filename order. If these files
-- are renumbered (e.g. to resolve the duplicate 014_ prefix), the new numbers
-- MUST stay strictly ascending in the order above. This is enforced by
-- apps/backend/tests/database/job-queue-migration-chain.test.ts.
-- ─────────────────────────────────────────────────────────────────────────────

-- Migration: 014_job_queue.sql
-- Creates the job_queue table for background deployment processing with
-- priority lanes (high / normal / low) and dead-letter escalation after
-- MAX_ATTEMPTS failures.

-- ── Enum types ────────────────────────────────────────────────────────────────

CREATE TYPE job_priority AS ENUM ('high', 'normal', 'low');
CREATE TYPE job_status   AS ENUM ('pending', 'running', 'completed', 'failed', 'dead');

-- ── Main job queue table ──────────────────────────────────────────────────────

CREATE TABLE job_queue (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type        TEXT        NOT NULL,               -- e.g. 'deployment'
    priority        job_priority NOT NULL DEFAULT 'normal',
    status          job_status   NOT NULL DEFAULT 'pending',
    payload         JSONB        NOT NULL DEFAULT '{}',
    result          JSONB,                              -- set on completion
    error_message   TEXT,                              -- last failure reason
    attempts        INTEGER      NOT NULL DEFAULT 0,
    max_attempts    INTEGER      NOT NULL DEFAULT 3,
    worker_id       TEXT,                              -- ID of the claiming worker
    scheduled_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    dead_at         TIMESTAMPTZ,                       -- set when moved to DLQ
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Dead letter queue (separate table for clarity) ────────────────────────────

CREATE TABLE job_dlq (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    original_job_id UUID        NOT NULL REFERENCES job_queue(id),
    job_type        TEXT        NOT NULL,
    priority        job_priority NOT NULL,
    payload         JSONB        NOT NULL,
    failure_reason  TEXT        NOT NULL,
    attempts        INTEGER      NOT NULL,
    reprocess_status TEXT        NOT NULL DEFAULT 'pending'
        CHECK (reprocess_status IN ('pending', 'succeeded', 'failed')),
    reprocessed_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Primary fetch path: pending jobs ordered by priority lane then schedule time
-- Priority ordering: high → normal → low  maps to  CASE ordinal: 1, 2, 3
CREATE INDEX idx_job_queue_fetch
    ON job_queue (status, priority, scheduled_at)
    WHERE status = 'pending';

-- Monitor running jobs (stalled worker detection)
CREATE INDEX idx_job_queue_running
    ON job_queue (worker_id, started_at)
    WHERE status = 'running';

-- DLQ look-ups by original job
CREATE INDEX idx_job_dlq_original_job
    ON job_dlq (original_job_id);

CREATE INDEX idx_job_dlq_reprocess
    ON job_dlq (reprocess_status, created_at)
    WHERE reprocess_status = 'pending';

-- ── updated_at trigger ────────────────────────────────────────────────────────

CREATE TRIGGER update_job_queue_updated_at
    BEFORE UPDATE ON job_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Job queue is a server-side table; service role only.

ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_dlq   ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies — only the service role (bypasses RLS) may
-- read/write these tables, keeping them invisible to the client SDK.
