-- Migration 014: Cron Job Failure Tracking
--
-- Stores per-job failure state so the alerting system survives server restarts.
-- Each row represents one cron job identified by a unique job_name.
--
-- Issue: #759 — Cron Job Failure Alerting System

CREATE TABLE IF NOT EXISTS cron_job_failures (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name            TEXT NOT NULL UNIQUE,
    consecutive_failures INT NOT NULL DEFAULT 0,
    last_failure_at     TIMESTAMPTZ,
    last_success_at     TIMESTAMPTZ,
    last_error          TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cron_job_failures_job_name_idx ON cron_job_failures (job_name);
