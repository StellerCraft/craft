/**
 * Job queue / DLQ migration chain — apply-order integration test (issue #1336)
 *
 * The following migrations form a dependency chain:
 *
 *   *_github_webhook_delivery_tracking.sql
 *     → *_job_queue.sql            (job_queue, job_dlq, job_priority, job_status)
 *     → *_job_queue_claim_rpc.sql  (claim_next_job() — reads/writes job_queue)
 *     → *_dlq_reprocess_atomicity.sql (ALTER TABLE job_dlq)
 *
 * The 014_ prefix is shared with several unrelated migrations, so a general
 * renumbering fix could accidentally move *_job_queue_claim_rpc.sql ahead of
 * *_job_queue.sql. Files are located by suffix (not by number) so this test
 * keeps guarding the chain after any renumbering.
 *
 * No Postgres instance is available in the unit-test environment, so the chain
 * is "applied" in isolation against a lightweight schema model: every
 * CREATE TYPE / TABLE / FUNCTION registers an object, and every object a
 * migration depends on must already be registered when that migration runs.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../supabase/migrations');

/** Chain members in required apply order, identified by filename suffix. */
const CHAIN_SUFFIXES = [
  '_github_webhook_delivery_tracking.sql',
  '_job_queue.sql',
  '_job_queue_claim_rpc.sql',
  '_dlq_reprocess_atomicity.sql',
] as const;

/**
 * Objects each chain member relies on that must already exist when it runs.
 * update_updated_at_column() comes from 001_initial_schema.sql, outside the chain.
 */
const REQUIRED_BEFORE: Record<(typeof CHAIN_SUFFIXES)[number], string[]> = {
  '_github_webhook_delivery_tracking.sql': ['function:update_updated_at_column'],
  '_job_queue.sql': ['function:update_updated_at_column'],
  '_job_queue_claim_rpc.sql': ['table:job_queue'],
  '_dlq_reprocess_atomicity.sql': ['table:job_dlq'],
};

/** Objects provided by earlier, non-chain migrations (the isolation prelude). */
const PRELUDE_OBJECTS = ['function:update_updated_at_column'];

function listMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Filename with its numeric prefix removed, e.g. `014_job_queue.sql` → `_job_queue.sql`. */
function suffixOf(file: string): string {
  return file.replace(/^\d+/, '');
}

function findChainFiles(): string[] {
  const all = listMigrations();
  return CHAIN_SUFFIXES.map((suffix) => {
    const matches = all.filter((f) => suffixOf(f) === suffix);
    expect(matches, `expected exactly one migration ending in ${suffix}`).toHaveLength(1);
    return matches[0];
  });
}

function readMigration(file: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

/** Objects a migration creates, keyed as `<kind>:<name>`. */
function createdObjects(sql: string): string[] {
  const body = stripComments(sql);
  const objects: string[] = [];
  const patterns: [string, RegExp][] = [
    ['type', /CREATE\s+TYPE\s+(\w+)/gi],
    ['table', /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi],
    ['view', /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)/gi],
    ['function', /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)/gi],
  ];
  for (const [kind, re] of patterns) {
    for (const match of body.matchAll(re)) objects.push(`${kind}:${match[1].toLowerCase()}`);
  }
  return objects;
}

/** Applies the given files in order against an in-memory schema model. */
function applyChain(files: string[], prelude: string[]): Set<string> {
  const schema = new Set(prelude);
  files.forEach((file) => {
    const suffix = suffixOf(file) as (typeof CHAIN_SUFFIXES)[number];
    for (const dependency of REQUIRED_BEFORE[suffix]) {
      if (!schema.has(dependency)) {
        throw new Error(`${file} requires ${dependency}, which does not exist yet`);
      }
    }
    for (const obj of createdObjects(readMigration(file))) schema.add(obj);
  });
  return schema;
}

describe('job queue / DLQ migration chain (issue #1336)', () => {
  it('resolves each chain member to exactly one migration file', () => {
    expect(findChainFiles()).toHaveLength(CHAIN_SUFFIXES.length);
  });

  it('assigns strictly ascending numeric prefixes in dependency order', () => {
    const prefixes = findChainFiles().map((f) => Number.parseInt(f.split('_')[0], 10));
    for (let i = 1; i < prefixes.length; i++) {
      expect(prefixes[i], `${CHAIN_SUFFIXES[i]} must be numbered after ${CHAIN_SUFFIXES[i - 1]}`)
        .toBeGreaterThan(prefixes[i - 1]);
    }
  });

  it('is applied in dependency order by the lexicographic migration runner', () => {
    const all = listMigrations();
    const positions = findChainFiles().map((f) => all.indexOf(f));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('applies the four-migration chain in isolation', () => {
    const files = findChainFiles();
    let schema: Set<string> | undefined;
    expect(() => {
      schema = applyChain(files, PRELUDE_OBJECTS);
    }).not.toThrow();

    expect(schema).toBeDefined();
    for (const obj of [
      'table:github_webhook_deliveries',
      'type:job_priority',
      'type:job_status',
      'table:job_queue',
      'table:job_dlq',
      'function:claim_next_job',
    ]) {
      expect(schema!.has(obj), `expected ${obj} after applying the chain`).toBe(true);
    }
  });

  it('fails to apply if the claim RPC runs before the job queue table exists', () => {
    const [delivery, jobQueue, claimRpc, reprocess] = findChainFiles();
    const misordered = [delivery, claimRpc, jobQueue, reprocess];
    expect(() => applyChain(misordered, PRELUDE_OBJECTS)).toThrow(/requires table:job_queue/);
  });

  it('cross-references every other chain member in each file header', () => {
    const files = findChainFiles();
    for (const file of files) {
      const header = readMigration(file).split('\n').slice(0, 12).join('\n');
      expect(header).toMatch(/Dependency chain: job queue \/ DLQ/);
      for (const other of files) {
        expect(header, `${file} header should reference ${other}`).toContain(other);
      }
    }
  });
});
