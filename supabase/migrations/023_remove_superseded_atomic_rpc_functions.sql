-- Remove duplicate-prefix atomic RPCs that have no active service callers.
-- CronFailureTrackerService uses increment_cron_failure(TEXT, TEXT); the
-- alert-state helpers from 017_cron_failure_atomic_increment.sql remain active.
-- MultiProviderAuthService uses set_provider_connection/remove_provider_connection;
-- the specialized Stellar functions were superseded by those generic RPCs.

DROP FUNCTION IF EXISTS increment_cron_failure_count(TEXT);
DROP FUNCTION IF EXISTS connect_stellar_provider(UUID, TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS disconnect_stellar_provider(UUID);