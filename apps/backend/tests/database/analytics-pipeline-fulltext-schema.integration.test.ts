/**
 * Combined schema coverage for the co-numbered 016 migrations (#1324)
 *
 * WHY THIS PAIRING EXISTS: supabase/migrations/016_analytics_rollups.sql and
 * supabase/migrations/016_template_fulltext_search.sql share the numeric
 * prefix 016, so their relative apply order is decided only by filename sort.
 * Per-migration tests would not notice if the two ever defined an object with
 * the same name (index, constraint, trigger, function, policy) or touched each
 * other's tables. This file exercises both together:
 *
 *   1. Static collision check (always runs): parses both migration files and
 *      asserts no named database object is defined by both.
 *   2. Live schema check (runs when NEXT_PUBLIC_SUPABASE_URL and
 *      SUPABASE_SERVICE_ROLE_KEY point at a database with all migrations
 *      applied): runs a representative analytics-rollup query (admin analytics
 *      dashboard) and a representative fulltext search (template catalog)
 *      against the same applied schema.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

const MIGRATIONS_DIR = join(__dirname, '../../../../supabase/migrations');
const ROLLUPS_FILE = '016_analytics_rollups.sql';
const FULLTEXT_FILE = '016_template_fulltext_search.sql';

type ObjectKind = 'table' | 'index' | 'constraint' | 'trigger' | 'function' | 'policy';

interface SchemaObjects {
    names: Map<ObjectKind, Set<string>>;
    /** Tables this migration creates or alters. */
    touchedTables: Set<string>;
}

/** Removes `-- ...` line comments so commented-out rollback DDL is ignored. */
function stripComments(sql: string): string {
    return sql.replace(/--.*$/gm, '');
}

function parseSchemaObjects(sql: string): SchemaObjects {
    const body = stripComments(sql);
    const names = new Map<ObjectKind, Set<string>>(
        (['table', 'index', 'constraint', 'trigger', 'function', 'policy'] as ObjectKind[]).map((k) => [k, new Set()]),
    );
    const touchedTables = new Set<string>();

    const collect = (kind: ObjectKind, re: RegExp, group = 1) => {
        for (const m of body.matchAll(re)) names.get(kind)!.add(m[group].replace(/"/g, '').toLowerCase());
    };

    collect('table', /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi);
    collect('index', /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/gi);
    collect('constraint', /CONSTRAINT\s+([\w."]+)/gi);
    collect('trigger', /CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+([\w."]+)/gi);
    collect('function', /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)/gi);
    // Policy names are scoped per table, so key them as "<table>:<policy>".
    for (const m of body.matchAll(/CREATE\s+POLICY\s+("[^"]+"|\w+)\s+ON\s+([\w."]+)/gi)) {
        names.get('policy')!.add(`${m[2].toLowerCase()}:${m[1].replace(/"/g, '').toLowerCase()}`);
    }

    for (const m of body.matchAll(/(?:CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?|ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?|CREATE\s+(?:UNIQUE\s+)?INDEX\s+[\s\S]*?\bON\s+)([\w."]+)/gi)) {
        touchedTables.add(m[1].replace(/"/g, '').toLowerCase());
    }

    return { names, touchedTables };
}

function loadMigration(file: string): SchemaObjects {
    return parseSchemaObjects(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
}

describe('016 co-numbered migrations: analytics rollups + template fulltext search (#1324)', () => {
    const rollups = loadMigration(ROLLUPS_FILE);
    const fulltext = loadMigration(FULLTEXT_FILE);

    describe('static name-collision check', () => {
        it('parses the objects each migration is known to define', () => {
            expect(rollups.names.get('table')).toEqual(new Set(['analytics_rollups', 'rollup_cursors']));
            expect(rollups.names.get('index')).toContain('analytics_rollups_deployment_idx');
            expect(fulltext.names.get('index')).toContain('idx_templates_search_vector');
            expect(fulltext.names.get('function')).toContain('search_templates');
        });

        it.each(['table', 'index', 'constraint', 'trigger', 'function', 'policy'] as ObjectKind[])(
            'defines no %s name in both migrations',
            (kind) => {
                const shared = [...rollups.names.get(kind)!].filter((n) => fulltext.names.get(kind)!.has(n));
                expect(shared).toEqual([]);
            },
        );

        it('index names are unique across both migrations regardless of object kind', () => {
            // Postgres indexes share a namespace with tables/sequences/views, so
            // also check indexes against the other migration's tables.
            const relationsA = new Set([...rollups.names.get('index')!, ...rollups.names.get('table')!]);
            const relationsB = new Set([...fulltext.names.get('index')!, ...fulltext.names.get('table')!]);
            expect([...relationsA].filter((n) => relationsB.has(n))).toEqual([]);
        });

        it('neither migration touches the other migration\'s tables', () => {
            expect(rollups.touchedTables.has('templates')).toBe(false);
            for (const table of rollups.names.get('table')!) {
                expect(fulltext.touchedTables.has(table)).toBe(false);
            }
        });
    });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const hasDatabase = Boolean(supabaseUrl && serviceKey);

    describe.skipIf(!hasDatabase)('live schema with both migrations applied', () => {
        let supabase: ReturnType<typeof createClient>;

        beforeAll(() => {
            supabase = createClient(supabaseUrl, serviceKey);
        });

        it('runs a representative analytics-rollup dashboard query', async () => {
            const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const { data, error } = await supabase
                .from('analytics_rollups')
                .select('deployment_id, metric_type, bucket_start, granularity, total_value, record_count, up_count')
                .eq('granularity', '24h')
                .gte('bucket_start', since)
                .order('bucket_start', { ascending: false })
                .limit(50);

            expect(error).toBeNull();
            expect(Array.isArray(data)).toBe(true);
        });

        it('has both rollup cursors seeded', async () => {
            const { data, error } = await supabase
                .from('rollup_cursors')
                .select('granularity')
                .in('granularity', ['1h', '24h']);

            expect(error).toBeNull();
            expect((data ?? []).map((r: any) => r.granularity).sort()).toEqual(['1h', '24h']);
        });

        it('runs a representative template-catalog fulltext search', async () => {
            const { data, error } = await supabase.rpc('search_templates', {
                p_query: 'stellar',
                p_category: null,
                p_limit: 20,
                p_offset: 0,
            });

            expect(error).toBeNull();
            expect(Array.isArray(data)).toBe(true);
            for (const row of (data ?? []) as any[]) {
                expect(row.is_active).toBe(true);
                expect(Array.isArray(row.tags)).toBe(true);
            }
        });

        it('fulltext search still works after querying rollups in the same session', async () => {
            const rollup = await supabase.from('analytics_rollups').select('id').limit(1);
            const search = await supabase.rpc('search_templates', { p_query: 'payment gateway' });

            expect(rollup.error).toBeNull();
            expect(search.error).toBeNull();
        });
    });
});
