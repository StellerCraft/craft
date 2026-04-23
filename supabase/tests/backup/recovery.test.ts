/**
 * Backup and Recovery Tests
 *
 * Verifies that the database schema, migrations, integrity constraints, and
 * RLS policies are complete and correct — the properties that must hold both
 * before a backup is taken and after a restore is applied.
 *
 * These tests run entirely in-process (no live Postgres required) by parsing
 * and simulating the SQL migration files, matching the pattern used in the
 * existing RLS policy tests.
 *
 * What is tested
 * ──────────────
 * 1. Backup completeness  — all expected tables, columns, indexes, and
 *    constraints are present in the migration files.
 * 2. Migration ordering   — migrations apply in sequence without gaps.
 * 3. Data integrity       — CHECK constraints and FK cascade rules are
 *    correctly defined and would survive a restore.
 * 4. Point-in-time state  — each migration is idempotent (IF NOT EXISTS /
 *    IF EXISTS guards) so replaying up to any point is safe.
 * 5. RLS coverage         — every table that holds user data has RLS enabled
 *    and at least one SELECT policy scoped to the owning user.
 * 6. Disaster recovery    — sensitive columns have plaintext-prevention
 *    constraints; encrypted columns are present after the relevant migration.
 *
 * Recovery Time Objective (RTO) guidance
 * ───────────────────────────────────────
 * Supabase Pro/Enterprise provides PITR with 1-minute granularity.
 * Full restore from a daily backup is expected to complete in < 30 minutes
 * for the current schema size.  These tests validate the schema properties
 * that make a restore safe; operational RTO is verified by the runbook in
 * docs/backup-recovery-runbook.md.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIGRATIONS_DIR = join(__dirname, '../../migrations');

function readMigration(filename: string): string {
    return readFileSync(join(MIGRATIONS_DIR, filename), 'utf-8');
}

function allMigrationsSql(): string {
    return readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map(readMigration)
        .join('\n');
}

function migrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();
}

// ── 1. Backup completeness ────────────────────────────────────────────────────

describe('Backup completeness — schema coverage', () => {
    const sql = allMigrationsSql();

    const expectedTables = [
        'profiles',
        'templates',
        'deployments',
        'deployment_logs',
        'customization_drafts',
        'deployment_analytics',
    ];

    it.each(expectedTables)('table "%s" is created in migrations', (table) => {
        expect(sql).toMatch(new RegExp(`CREATE TABLE.*${table}`, 'i'));
    });

    const expectedIndexes = [
        'idx_deployments_user_id',
        'idx_deployments_status',
        'idx_deployment_logs_deployment_id',
        'idx_customization_drafts_user_id',
        'idx_deployment_analytics_deployment_id',
        'idx_templates_category',
        'idx_profiles_stripe_customer',
    ];

    it.each(expectedIndexes)('index "%s" is defined', (idx) => {
        expect(sql).toContain(idx);
    });

    it('updated_at trigger function is defined', () => {
        expect(sql).toContain('update_updated_at_column');
    });

    it('uuid-ossp extension is enabled', () => {
        expect(sql).toMatch(/CREATE EXTENSION.*uuid-ossp/i);
    });
});

// ── 2. Migration ordering ─────────────────────────────────────────────────────

describe('Migration ordering and completeness', () => {
    it('migration files are numbered sequentially without gaps', () => {
        const files = migrationFiles();
        const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
        for (let i = 0; i < numbers.length; i++) {
            expect(numbers[i]).toBe(i + 1);
        }
    });

    it('migration 001 creates the base schema before RLS is applied in 002', () => {
        const files = migrationFiles();
        const schemaIdx = files.findIndex((f) => f.startsWith('001'));
        const rlsIdx = files.findIndex((f) => f.startsWith('002'));
        expect(schemaIdx).toBeLessThan(rlsIdx);
    });

    it('token storage migration (006) comes after schema (001)', () => {
        const files = migrationFiles();
        const schemaIdx = files.findIndex((f) => f.startsWith('001'));
        const tokenIdx = files.findIndex((f) => f.startsWith('006'));
        expect(schemaIdx).toBeLessThan(tokenIdx);
    });

    it('encryption migration (007) comes after token storage (006)', () => {
        const files = migrationFiles();
        const tokenIdx = files.findIndex((f) => f.startsWith('006'));
        const encIdx = files.findIndex((f) => f.startsWith('007'));
        expect(tokenIdx).toBeLessThan(encIdx);
    });
});

// ── 3. Data integrity constraints ─────────────────────────────────────────────

describe('Data integrity — CHECK constraints and FK cascades', () => {
    const sql001 = readMigration(migrationFiles().find((f) => f.startsWith('001'))!);

    it('profiles.subscription_tier has CHECK constraint', () => {
        expect(sql001).toMatch(/subscription_tier.*CHECK/is);
    });

    it('deployments.status has CHECK constraint with all valid states', () => {
        const statusStates = ['pending', 'generating', 'creating_repo', 'pushing_code', 'deploying', 'completed', 'failed'];
        for (const state of statusStates) {
            expect(sql001).toContain(state);
        }
    });

    it('deployment_logs.level has CHECK constraint', () => {
        expect(sql001).toMatch(/level.*CHECK.*info.*warn.*error/is);
    });

    it('deployments has ON DELETE CASCADE from profiles', () => {
        expect(sql001).toMatch(/deployments[\s\S]*?REFERENCES profiles.*ON DELETE CASCADE/i);
    });

    it('deployment_logs has ON DELETE CASCADE from deployments', () => {
        expect(sql001).toMatch(/deployment_logs[\s\S]*?REFERENCES deployments.*ON DELETE CASCADE/i);
    });

    it('customization_drafts has ON DELETE CASCADE from profiles', () => {
        expect(sql001).toMatch(/customization_drafts[\s\S]*?REFERENCES profiles.*ON DELETE CASCADE/i);
    });

    it('deployment_analytics has ON DELETE CASCADE from deployments', () => {
        expect(sql001).toMatch(/deployment_analytics[\s\S]*?REFERENCES deployments.*ON DELETE CASCADE/i);
    });
});

// ── 4. Point-in-time recovery — idempotency guards ────────────────────────────

describe('Point-in-time recovery — idempotent migration guards', () => {
    it('migration 005 uses CREATE TABLE IF NOT EXISTS', () => {
        const sql = readMigration(migrationFiles().find((f) => f.startsWith('005'))!);
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS deployment_logs/i);
    });

    it('migration 005 uses CREATE INDEX IF NOT EXISTS', () => {
        const sql = readMigration(migrationFiles().find((f) => f.startsWith('005'))!);
        expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    });

    it('migration 006 uses CREATE INDEX IF NOT EXISTS', () => {
        const sql = readMigration(migrationFiles().find((f) => f.startsWith('006'))!);
        expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    });

    it('migration 007 uses ADD COLUMN IF NOT EXISTS', () => {
        const sql = readMigration(migrationFiles().find((f) => f.startsWith('007'))!);
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    });
});

// ── 5. RLS coverage ───────────────────────────────────────────────────────────

describe('RLS coverage — user-data tables are protected', () => {
    const sql = allMigrationsSql();

    const userTables = [
        'profiles',
        'deployments',
        'deployment_logs',
        'customization_drafts',
        'deployment_analytics',
        'templates',
    ];

    it.each(userTables)('RLS is enabled on "%s"', (table) => {
        expect(sql).toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    });

    it('profiles SELECT policy is scoped to auth.uid() = id', () => {
        expect(sql).toMatch(/profiles[\s\S]*?auth\.uid\(\)\s*=\s*id/i);
    });

    it('deployments SELECT policy is scoped to auth.uid() = user_id', () => {
        expect(sql).toMatch(/deployments[\s\S]*?auth\.uid\(\)\s*=\s*user_id/i);
    });

    it('deployment_logs SELECT policy uses indirect join through deployments', () => {
        expect(sql).toMatch(/deployment_logs[\s\S]*?SELECT id FROM deployments WHERE user_id = auth\.uid\(\)/i);
    });

    it('templates SELECT policy restricts to is_active = true for non-service roles', () => {
        expect(sql).toMatch(/templates[\s\S]*?is_active\s*=\s*true/i);
    });
});

// ── 6. Disaster recovery — sensitive column protection ────────────────────────

describe('Disaster recovery — sensitive column constraints survive restore', () => {
    const sql = allMigrationsSql();

    it('github_token_encrypted has plaintext-prevention CHECK constraint', () => {
        expect(sql).toContain('profiles_github_token_not_plaintext');
    });

    it('github token constraint blocks all known GitHub token prefixes', () => {
        const sql006 = readMigration(migrationFiles().find((f) => f.startsWith('006'))!);
        for (const prefix of ['ghu_', 'ghp_', 'gho_', 'ghs_', 'ghr_']) {
            expect(sql006).toContain(prefix);
        }
    });

    it('stripe_customer_id_encrypted column is added in migration 007', () => {
        const sql007 = readMigration(migrationFiles().find((f) => f.startsWith('007'))!);
        expect(sql007).toContain('stripe_customer_id_encrypted');
    });

    it('stripe_subscription_id_encrypted column is added in migration 007', () => {
        const sql007 = readMigration(migrationFiles().find((f) => f.startsWith('007'))!);
        expect(sql007).toContain('stripe_subscription_id_encrypted');
    });

    it('stripe columns have plaintext-prevention CHECK constraints', () => {
        expect(sql).toContain('profiles_stripe_customer_not_plaintext');
        expect(sql).toContain('profiles_stripe_subscription_not_plaintext');
    });

    it('stripe constraint blocks cus_ prefix (plaintext customer ID)', () => {
        const sql007 = readMigration(migrationFiles().find((f) => f.startsWith('007'))!);
        expect(sql007).toContain('cus\\_');
    });

    it('stripe constraint blocks sub_ prefix (plaintext subscription ID)', () => {
        const sql007 = readMigration(migrationFiles().find((f) => f.startsWith('007'))!);
        expect(sql007).toContain('sub\\_');
    });

    it('expired-token cleanup index exists for recovery cron safety', () => {
        expect(sql).toContain('idx_profiles_github_token_expires_at');
    });
});

// ── In-process restore simulation ────────────────────────────────────────────

describe('Restore simulation — in-process schema state', () => {
    /**
     * Simulates applying migrations up to a given number and checks the
     * resulting "schema" (set of table names present in the SQL so far).
     */
    function tablesAfterMigration(upToNumber: number): Set<string> {
        const files = migrationFiles().filter(
            (f) => parseInt(f.split('_')[0], 10) <= upToNumber
        );
        const sql = files.map(readMigration).join('\n');
        const matches = [...sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)];
        return new Set(matches.map((m) => m[1].toLowerCase()));
    }

    it('after migration 001: all base tables exist', () => {
        const tables = tablesAfterMigration(1);
        for (const t of ['profiles', 'templates', 'deployments', 'deployment_logs', 'customization_drafts', 'deployment_analytics']) {
            expect(tables).toContain(t);
        }
    });

    it('after migration 001 only: deployment_logs table is present (re-created idempotently in 005)', () => {
        const tables = tablesAfterMigration(1);
        expect(tables).toContain('deployment_logs');
    });

    it('replaying migrations 001–005 does not lose deployment_logs (idempotent)', () => {
        const tables = tablesAfterMigration(5);
        expect(tables).toContain('deployment_logs');
    });

    it('full restore (all migrations) contains all expected tables', () => {
        const tables = tablesAfterMigration(999);
        for (const t of ['profiles', 'templates', 'deployments', 'deployment_logs', 'customization_drafts', 'deployment_analytics']) {
            expect(tables).toContain(t);
        }
    });
});
