/**
 * Integration tests: blue-green alias lineage across soft-delete and restore (#1322)
 *
 * Migration 010_vercel_blue_green_aliases.sql adds three alias-lineage columns
 * to `deployments` (staging_deployment_id, production_deployment_id,
 * previous_production_deployment_id), persisted by the alias-lineage fix (#995)
 * in DeploymentUpdateService.persistDeploymentState().
 *
 * Documented behavior (see the comment in ./route.ts):
 *   - Soft-delete only stamps `deleted_at`; alias lineage is left untouched.
 *   - Restore only clears `deleted_at`; alias lineage is PRESERVED exactly as it
 *     was at deletion time — it is neither reset nor partially rewritten.
 *   - A restore attempt outside the retention window is rejected with 410 and
 *     leaves the tombstoned row (including its alias lineage) byte-for-byte
 *     unchanged.
 *
 * The Supabase client is replaced with a small in-memory `deployments` table so
 * the DELETE → RESTORE sequence runs through both real route handlers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

type Row = Record<string, any>;

const USER_ID = 'user-blue-green';
const DEPLOYMENT_ID = 'dep-blue-green-1';

const table = new Map<string, Row>();
const auditCalls: unknown[] = [];

/** Minimal chainable query builder over the in-memory `deployments` table. */
function makeQuery() {
    const filters: Array<(row: Row) => boolean> = [];
    let pendingUpdate: Row | null = null;

    const matching = () => [...table.values()].filter((row) => filters.every((f) => f(row)));

    const builder: any = {
        select: () => builder,
        eq: (col: string, value: unknown) => {
            filters.push((row) => row[col] === value);
            return builder;
        },
        is: (col: string, value: unknown) => {
            filters.push((row) => (value === null ? row[col] == null : row[col] === value));
            return builder;
        },
        not: (col: string, op: string, value: unknown) => {
            if (op === 'is' && value === null) filters.push((row) => row[col] != null);
            return builder;
        },
        update: (payload: Row) => {
            pendingUpdate = payload;
            return builder;
        },
        single: async () => {
            const rows = matching();
            if (rows.length !== 1) return { data: null, error: { message: 'not found' } };
            return { data: { ...rows[0] }, error: null };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
            if (pendingUpdate) {
                for (const row of matching()) Object.assign(row, pendingUpdate);
            }
            return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
    };
    return builder;
}

const supabaseMock = { from: (_table: string) => makeQuery() };

vi.mock('@/lib/api/with-auth', () => ({
    withAuth: (handler: Function) => async (req: NextRequest, ctx: { params: unknown }) =>
        handler(req, {
            params: ctx.params,
            user: { id: USER_ID },
            supabase: supabaseMock,
            correlationId: 'corr-1',
            log: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                audit: (entry: unknown) => auditCalls.push(entry),
            },
        }),
}));

vi.mock('@/lib/api/logger', () => ({
    resolveIpAddress: () => '127.0.0.1',
}));

