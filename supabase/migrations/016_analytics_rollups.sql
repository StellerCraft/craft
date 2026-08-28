-- Migration 016: Analytics Time-Series Rollup Tables
--
-- Adds hourly and daily pre-aggregated rollup buckets to enable
-- fast dashboard queries without full table scans of deployment_analytics.
--
-- Issue: #768 — Analytics Data Pipeline with Time-Series Aggregation

-- ── analytics_rollups table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_rollups (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id     UUID        NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    metric_type       TEXT        NOT NULL,
    bucket_start      TIMESTAMPTZ NOT NULL,
    granularity       TEXT        NOT NULL CHECK (granularity IN ('1h', '24h')),
    total_value       NUMERIC     NOT NULL DEFAULT 0,
    record_count      INT         NOT NULL DEFAULT 0,
    up_count          INT         NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (deployment_id, metric_type, granularity, bucket_start)
);

CREATE INDEX IF NOT EXISTS analytics_rollups_deployment_idx
    ON analytics_rollups (deployment_id, metric_type, granularity, bucket_start DESC);

-- ── rollup_cursors: tracks last aggregated event per granularity ──────────────

CREATE TABLE IF NOT EXISTS rollup_cursors (
    granularity   TEXT        NOT NULL,
    last_run_at   TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',

    PRIMARY KEY (granularity)
);

INSERT INTO rollup_cursors (granularity, last_run_at)
VALUES ('1h', '1970-01-01T00:00:00Z'), ('24h', '1970-01-01T00:00:00Z')
ON CONFLICT DO NOTHING;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE analytics_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE rollup_cursors    ENABLE ROW LEVEL SECURITY;

-- Users may read rollups for their own deployments
CREATE POLICY "users read own rollups"
    ON analytics_rollups FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM deployments d
            WHERE d.id = deployment_id
              AND d.user_id = auth.uid()
        )
    );

-- Service role handles writes (cron job)
CREATE POLICY "service role write rollups"
    ON analytics_rollups FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "service role manage cursors"
    ON rollup_cursors FOR ALL
    USING (auth.role() = 'service_role');
