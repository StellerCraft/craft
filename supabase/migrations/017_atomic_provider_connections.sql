-- Migration 017: Atomic provider_connections RPC functions (#922)
--
-- Replaces read-modify-write JSONB column operations with server-side atomic
-- PostgreSQL functions using || and - operators to eliminate race conditions.

CREATE OR REPLACE FUNCTION connect_stellar_provider(
    p_user_id UUID,
    p_public_key TEXT,
    p_connected_at TIMESTAMPTZ DEFAULT NOW()
) RETURNS VOID AS $$
BEGIN
    UPDATE profiles
    SET provider_connections = COALESCE(provider_connections, '{}'::jsonb) || jsonb_build_object(
        'stellar', jsonb_build_object(
            'publicKey', p_public_key,
            'connectedAt', p_connected_at
        )
    ),
    updated_at = NOW()
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION disconnect_stellar_provider(
    p_user_id UUID
) RETURNS VOID AS $$
BEGIN
    UPDATE profiles
    SET provider_connections = COALESCE(provider_connections, '{}'::jsonb) - 'stellar',
    updated_at = NOW()
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