vi.mock('@/services/github.service', () => ({
    githubService: { deleteRepository: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/services/vercel.service', () => ({
    vercelService: { deleteProject: vi.fn().mockResolvedValue(undefined) },
}));

const DAY_MS = 24 * 60 * 60 * 1000;

const ALIAS_LINEAGE = {
    staging_deployment_id: 'vercel-dpl-staging-3',
    production_deployment_id: 'vercel-dpl-prod-2',
    previous_production_deployment_id: 'vercel-dpl-prod-1',
} as const;

function seedDeployment(overrides: Row = {}): Row {
    const row: Row = {
        id: DEPLOYMENT_ID,
        user_id: USER_ID,
        name: 'blue-green-app',
        status: 'completed',
        repository_url: null,
        vercel_project_id: null,
        deleted_at: null,
        ...ALIAS_LINEAGE,
        ...overrides,
    };
    table.set(row.id, row);
    return row;
}

function aliasState(row: Row) {
    return {
        staging_deployment_id: row.staging_deployment_id,
        production_deployment_id: row.production_deployment_id,
        previous_production_deployment_id: row.previous_production_deployment_id,
    };
}

async function callRestore(): Promise<NextResponse> {
    const { POST } = await import('./route');
    const req = new NextRequest(`http://localhost/api/deployments/${DEPLOYMENT_ID}/restore`, {
        method: 'POST',
    });
    return (POST as any)(req, { params: { id: DEPLOYMENT_ID } });
}

async function callSoftDelete(): Promise<NextResponse> {
    const { DELETE } = await import('../route');
    const req = new NextRequest(`http://localhost/api/deployments/${DEPLOYMENT_ID}`, {
        method: 'DELETE',
    });
    return (DELETE as any)(req, { params: { id: DEPLOYMENT_ID } });
}

describe('POST /api/deployments/[id]/restore — blue-green alias lineage (#1322)', () => {
    beforeEach(() => {
        table.clear();
        auditCalls.length = 0;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('within the retention window', () => {
        it('soft-delete leaves alias lineage untouched and only stamps deleted_at', async () => {
            seedDeployment();

            const res = await callSoftDelete();
            expect(res.status).toBe(200);

            const row = table.get(DEPLOYMENT_ID)!;
            expect(row.deleted_at).toEqual(expect.any(String));
            expect(aliasState(row)).toEqual(ALIAS_LINEAGE);
        });

        it('restores the deployment with its full alias lineage preserved (not reset)', async () => {
            seedDeployment();

            expect((await callSoftDelete()).status).toBe(200);
            const res = await callRestore();

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ success: true, deploymentId: DEPLOYMENT_ID });

            const row = table.get(DEPLOYMENT_ID)!;
            expect(row.deleted_at).toBeNull();
            expect(aliasState(row)).toEqual(ALIAS_LINEAGE);
        });

        it('never leaves the lineage in a partial state (every column restored or none reset)', async () => {
            seedDeployment();
            await callSoftDelete();
            await callRestore();

            const lineage = aliasState(table.get(DEPLOYMENT_ID)!);
            const values = Object.values(lineage);
            // Either the whole lineage is intact, or (intentional reset) all null — never mixed.
            const allPreserved = values.every((v) => v !== null && v !== undefined);
            const allReset = values.every((v) => v === null);
            expect(allPreserved || allReset).toBe(true);
            // The documented contract is "preserve".
            expect(allPreserved).toBe(true);
        });

        it('preserves a post-rollback lineage (staging cleared) exactly as it was', async () => {
            // Shape written by DeploymentUpdateService.rollbackUpdate(): staging nulled.
            const rolledBack = {
                staging_deployment_id: null,
                production_deployment_id: 'vercel-dpl-prod-1',
                previous_production_deployment_id: 'vercel-dpl-prod-1',
            };
            seedDeployment(rolledBack);

            await callSoftDelete();
            const res = await callRestore();

            expect(res.status).toBe(200);
            expect(aliasState(table.get(DEPLOYMENT_ID)!)).toEqual(rolledBack);
        });

        it('restore update payload only touches deleted_at', async () => {
            const tombstonedAt = new Date(Date.now() - 1 * DAY_MS).toISOString();
            seedDeployment({ deleted_at: tombstonedAt });
            const before = { ...table.get(DEPLOYMENT_ID)! };

            const res = await callRestore();
            expect(res.status).toBe(200);

            const after = table.get(DEPLOYMENT_ID)!;
            expect({ ...after, deleted_at: before.deleted_at }).toEqual(before);
            expect(auditCalls).toHaveLength(1);
            expect(auditCalls[0]).toMatchObject({
                action: 'deployment.restore',
                resourceId: DEPLOYMENT_ID,
                metadata: { deletedAt: tombstonedAt },
            });
        });
    });

    describe('outside the retention window (negative case)', () => {
        it('rejects with 410 and leaves the tombstone and alias lineage unchanged', async () => {
            const retentionDays = parseInt(process.env.DEPLOYMENT_TOMBSTONE_RETENTION_DAYS ?? '30', 10);
            const tombstonedAt = new Date(Date.now() - (retentionDays + 1) * DAY_MS).toISOString();
            seedDeployment({ deleted_at: tombstonedAt });
            const before = { ...table.get(DEPLOYMENT_ID)! };

            const res = await callRestore();

            expect(res.status).toBe(410);
            const after = table.get(DEPLOYMENT_ID)!;
            expect(after).toEqual(before);
            expect(after.deleted_at).toBe(tombstonedAt);
            expect(aliasState(after)).toEqual(ALIAS_LINEAGE);
            expect(auditCalls).toHaveLength(0);
        });

        it('a deployment soft-deleted and aged past retention cannot be restored', async () => {
            seedDeployment();
            await callSoftDelete();

            const retentionDays = parseInt(process.env.DEPLOYMENT_TOMBSTONE_RETENTION_DAYS ?? '30', 10);
            vi.useFakeTimers();
            vi.setSystemTime(Date.now() + (retentionDays + 1) * DAY_MS);

            const res = await callRestore();

            expect(res.status).toBe(410);
            const row = table.get(DEPLOYMENT_ID)!;
            expect(row.deleted_at).not.toBeNull();
            expect(aliasState(row)).toEqual(ALIAS_LINEAGE);
        });
    });
});
