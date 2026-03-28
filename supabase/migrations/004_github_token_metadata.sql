-- Migration 004: add GitHub token expiry/refresh metadata to profiles
--
-- github_token_expires_at  — when the stored token expires (NULL = no known expiry, e.g. classic PAT)
-- github_token_refreshed_at — last time the token was successfully validated/refreshed

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS github_token_expires_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS github_token_refreshed_at  TIMESTAMPTZ;
