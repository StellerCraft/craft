-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Profiles table (extends Supabase Auth users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (
        subscription_tier IN ('free', 'pro', 'enterprise')
    ),
    subscription_status TEXT CHECK (
        subscription_status IN ('active', 'canceled', 'past_due', 'unpaid')
    ),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    github_connected BOOLEAN DEFAULT FALSE,
    github_username TEXT,
    github_token_encrypted TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Templates table
CREATE TABLE templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL CHECK (
        category IN ('dex', 'lending', 'payment', 'asset-issuance')
    ),
    blockchain_type TEXT NOT NULL DEFAULT 'stellar',
    base_repository_url TEXT NOT NULL,
    preview_image_url TEXT,
    customization_schema JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Deployments table
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES templates(id),
    name TEXT NOT NULL,
    customization_config JSONB NOT NULL,
    repository_url TEXT,
    vercel_project_id TEXT,
    vercel_deployment_id TEXT,
    deployment_url TEXT,
    custom_domain TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'generating',
            'creating_repo',
            'pushing_code',
            'deploying',
            'completed',
            'failed'
        )
    ),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    deployed_at TIMESTAMPTZ
);
-- Deployment logs table
CREATE TABLE deployment_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    message TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Customization drafts table (for save/resume)
CREATE TABLE customization_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES templates(id),
    customization_config JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Analytics table
CREATE TABLE deployment_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    metric_type TEXT NOT NULL,
    metric_value NUMERIC NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
-- Indexes for performance
CREATE INDEX idx_profiles_stripe_customer ON profiles(stripe_customer_id);
CREATE INDEX idx_deployments_user_id ON deployments(user_id);
CREATE INDEX idx_deployments_status ON deployments(status);
CREATE INDEX idx_deployment_logs_deployment_id ON deployment_logs(deployment_id);
CREATE INDEX idx_deployment_logs_created_at ON deployment_logs(created_at);
CREATE INDEX idx_customization_drafts_user_id ON customization_drafts(user_id);
CREATE INDEX idx_deployment_analytics_deployment_id ON deployment_analytics(deployment_id);
CREATE INDEX idx_templates_category ON templates(category);
CREATE INDEX idx_templates_is_active ON templates(is_active);
-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE
UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_templates_updated_at BEFORE
UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_deployments_updated_at BEFORE
UPDATE ON deployments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_customization_drafts_updated_at BEFORE
UPDATE ON customization_drafts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- rollback: DROP TABLE IF EXISTS deployment_analytics CASCADE;
-- rollback: DROP TABLE IF EXISTS customization_drafts CASCADE;
-- rollback: DROP TABLE IF EXISTS deployment_logs CASCADE;
-- rollback: DROP TABLE IF EXISTS deployments CASCADE;
-- rollback: DROP TABLE IF EXISTS templates CASCADE;
-- rollback: DROP TABLE IF EXISTS profiles CASCADE;
-- rollback: DROP TRIGGER IF EXISTS update_customization_drafts_updated_at ON customization_drafts;
-- rollback: DROP TRIGGER IF EXISTS update_deployments_updated_at ON deployments;
-- rollback: DROP TRIGGER IF EXISTS update_templates_updated_at ON templates;
-- rollback: DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
-- rollback: DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
-- rollback: DROP INDEX IF EXISTS idx_templates_is_active;
-- rollback: DROP INDEX IF EXISTS idx_templates_category;
-- rollback: DROP INDEX IF EXISTS idx_deployment_analytics_deployment_id;
-- rollback: DROP INDEX IF EXISTS idx_customization_drafts_user_id;
-- rollback: DROP INDEX IF EXISTS idx_deployment_logs_created_at;
-- rollback: DROP INDEX IF EXISTS idx_deployment_logs_deployment_id;
-- rollback: DROP INDEX IF EXISTS idx_deployments_status;
-- rollback: DROP INDEX IF EXISTS idx_deployments_user_id;
-- rollback: DROP INDEX IF EXISTS idx_profiles_stripe_customer;
-- rollback: DROP EXTENSION IF EXISTS "uuid-ossp";