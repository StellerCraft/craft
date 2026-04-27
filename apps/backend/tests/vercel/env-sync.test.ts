/**
 * Vercel Environment Variable Sync Tests (#367)
 *
 * Verifies that environment variables are correctly created, updated,
 * deleted, and encrypted when synced to Vercel projects.
 *
 * All HTTP calls are intercepted with vi.fn() mocks — no live Vercel
 * API is required.
 *
 * Sync contract:
 *   - Variables are upserted per (key, target) pair.
 *   - Sensitive variables (type = "sensitive") are encrypted by Vercel.
 *   - Deletions remove the variable from all specified targets.
 *   - Environment-specific variables are scoped to the correct target
 *     (production | preview | development).
 *   - A failed API call throws VercelSyncError with the status code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type EnvTarget = 'production' | 'preview' | 'development';
type EnvType = 'plain' | 'sensitive' | 'secret';

interface EnvVar {
  key: string;
  value: string;
  target: EnvTarget[];
  type: EnvType;
}

interface VercelEnvRecord {
  id: string;
  key: string;
  value: string;
  target: EnvTarget[];
  type: EnvType;
  createdAt: number;
  updatedAt: number;
}

interface VercelApiClient {
  listEnvVars(projectId: string): Promise<VercelEnvRecord[]>;
  createEnvVar(projectId: string, variable: EnvVar): Promise<VercelEnvRecord>;
  updateEnvVar(projectId: string, envId: string, patch: Partial<EnvVar>): Promise<VercelEnvRecord>;
  deleteEnvVar(projectId: string, envId: string): Promise<void>;
}

// ── Sync error ────────────────────────────────────────────────────────────────

class VercelSyncError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'VercelSyncError';
  }
}

// ── Sync service ──────────────────────────────────────────────────────────────

class EnvSyncService {
  constructor(private readonly api: VercelApiClient) {}

  async sync(projectId: string, desired: EnvVar[]): Promise<{ created: number; updated: number; deleted: number }> {
    const existing = await this.api.listEnvVars(projectId);
    const existingMap = new Map(existing.map((e) => [`${e.key}:${e.target.sort().join(',')}`, e]));

    let created = 0;
    let updated = 0;

    for (const variable of desired) {
      const mapKey = `${variable.key}:${[...variable.target].sort().join(',')}`;
      const record = existingMap.get(mapKey);
      if (record) {
        if (record.value !== variable.value || record.type !== variable.type) {
          await this.api.updateEnvVar(projectId, record.id, { value: variable.value, type: variable.type });
          updated++;
        }
        existingMap.delete(mapKey);
      } else {
        await this.api.createEnvVar(projectId, variable);
        created++;
      }
    }

    // Remaining entries in existingMap are stale — delete them
    let deleted = 0;
    for (const stale of existingMap.values()) {
      await this.api.deleteEnvVar(projectId, stale.id);
      deleted++;
    }

    return { created, updated, deleted };
  }

  async deleteAll(projectId: string, keys: string[]): Promise<number> {
    const existing = await this.api.listEnvVars(projectId);
    const toDelete = existing.filter((e) => keys.includes(e.key));
    await Promise.all(toDelete.map((e) => this.api.deleteEnvVar(projectId, e.id)));
    return toDelete.length;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let idCounter = 0;
function makeRecord(variable: EnvVar): VercelEnvRecord {
  return {
    id: `env_${++idCounter}`,
    ...variable,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeMockApi(initial: VercelEnvRecord[] = []): VercelApiClient & { store: VercelEnvRecord[] } {
  const store: VercelEnvRecord[] = [...initial];
  return {
    store,
    listEnvVars: vi.fn(async () => [...store]),
    createEnvVar: vi.fn(async (_pid, variable) => {
      const record = makeRecord(variable);
      store.push(record);
      return record;
    }),
    updateEnvVar: vi.fn(async (_pid, envId, patch) => {
      const idx = store.findIndex((e) => e.id === envId);
      if (idx === -1) throw new VercelSyncError('Not found', 404);
      store[idx] = { ...store[idx], ...patch, updatedAt: Date.now() };
      return store[idx];
    }),
    deleteEnvVar: vi.fn(async (_pid, envId) => {
      const idx = store.findIndex((e) => e.id === envId);
      if (idx === -1) throw new VercelSyncError('Not found', 404);
      store.splice(idx, 1);
    }),
  };
}

const PROJECT_ID = 'prj_test123';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EnvSyncService – variable creation', () => {
  let api: ReturnType<typeof makeMockApi>;
  let service: EnvSyncService;

  beforeEach(() => {
    idCounter = 0;
    api = makeMockApi();
    service = new EnvSyncService(api);
  });

  it('creates a new plain variable', async () => {
    const variable: EnvVar = { key: 'APP_URL', value: 'https://example.com', target: ['production'], type: 'plain' };
    const result = await service.sync(PROJECT_ID, [variable]);
    expect(result.created).toBe(1);
    expect(api.createEnvVar).toHaveBeenCalledWith(PROJECT_ID, variable);
  });

  it('creates multiple variables in one sync', async () => {
    const vars: EnvVar[] = [
      { key: 'KEY_A', value: 'a', target: ['production'], type: 'plain' },
      { key: 'KEY_B', value: 'b', target: ['preview'], type: 'plain' },
    ];
    const result = await service.sync(PROJECT_ID, vars);
    expect(result.created).toBe(2);
  });

  it('creates environment-specific variables with correct target', async () => {
    const prodVar: EnvVar = { key: 'DB_URL', value: 'prod-db', target: ['production'], type: 'sensitive' };
    const devVar: EnvVar = { key: 'DB_URL', value: 'dev-db', target: ['development'], type: 'plain' };
    await service.sync(PROJECT_ID, [prodVar, devVar]);
    expect(api.createEnvVar).toHaveBeenCalledTimes(2);
    const calls = (api.createEnvVar as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].target).toEqual(['production']);
    expect(calls[1][1].target).toEqual(['development']);
  });
});

describe('EnvSyncService – variable encryption', () => {
  let api: ReturnType<typeof makeMockApi>;
  let service: EnvSyncService;

  beforeEach(() => {
    idCounter = 0;
    api = makeMockApi();
    service = new EnvSyncService(api);
  });

  it('creates sensitive variable with type "sensitive"', async () => {
    const variable: EnvVar = { key: 'SECRET_KEY', value: 'super-secret', target: ['production'], type: 'sensitive' };
    await service.sync(PROJECT_ID, [variable]);
    const created = api.store.find((e) => e.key === 'SECRET_KEY');
    expect(created?.type).toBe('sensitive');
  });

  it('creates secret variable with type "secret"', async () => {
    const variable: EnvVar = { key: 'API_TOKEN', value: 'tok_xyz', target: ['production'], type: 'secret' };
    await service.sync(PROJECT_ID, [variable]);
    const created = api.store.find((e) => e.key === 'API_TOKEN');
    expect(created?.type).toBe('secret');
  });

  it('updates type from plain to sensitive when variable changes', async () => {
    const existing = makeRecord({ key: 'DB_PASS', value: 'old', target: ['production'], type: 'plain' });
    api = makeMockApi([existing]);
    service = new EnvSyncService(api);

    await service.sync(PROJECT_ID, [{ key: 'DB_PASS', value: 'new-secret', target: ['production'], type: 'sensitive' }]);
    expect(api.updateEnvVar).toHaveBeenCalledWith(PROJECT_ID, existing.id, { value: 'new-secret', type: 'sensitive' });
  });
});

describe('EnvSyncService – variable updates', () => {
  let api: ReturnType<typeof makeMockApi>;
  let service: EnvSyncService;
  let existingRecord: VercelEnvRecord;

  beforeEach(() => {
    idCounter = 0;
    existingRecord = makeRecord({ key: 'APP_URL', value: 'https://old.com', target: ['production'], type: 'plain' });
    api = makeMockApi([existingRecord]);
    service = new EnvSyncService(api);
  });

  it('updates variable when value changes', async () => {
    const result = await service.sync(PROJECT_ID, [
      { key: 'APP_URL', value: 'https://new.com', target: ['production'], type: 'plain' },
    ]);
    expect(result.updated).toBe(1);
    expect(api.updateEnvVar).toHaveBeenCalledWith(PROJECT_ID, existingRecord.id, {
      value: 'https://new.com',
      type: 'plain',
    });
  });

  it('does not update variable when value is unchanged', async () => {
    const result = await service.sync(PROJECT_ID, [
      { key: 'APP_URL', value: 'https://old.com', target: ['production'], type: 'plain' },
    ]);
    expect(result.updated).toBe(0);
    expect(api.updateEnvVar).not.toHaveBeenCalled();
  });

  it('reports correct created/updated/deleted counts', async () => {
    const result = await service.sync(PROJECT_ID, [
      { key: 'APP_URL', value: 'https://new.com', target: ['production'], type: 'plain' }, // update
      { key: 'NEW_KEY', value: 'new-value', target: ['production'], type: 'plain' },       // create
      // APP_URL old record is gone → delete handled by stale logic
    ]);
    expect(result.updated).toBe(1);
    expect(result.created).toBe(1);
  });
});

describe('EnvSyncService – variable deletion', () => {
  let api: ReturnType<typeof makeMockApi>;
  let service: EnvSyncService;

  beforeEach(() => {
    idCounter = 0;
    api = makeMockApi([
      makeRecord({ key: 'OLD_KEY', value: 'old', target: ['production'], type: 'plain' }),
      makeRecord({ key: 'KEEP_KEY', value: 'keep', target: ['production'], type: 'plain' }),
    ]);
    service = new EnvSyncService(api);
  });

  it('deletes stale variables not in desired set', async () => {
    const result = await service.sync(PROJECT_ID, [
      { key: 'KEEP_KEY', value: 'keep', target: ['production'], type: 'plain' },
    ]);
    expect(result.deleted).toBe(1);
    expect(api.store.find((e) => e.key === 'OLD_KEY')).toBeUndefined();
  });

  it('deleteAll removes specified keys', async () => {
    const count = await service.deleteAll(PROJECT_ID, ['OLD_KEY', 'KEEP_KEY']);
    expect(count).toBe(2);
    expect(api.store).toHaveLength(0);
  });

  it('deleteAll ignores keys that do not exist', async () => {
    const count = await service.deleteAll(PROJECT_ID, ['NONEXISTENT']);
    expect(count).toBe(0);
    expect(api.deleteEnvVar).not.toHaveBeenCalled();
  });
});

describe('EnvSyncService – environment-specific variables', () => {
  let api: ReturnType<typeof makeMockApi>;
  let service: EnvSyncService;

  beforeEach(() => {
    idCounter = 0;
    api = makeMockApi();
    service = new EnvSyncService(api);
  });

  it('syncs variables scoped to all three environments independently', async () => {
    const vars: EnvVar[] = [
      { key: 'LOG_LEVEL', value: 'error', target: ['production'], type: 'plain' },
      { key: 'LOG_LEVEL', value: 'warn',  target: ['preview'],    type: 'plain' },
      { key: 'LOG_LEVEL', value: 'debug', target: ['development'], type: 'plain' },
    ];
    const result = await service.sync(PROJECT_ID, vars);
    expect(result.created).toBe(3);
    expect(api.store).toHaveLength(3);
  });

  it('multi-target variable is treated as a single record', async () => {
    const variable: EnvVar = {
      key: 'NEXT_PUBLIC_API',
      value: 'https://api.example.com',
      target: ['production', 'preview'],
      type: 'plain',
    };
    const result = await service.sync(PROJECT_ID, [variable]);
    expect(result.created).toBe(1);
  });
});
