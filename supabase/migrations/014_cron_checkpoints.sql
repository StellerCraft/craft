-- Persisted resume cursor for long-running cron sweeps (e.g. the health-check cron).
-- A sweep that hits its execution-time budget writes the next page's starting cursor
-- here so the next scheduled invocation resumes where it left off instead of
-- restarting from the beginning. `cursor` is NULL once the fleet is fully drained.
create table if not exists cron_checkpoints (
    job text primary key,
    cursor text,
    updated_at timestamptz not null default now()
);

comment on table cron_checkpoints is
    'Checkpoint state for resumable cron sweeps. One row per job; cursor is the id to resume from.';
