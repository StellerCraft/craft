-- Migration 014: Orphaned Artifact Cleanup Audit Log
--
-- Records every orphaned deployment-artifact (storage object with no
-- corresponding deployments row) deleted by
-- CleanupService.purgeOrphanedArtifacts(), capturing the artifact size and age
-- at deletion time for an audit trail / debugging window accounting.
--
-- Issue: #758 — Automated Cleanup Service for Orphaned Deployment Artifacts
--               with Retention Policy Enforcement

CREATE TABLE IF NOT EXISTS orphaned_artifact_cleanup_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Object path within the storage bucket.
    artifact_path TEXT NOT NULL,
    -- Bucket the artifact was removed from.
    bucket TEXT NOT NULL,
    -- Size of the deleted object in bytes (0 when unreported).
    size_bytes BIGINT NOT NULL DEFAULT 0,
    -- Age of the object in seconds at deletion time.
    age_seconds BIGINT NOT NULL DEFAULT 0,
    -- When the orphan was deleted.
    deleted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orphaned_artifact_cleanup_log_deleted_at
    ON orphaned_artifact_cleanup_log(deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_orphaned_artifact_cleanup_log_artifact_path
    ON orphaned_artifact_cleanup_log(artifact_path);

-- Append-only audit table written by the service role only.
ALTER TABLE orphaned_artifact_cleanup_log ENABLE ROW LEVEL SECURITY;
