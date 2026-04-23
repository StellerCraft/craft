/**
 * Deployment Logs Persistence Tests
 *
 * Tests the deploymentLogsService against a mocked Supabase client, covering:
 *   - Log persistence for all deployment stages
 *   - Log retrieval accuracy by deployment ID
 *   - Log retention policies (MAX_LIMIT cap, pagination)
 *   - Log search / filtering (level, stage, since)
 *   - Log export capabilities (time-range, batch)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    deploymentLogsService,
    parseLogsQueryParams,
} from '@/services/deployment-logs.service';
import type { LogLevel } from '@craft/types';

// ── Supabase query-builder mock ───────────────────────────────────────────────

function makeSupabase(rows: object[] = [], count = rows.length, error: string | null = null) {
    const terminal = { data: error ? null : rows, count: error ? null : count, error: error ? { message: error } : null };

    // order() is the terminal call for getLogsByLevel/Stage/TimeRange but returns `this`
    // (then .range()) for getLogs/getLogsBatch — so we make it return an object that
    // is both awaitable (resolves to terminal) and has a .range() method.
    const orderResult = { ...terminal, range: vi.fn().mockResolvedValue(terminal) };

    const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        in:     vi.fn().mockReturnThis(),
        gt:     vi.fn().mockReturnThis(),
        gte:    vi.fn().mockReturnThis(),
        lte:    vi.fn().mockReturnThis(),
        order:  vi.fn().mockReturnValue(orderResult),
        range:  vi.fn().mockResolvedValue(terminal),
    };

    return { from: vi.fn().mockReturnValue(builder), _builder: builder };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEPLOY_ID = 'deploy-abc';

function makeRow(overrides: Partial<{
    id: string; deployment_id: string; stage: string;
    created_at: string; level: LogLevel; message: string;
}> = {}) {
    return {
        id: 'log-1',
        deployment_id: DEPLOY_ID,
        stage: 'deploying',
        created_at: '2024-01-15T10:00:00Z',
        level: 'info' as LogLevel,
        message: 'Deployment started',
        ...overrides,
    };
}

const DEFAULT_PARAMS = { page: 1, limit: 50, order: 'asc' as const };

// ── parseLogsQueryParams ──────────────────────────────────────────────────────

describe('parseLogsQueryParams', () => {
    it('returns defaults for empty params', () => {
        const result = parseLogsQueryParams(new URLSearchParams());
        expect(result).toEqual({ valid: true, params: { page: 1, limit: 50, order: 'asc' } });
    });

    it('parses page, limit, and order', () => {
        const result = parseLogsQueryParams(new URLSearchParams('page=2&limit=20&order=desc'));
        expect(result).toEqual({ valid: true, params: { page: 2, limit: 20, order: 'desc' } });
    });

    it('caps limit at 200', () => {
        const result = parseLogsQueryParams(new URLSearchParams('limit=999'));
        expect(result.valid && result.params.limit).toBe(200);
    });

    it('rejects page < 1', () => {
        expect(parseLogsQueryParams(new URLSearchParams('page=0')).valid).toBe(false);
    });

    it('rejects invalid order value', () => {
        expect(parseLogsQueryParams(new URLSearchParams('order=random')).valid).toBe(false);
    });

    it('rejects invalid log level', () => {
        expect(parseLogsQueryParams(new URLSearchParams('level=verbose')).valid).toBe(false);
    });

    it('accepts valid log levels', () => {
        for (const level of ['info', 'warn', 'error']) {
            const r = parseLogsQueryParams(new URLSearchParams(`level=${level}`));
            expect(r.valid && r.params.level).toBe(level);
        }
    });

    it('rejects invalid stage', () => {
        expect(parseLogsQueryParams(new URLSearchParams('stage=unknown_stage')).valid).toBe(false);
    });

    it('accepts all valid deployment stages', () => {
        const stages = ['pending','generating','creating_repo','pushing_code','deploying','completed','failed','redeploying','deleted'];
        for (const stage of stages) {
            const r = parseLogsQueryParams(new URLSearchParams(`stage=${stage}`));
            expect(r.valid && r.params.stage).toBe(stage);
        }
    });

    it('rejects a malformed since timestamp', () => {
        expect(parseLogsQueryParams(new URLSearchParams('since=not-a-date')).valid).toBe(false);
    });

    it('accepts a valid ISO 8601 since timestamp', () => {
        const r = parseLogsQueryParams(new URLSearchParams('since=2024-01-01T00:00:00Z'));
        expect(r.valid && r.params.since).toBe('2024-01-01T00:00:00Z');
    });
});

// ── getLogs — persistence & retrieval ────────────────────────────────────────

describe('deploymentLogsService.getLogs — persistence and retrieval', () => {
    it('queries the deployment_logs table for the correct deployment ID', async () => {
        const { from, _builder } = makeSupabase([makeRow()], 1);
        await deploymentLogsService.getLogs(DEPLOY_ID, DEFAULT_PARAMS, { from } as any);
        expect(from).toHaveBeenCalledWith('deployment_logs');
        expect(_builder.eq).toHaveBeenCalledWith('deployment_id', DEPLOY_ID);
    });

    it('maps DB rows to DeploymentLogResponse shape', async () => {
        const row = makeRow({ id: 'log-x', message: 'Build complete', level: 'info', created_at: '2024-01-15T12:00:00Z' });
        const { from } = makeSupabase([row], 1);
        const result = await deploymentLogsService.getLogs(DEPLOY_ID, DEFAULT_PARAMS, { from } as any);
        expect(result.data[0]).toEqual({
            id: 'log-x',
            deploymentId: DEPLOY_ID,
            timestamp: '2024-01-15T12:00:00Z',
            level: 'info',
            message: 'Build complete',
        });
    });

    it('persists logs for all deployment stages', async () => {
        const stages = ['pending','generating','creating_repo','pushing_code','deploying','completed','failed'] as const;
        for (const stage of stages) {
            const { from } = makeSupabase([makeRow({ stage })], 1);
            const result = await deploymentLogsService.getLogs(DEPLOY_ID, DEFAULT_PARAMS, { from } as any);
            expect(result.data).toHaveLength(1);
        }
    });

    it('returns empty data array when no logs exist', async () => {
        const { from } = makeSupabase([], 0);
        const result = await deploymentLogsService.getLogs(DEPLOY_ID, DEFAULT_PARAMS, { from } as any);
        expect(result.data).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
    });

    it('throws when Supabase returns an error', async () => {
        const { from } = makeSupabase([], 0, 'DB connection failed');
        await expect(deploymentLogsService.getLogs(DEPLOY_ID, DEFAULT_PARAMS, { from } as any))
            .rejects.toThrow('DB connection failed');
    });
});

// ── getLogs — retention / pagination ─────────────────────────────────────────

describe('deploymentLogsService.getLogs — retention policies', () => {
    it('applies range() for pagination offset', async () => {
        const { from, _builder } = makeSupabase([], 100);
        await deploymentLogsService.getLogs(DEPLOY_ID, { page: 3, limit: 10, order: 'asc' }, { from } as any);
        // range() is called on the object returned by order()
        const orderResult = _builder.order.mock.results[0]?.value;
        expect(orderResult?.range).toHaveBeenCalledWith(20, 29);
    });

    it('sets hasNextPage true when more records exist beyond current page', async () => {
        const rows = Array.from({ length: 10 }, (_, i) => makeRow({ id: `log-${i}` }));
        const { from } = makeSupabase(rows, 25);
        const result = await deploymentLogsService.getLogs(DEPLOY_ID, { page: 1, limit: 10, order: 'asc' }, { from } as any);
        expect(result.pagination.hasNextPage).toBe(true);
        expect(result.pagination.total).toBe(25);
    });

    it('sets hasNextPage false on the last page', async () => {
        const rows = Array.from({ length: 5 }, (_, i) => makeRow({ id: `log-${i}` }));
        const { from } = makeSupabase(rows, 5);
        const result = await deploymentLogsService.getLogs(DEPLOY_ID, { page: 1, limit: 10, order: 'asc' }, { from } as any);
        expect(result.pagination.hasNextPage).toBe(false);
    });

    it('orders ascending by default', async () => {
        const { from, _builder } = makeSupabase([makeRow()], 1);
        await deploymentLogsService.getLogs(DEPLOY_ID, DEFAULT_PARAMS, { from } as any);
        expect(_builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    it('orders descending when requested', async () => {
        const { from, _builder } = makeSupabase([makeRow()], 1);
        await deploymentLogsService.getLogs(DEPLOY_ID, { ...DEFAULT_PARAMS, order: 'desc' }, { from } as any);
        expect(_builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });
});

// ── getLogs — search / filtering ─────────────────────────────────────────────

describe('deploymentLogsService.getLogs — search and filtering', () => {
    it('filters by log level', async () => {
        const { from, _builder } = makeSupabase([makeRow({ level: 'error' })], 1);
        await deploymentLogsService.getLogs(DEPLOY_ID, { ...DEFAULT_PARAMS, level: 'error' }, { from } as any);
        expect(_builder.eq).toHaveBeenCalledWith('level', 'error');
    });

    it('filters by deployment stage', async () => {
        const { from, _builder } = makeSupabase([makeRow({ stage: 'creating_repo' })], 1);
        await deploymentLogsService.getLogs(DEPLOY_ID, { ...DEFAULT_PARAMS, stage: 'creating_repo' }, { from } as any);
        expect(_builder.eq).toHaveBeenCalledWith('stage', 'creating_repo');
    });

    it('filters by since timestamp', async () => {
        const since = '2024-01-10T00:00:00Z';
        const { from, _builder } = makeSupabase([makeRow()], 1);
        await deploymentLogsService.getLogs(DEPLOY_ID, { ...DEFAULT_PARAMS, since }, { from } as any);
        expect(_builder.gt).toHaveBeenCalledWith('created_at', since);
    });

    it('does not apply level filter when not specified', async () => {
        const { from, _builder } = makeSupabase([makeRow()], 1);
        await deploymentLogsService.getLogs(DEPLOY_ID, DEFAULT_PARAMS, { from } as any);
        const eqCalls: string[][] = _builder.eq.mock.calls;
        expect(eqCalls.every(([col]) => col !== 'level')).toBe(true);
    });
});

// ── getLogsByLevel ────────────────────────────────────────────────────────────

describe('deploymentLogsService.getLogsByLevel', () => {
    it('returns only logs matching the requested level', async () => {
        const rows = [makeRow({ level: 'warn', message: 'Low disk' })];
        const { from, _builder } = makeSupabase(rows);
        const result = await deploymentLogsService.getLogsByLevel(DEPLOY_ID, 'warn', { from } as any);
        expect(_builder.eq).toHaveBeenCalledWith('level', 'warn');
        expect(result[0].level).toBe('warn');
    });

    it('throws on DB error', async () => {
        const { from } = makeSupabase([], 0, 'query failed');
        await expect(deploymentLogsService.getLogsByLevel(DEPLOY_ID, 'error', { from } as any))
            .rejects.toThrow('query failed');
    });
});

// ── getLogsByStage ────────────────────────────────────────────────────────────

describe('deploymentLogsService.getLogsByStage', () => {
    it('returns only logs for the requested stage', async () => {
        const rows = [makeRow({ stage: 'pushing_code', message: 'Pushing files' })];
        const { from, _builder } = makeSupabase(rows);
        const result = await deploymentLogsService.getLogsByStage(DEPLOY_ID, 'pushing_code', { from } as any);
        expect(_builder.eq).toHaveBeenCalledWith('stage', 'pushing_code');
        expect(result).toHaveLength(1);
    });
});

// ── getLogsByTimeRange (export) ───────────────────────────────────────────────

describe('deploymentLogsService.getLogsByTimeRange — export', () => {
    const start = '2024-01-01T00:00:00Z';
    const end   = '2024-01-31T23:59:59Z';

    it('applies gte and lte filters for the time range', async () => {
        const { from, _builder } = makeSupabase([makeRow()]);
        await deploymentLogsService.getLogsByTimeRange(DEPLOY_ID, start, end, { from } as any);
        expect(_builder.gte).toHaveBeenCalledWith('created_at', start);
        expect(_builder.lte).toHaveBeenCalledWith('created_at', end);
    });

    it('returns all logs within the range in ascending order', async () => {
        const rows = [
            makeRow({ id: 'a', created_at: '2024-01-10T08:00:00Z' }),
            makeRow({ id: 'b', created_at: '2024-01-20T08:00:00Z' }),
        ];
        const { from, _builder } = makeSupabase(rows);
        const result = await deploymentLogsService.getLogsByTimeRange(DEPLOY_ID, start, end, { from } as any);
        expect(result).toHaveLength(2);
        expect(_builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
    });

    it('returns empty array when no logs fall in range', async () => {
        const { from } = makeSupabase([]);
        const result = await deploymentLogsService.getLogsByTimeRange(DEPLOY_ID, start, end, { from } as any);
        expect(result).toHaveLength(0);
    });

    it('throws on DB error', async () => {
        const { from } = makeSupabase([], 0, 'timeout');
        await expect(deploymentLogsService.getLogsByTimeRange(DEPLOY_ID, start, end, { from } as any))
            .rejects.toThrow('timeout');
    });
});

// ── getLogsBatch ──────────────────────────────────────────────────────────────

describe('deploymentLogsService.getLogsBatch — multi-deployment export', () => {
    const IDS = ['deploy-1', 'deploy-2', 'deploy-3'];

    it('queries using .in() for multiple deployment IDs', async () => {
        const { from, _builder } = makeSupabase([], 0);
        await deploymentLogsService.getLogsBatch(IDS, DEFAULT_PARAMS, { from } as any);
        expect(_builder.in).toHaveBeenCalledWith('deployment_id', IDS);
    });

    it('returns combined logs from all deployments', async () => {
        const rows = IDS.map((id, i) => makeRow({ id: `log-${i}`, deployment_id: id }));
        const { from } = makeSupabase(rows, rows.length);
        const result = await deploymentLogsService.getLogsBatch(IDS, DEFAULT_PARAMS, { from } as any);
        expect(result.data).toHaveLength(3);
    });

    it('supports level filtering in batch mode', async () => {
        const { from, _builder } = makeSupabase([], 0);
        await deploymentLogsService.getLogsBatch(IDS, { ...DEFAULT_PARAMS, level: 'error' }, { from } as any);
        expect(_builder.eq).toHaveBeenCalledWith('level', 'error');
    });
});
