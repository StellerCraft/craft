-- Migration 017: Atomic Cron Failure Counter & Alert Tracking
--
-- Fixes race condition in recordFailure() where concurrent calls could lose increments.
-- Adds atomic increment RPC and alert state tracking to prevent duplicate alerts
-- when count jumps past exact threshold values.
--
-- Issue: #896 — Non-Atomic Failure Counter Race

ALTER TABLE cron_job_failures
  ADD COLUMN IF NOT EXISTS slack_alert_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_alert_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Atomic increment stored procedure:
-- Returns the new consecutive_failures count after incrementing.
-- On first call for a job, inserts with consecutive_failures=1.
CREATE OR REPLACE FUNCTION increment_cron_failure_count(p_job_name TEXT)
RETURNS INT AS $$
DECLARE
  v_new_count INT;
BEGIN
  -- Try to increment existing row
  UPDATE cron_job_failures
  SET consecutive_failures = consecutive_failures + 1,
      updated_at = NOW()
  WHERE job_name = p_job_name
  RETURNING consecutive_failures INTO v_new_count;

  -- If no row existed, insert a new one
  IF v_new_count IS NULL THEN
    INSERT INTO cron_job_failures (job_name, consecutive_failures, updated_at)
    VALUES (p_job_name, 1, NOW())
    RETURNING consecutive_failures INTO v_new_count;
  END IF;

  RETURN v_new_count;
END;
$$ LANGUAGE plpgsql;

-- Mark alerts as sent (idempotent)
CREATE OR REPLACE FUNCTION mark_cron_alert_sent(
  p_job_name TEXT,
  p_alert_type TEXT
)
RETURNS VOID AS $$
BEGIN
  IF p_alert_type = 'slack' THEN
    UPDATE cron_job_failures
    SET slack_alert_sent = TRUE, updated_at = NOW()
    WHERE job_name = p_job_name;
  ELSIF p_alert_type = 'email' THEN
    UPDATE cron_job_failures
    SET email_alert_sent = TRUE, updated_at = NOW()
    WHERE job_name = p_job_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Reset alert tracking on success
CREATE OR REPLACE FUNCTION reset_cron_alerts_on_success(p_job_name TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE cron_job_failures
  SET slack_alert_sent = FALSE,
      email_alert_sent = FALSE,
      updated_at = NOW()
  WHERE job_name = p_job_name;
END;
$$ LANGUAGE plpgsql;
