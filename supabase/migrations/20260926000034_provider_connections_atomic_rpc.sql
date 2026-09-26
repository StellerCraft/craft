-- Migration: 017_provider_connections_atomic_rpc.sql
-- Atomic read-modify-write for profiles.provider_connections.
--
-- MultiProviderAuthService.connectStellar()/disconnectProvider() previously
-- read provider_connections into application memory, merged the change, and
-- wrote the whole JSONB object back with a plain .update(). Two concurrent
-- requests (e.g. two browser tabs, or a retried request) could both read the
-- same snapshot and the second write would silently clobber the first,
-- dropping whichever provider connection change happened first.
--
-- These functions perform the read-modify-write inside a single row-locked
-- UPDATE statement so concurrent callers serialize instead of racing.

CREATE OR REPLACE FUNCTION set_provider_connection(
    p_user_id UUID,
    p_provider TEXT,
    p_value JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
BEGIN
    UPDATE profiles
    SET
        provider_connections = jsonb_set(
            COALESCE(provider_connections, '{}'::jsonb),
            ARRAY[p_provider],
            p_value,
            true
        ),
        updated_at = NOW()
    WHERE id = p_user_id
    RETURNING provider_connections INTO v_result;

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION remove_provider_connection(
    p_user_id UUID,
    p_provider TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
BEGIN
    UPDATE profiles
    SET
        provider_connections = COALESCE(provider_connections, '{}'::jsonb) - p_provider,
        updated_at = NOW()
    WHERE id = p_user_id
    RETURNING provider_connections INTO v_result;

    RETURN v_result;
END;
$$;

-- Grant execute to the service role only
GRANT EXECUTE ON FUNCTION set_provider_connection(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION remove_provider_connection(UUID, TEXT) TO service_role;

-- rollback: DROP FUNCTION IF EXISTS set_provider_connection(UUID, TEXT, JSONB); DROP FUNCTION IF EXISTS remove_provider_connection(UUID, TEXT);
