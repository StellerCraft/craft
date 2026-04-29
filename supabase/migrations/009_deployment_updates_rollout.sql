CREATE TABLE IF NOT EXISTS deployment_updates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    new_customization_config JSONB NOT NULL,
    previous_state JSONB,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN (
            'pending',
            'validating',
            'generating',
            'updating_repo',
            'redeploying',
            'completed',
            'rolled_back',
            'failed'
        )
    ),
    canary_percent INTEGER NOT NULL DEFAULT 0 CHECK (canary_percent BETWEEN 0 AND 100),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    completed_at TIMESTAMPTZ
);

ALTER TABLE deployment_updates
    ADD COLUMN IF NOT EXISTS canary_percent INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'deployment_updates_canary_percent_check'
    ) THEN
        ALTER TABLE deployment_updates
            ADD CONSTRAINT deployment_updates_canary_percent_check
            CHECK (canary_percent BETWEEN 0 AND 100);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deployment_updates_deployment_id
    ON deployment_updates(deployment_id);

CREATE INDEX IF NOT EXISTS idx_deployment_updates_status
    ON deployment_updates(status);

DROP TRIGGER IF EXISTS update_deployment_updates_updated_at ON deployment_updates;
CREATE TRIGGER update_deployment_updates_updated_at
    BEFORE UPDATE ON deployment_updates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE deployment_updates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'deployment_updates'
          AND policyname = 'Users can manage their own deployment updates'
    ) THEN
        CREATE POLICY "Users can manage their own deployment updates"
            ON deployment_updates
            FOR ALL
            TO authenticated
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;
