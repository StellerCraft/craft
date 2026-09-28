-- Migration 006: secure token storage hardening (#236)
--
-- Context:
--   github_token_encrypted already stores AES-256-GCM ciphertext (added in 001).
--   github_token_expires_at / github_token_refreshed_at added in 004.
--
-- This migration:
--   1. Adds an index to speed up the nightly expired-token cleanup cron
--      (WHERE github_token_expires_at < now() AND github_token_expires_at IS NOT NULL).
--   2. Adds a CHECK constraint that prevents storing a value in
--      github_token_encrypted that looks like a raw GitHub token
--      (prefix ghu_, ghp_, gho_, ghs_, ghr_).  This is a defence-in-depth
--      guard; the application layer must always encrypt before writing.
--
-- Key management assumptions (out of scope for this migration):
--   - The encryption key is read from GITHUB_TOKEN_ENCRYPTION_KEY (env var).
--   - Key rotation (re-encrypting rows with a new key) requires a separate
--     migration and application-layer support for key versioning.
--   - HSM / KMS integration is a follow-up item.

-- Index for the cleanup cron query
CREATE INDEX IF NOT EXISTS idx_profiles_github_token_expires_at
    ON profiles (github_token_expires_at)
    WHERE github_token_expires_at IS NOT NULL;

-- Prevent accidental plaintext token storage
-- GitHub token prefixes: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github
ALTER TABLE profiles
    ADD CONSTRAINT profiles_github_token_not_plaintext
    CHECK (
        github_token_encrypted IS NULL
        OR (
            github_token_encrypted NOT LIKE 'ghu\_%' ESCAPE '\'
            AND github_token_encrypted NOT LIKE 'ghp\_%' ESCAPE '\'
            AND github_token_encrypted NOT LIKE 'gho\_%' ESCAPE '\'
            AND github_token_encrypted NOT LIKE 'ghs\_%' ESCAPE '\'
            AND github_token_encrypted NOT LIKE 'ghr\_%' ESCAPE '\'
        )
    );

-- rollback: ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_github_token_not_plaintext;
-- rollback: DROP INDEX IF EXISTS idx_profiles_github_token_expires_at;
