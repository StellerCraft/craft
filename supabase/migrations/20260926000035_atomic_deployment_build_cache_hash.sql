-- Merge the build cache marker in the database so concurrent deployment stages
-- cannot overwrite unrelated customization_config fields.

CREATE OR REPLACE FUNCTION set_deployment_build_cache_hash(
    p_deployment_id UUID,
    p_hash TEXT
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
    UPDATE deployments
    SET customization_config = COALESCE(customization_config, '{}'::jsonb)
        || jsonb_build_object('_buildCacheHash', p_hash),
        updated_at = NOW()
    WHERE id = p_deployment_id;
$$;

GRANT EXECUTE ON FUNCTION set_deployment_build_cache_hash(UUID, TEXT) TO service_role;

-- rollback: DROP FUNCTION IF EXISTS set_deployment_build_cache_hash(UUID, TEXT);