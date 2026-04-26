/**
 * Deployment Audit Log Tests
 *
 * Tests the deploymentLogsService for audit log behaviour:
 *   - Log creation for all deployment stages
 *   - Event completeness (all stages produce logs)
 *   - Log query accuracy (filtering by level, stage, since)
 *   - Log retention (MAX_LIMIT cap, pagination)
 *   - Log export (time-range batch retrieval)
 *   - Log immutability (no update/delete paths)
 *   - parseLogsQueryParams validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deploymentLogsService,
  parseLogsQueryParams,
} from '@/services/deployment-logs.service';
import type { LogLevel } from '@craft/types';

// ── Supabase mock builder ─────────────────────────────────────────────────────

function makeSupabase(rows: object[] = [], count = rows.length, error: string | null = null) {
  const terminal = {
    data: error ? null : rows,
    count: error ? null : count,
    error: error ? { message: error } : null,
  };
  const orderResult = { ...terminal, range: vi.fn().mockResolvedValue(terminal) };
  const builder: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnValue(orderResult),
    range: vi.fn().mockResolvedValue(terminal),
  };
  return { from: vi.fn().mockReturnValue(builder), _builder: builder };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEPLOY_ID = 'deploy-audit-001';

const ALL_STAGES = [
  'pending',
  'generating',
  'creating_repo',
  'pushing_code',
  'deploying',
  'completed',
  'failed',
] as const;

function makeRow(overrides: Partial<{
  id: string;
  deployment_id: string;
  stage: string;
  created_at: string;
  level: LogLevel;
  message: string;
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

// ── Audit log creation ────────────────────────────────────────────────────────

describe('Audit log creation', () => {
  it('getLogs returns logs for a deployment', async () => {
    const row = makeRow();
    const { from } = makeSupabase([row]);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].deploymentId).toBe(DEPLOY_ID);
  });

  it('log entry maps created_at to timestamp field', async () => {
    const row = makeRow({ created_at: '2024-01-15T10:00:00Z' });
    const { from } = makeSupabase([row]);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(result.data[0].timestamp).toBe('2024-01-15T10:00:00Z');
  });

  it('log entry preserves level field', async () => {
    const row = makeRow({ level: 'error' });
    const { from } = makeSupabase([row]);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(result.data[0].level).toBe('error');
  });

  it('log entry preserves message field', async () => {
    const row = makeRow({ message: 'Repository created successfully' });
    const { from } = makeSupabase([row]);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(result.data[0].message).toBe('Repository created successfully');
  });
});

// ── Event completeness ────────────────────────────────────────────────────────

describe('Event completeness — all deployment stages', () => {
  it.each(ALL_STAGES)('stage "%s" is a valid log stage', async (stage) => {
    const row = makeRow({ stage });
    const { from } = makeSupabase([row]);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc', stage },
      { from } as any,
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0].deploymentId).toBe(DEPLOY_ID);
  });

  it('all three log levels are accepted', async () => {
    const levels: LogLevel[] = ['info', 'warn', 'error'];
    for (const level of levels) {
      const row = makeRow({ level });
      const { from } = makeSupabase([row]);
      const result = await deploymentLogsService.getLogs(
        DEPLOY_ID,
        { page: 1, limit: 50, order: 'asc', level },
        { from } as any,
      );
      expect(result.data[0].level).toBe(level);
    }
  });

  it('multiple log entries are returned for a single deployment', async () => {
    const rows = ALL_STAGES.map((stage, i) =>
      makeRow({ id: `log-${i}`, stage, message: `${stage} started` }),
    );
    const { from } = makeSupabase(rows);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(result.data).toHaveLength(ALL_STAGES.length);
  });
});

// ── Log query accuracy ────────────────────────────────────────────────────────

describe('Log query accuracy', () => {
  it('filters by level via query params', async () => {
    const row = makeRow({ level: 'error' });
    const { from, _builder } = makeSupabase([row]);
    await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc', level: 'error' },
      { from } as any,
    );
    expect(_builder.eq).toHaveBeenCalledWith('level', 'error');
  });

  it('filters by stage via query params', async () => {
    const row = makeRow({ stage: 'deploying' });
    const { from, _builder } = makeSupabase([row]);
    await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc', stage: 'deploying' },
      { from } as any,
    );
    expect(_builder.eq).toHaveBeenCalledWith('stage', 'deploying');
  });

  it('filters by since timestamp', async () => {
    const since = '2024-01-15T09:00:00Z';
    const row = makeRow({ created_at: '2024-01-15T10:00:00Z' });
    const { from, _builder } = makeSupabase([row]);
    await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc', since },
      { from } as any,
    );
    expect(_builder.gt).toHaveBeenCalledWith('created_at', since);
  });

  it('applies descending order when specified', async () => {
    const { from, _builder } = makeSupabase([makeRow()]);
    await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'desc' },
      { from } as any,
    );
    expect(_builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('applies ascending order when specified', async () => {
    const { from, _builder } = makeSupabase([makeRow()]);
    await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(_builder.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('always filters by deployment_id', async () => {
    const { from, _builder } = makeSupabase([makeRow()]);
    await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(_builder.eq).toHaveBeenCalledWith('deployment_id', DEPLOY_ID);
  });
});

// ── Log retention (pagination & MAX_LIMIT) ────────────────────────────────────

describe('Log retention and pagination', () => {
  it('pagination metadata reflects total count', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRow({ id: `log-${i}` }));
    const { from } = makeSupabase(rows, 20);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 5, order: 'asc' },
      { from } as any,
    );
    expect(result.pagination.total).toBe(20);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(5);
    expect(result.pagination.hasNextPage).toBe(true);
  });

  it('hasNextPage is false on last page', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => makeRow({ id: `log-${i}` }));
    const { from } = makeSupabase(rows, 3);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(result.pagination.hasNextPage).toBe(false);
  });

  it('parseLogsQueryParams caps limit at 200', () => {
    const params = new URLSearchParams({ limit: '500' });
    const result = parseLogsQueryParams(params);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.params.limit).toBe(200);
  });

  it('parseLogsQueryParams defaults page to 1', () => {
    const result = parseLogsQueryParams(new URLSearchParams());
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.params.page).toBe(1);
  });

  it('parseLogsQueryParams defaults limit to 50', () => {
    const result = parseLogsQueryParams(new URLSearchParams());
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.params.limit).toBe(50);
  });

  it('parseLogsQueryParams defaults order to asc', () => {
    const result = parseLogsQueryParams(new URLSearchParams());
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.params.order).toBe('asc');
  });
});

// ── Log export ────────────────────────────────────────────────────────────────

describe('Log export', () => {
  it('returns all logs within a time range', async () => {
    const rows = [
      makeRow({ id: 'log-1', created_at: '2024-01-15T10:00:00Z' }),
      makeRow({ id: 'log-2', created_at: '2024-01-15T11:00:00Z' }),
    ];
    const { from } = makeSupabase(rows, 2);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 200, order: 'asc', since: '2024-01-15T09:00:00Z' },
      { from } as any,
    );
    expect(result.data).toHaveLength(2);
  });

  it('returns empty data array when no logs match', async () => {
    const { from } = makeSupabase([], 0);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(result.data).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.hasNextPage).toBe(false);
  });

  it('throws on database error', async () => {
    const { from } = makeSupabase([], 0, 'connection refused');
    await expect(
      deploymentLogsService.getLogs(
        DEPLOY_ID,
        { page: 1, limit: 50, order: 'asc' },
        { from } as any,
      ),
    ).rejects.toThrow('connection refused');
  });
});

// ── Log immutability ──────────────────────────────────────────────────────────

describe('Log immutability', () => {
  it('deploymentLogsService does not expose an update method', () => {
    expect((deploymentLogsService as Record<string, unknown>).updateLog).toBeUndefined();
  });

  it('deploymentLogsService does not expose a delete method', () => {
    expect((deploymentLogsService as Record<string, unknown>).deleteLog).toBeUndefined();
  });

  it('returned log entries are plain objects (not class instances)', async () => {
    const { from } = makeSupabase([makeRow()]);
    const result = await deploymentLogsService.getLogs(
      DEPLOY_ID,
      { page: 1, limit: 50, order: 'asc' },
      { from } as any,
    );
    expect(Object.getPrototypeOf(result.data[0])).toBe(Object.prototype);
  });
});

// ── parseLogsQueryParams validation ──────────────────────────────────────────

describe('parseLogsQueryParams validation', () => {
  it('rejects non-integer page', () => {
    expect(parseLogsQueryParams(new URLSearchParams({ page: '1.5' })).valid).toBe(false);
  });

  it('rejects page < 1', () => {
    expect(parseLogsQueryParams(new URLSearchParams({ page: '0' })).valid).toBe(false);
  });

  it('rejects invalid order value', () => {
    expect(parseLogsQueryParams(new URLSearchParams({ order: 'random' })).valid).toBe(false);
  });

  it('rejects invalid level value', () => {
    expect(parseLogsQueryParams(new URLSearchParams({ level: 'debug' })).valid).toBe(false);
  });

  it('rejects invalid stage value', () => {
    expect(parseLogsQueryParams(new URLSearchParams({ stage: 'unknown_stage' })).valid).toBe(false);
  });

  it('rejects invalid since timestamp', () => {
    expect(parseLogsQueryParams(new URLSearchParams({ since: 'not-a-date' })).valid).toBe(false);
  });

  it('accepts valid since ISO timestamp', () => {
    const result = parseLogsQueryParams(new URLSearchParams({ since: '2024-01-15T10:00:00Z' }));
    expect(result.valid).toBe(true);
  });

  it('accepts desc order', () => {
    const result = parseLogsQueryParams(new URLSearchParams({ order: 'desc' }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.params.order).toBe('desc');
  });

  it('accepts all valid log levels', () => {
    for (const level of ['info', 'warn', 'error']) {
      const result = parseLogsQueryParams(new URLSearchParams({ level }));
      expect(result.valid).toBe(true);
    }
  });
});
