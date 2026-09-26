-- Migration 014: Region Latency Selection Cache
--
-- Caches the optimal Vercel deployment region chosen by RegionSelectorService
-- for a given user/IP + network, with a 5-minute TTL, so latency does not have
-- to be re-measured on every deployment.
--
-- Issue: #757 — Multi-Region Deployment Orchestration with Latency-Based
--               Routing Selection

CREATE TABLE IF NOT EXISTS region_latency_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stable cache key, e.g. "<userId>:<network>" or "<ip>:<network>".
    cache_key TEXT NOT NULL UNIQUE,
    -- Chosen region: us-east-1 | eu-west-1 | ap-southeast-1.
    selected_region TEXT NOT NULL CHECK (
        selected_region IN ('us-east-1', 'eu-west-1', 'ap-southeast-1')
    ),
    -- Per-region measured latencies + weighted scores (audit / debugging).
    scores JSONB,
    -- When this cached selection expires (now + 5 minutes at write time).
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_region_latency_cache_cache_key
    ON region_latency_cache(cache_key);

CREATE INDEX IF NOT EXISTS idx_region_latency_cache_expires_at
    ON region_latency_cache(expires_at);

-- Written by the service role only.
ALTER TABLE region_latency_cache ENABLE ROW LEVEL SECURITY;
