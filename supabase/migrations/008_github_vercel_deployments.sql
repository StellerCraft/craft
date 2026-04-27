-- GitHub → Vercel Deployment Tracking Table
-- Stores deployment metadata for GitHub webhook-triggered Vercel deployments
-- Used for tracking deployment status and providing observability

CREATE TABLE IF NOT EXISTS github_vercel_deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    repo_full_name TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    branch TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    commit_message TEXT,
    pusher_name TEXT,
    vercel_deployment_id TEXT NOT NULL UNIQUE,
    vercel_deployment_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (
        status IN ('queued', 'building', 'ready', 'error', 'failed', 'canceled')
    ),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for performance
CREATE INDEX idx_github_vercel_deployments_repo_full_name ON github_vercel_deployments(repo_full_name);
CREATE INDEX idx_github_vercel_deployments_vercel_deployment_id ON github_vercel_deployments(vercel_deployment_id);
CREATE INDEX idx_github_vercel_deployments_status ON github_vercel_deployments(status);
CREATE INDEX idx_github_vercel_deployments_created_at ON github_vercel_deployments(created_at);

-- Updated_at trigger
CREATE TRIGGER update_github_vercel_deployments_updated_at
    BEFORE UPDATE ON github_vercel_deployments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security
ALTER TABLE github_vercel_deployments ENABLE ROW LEVEL SECURITY;

-- Allow service role to read/write (for webhook handler)
CREATE POLICY "Service role can manage github_vercel_deployments"
    ON github_vercel_deployments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Allow authenticated users to read deployments
CREATE POLICY "Authenticated users can read github_vercel_deployments"
    ON github_vercel_deployments
    FOR SELECT
    TO authenticated
    USING (true);
