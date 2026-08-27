/**
 * EnvSyncService retry-idempotency tests (#1057)
 *
 * Verifies that sync() converges to the same final state regardless of which
 * operations already partially succeeded before a retry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvSyncService, type EnvVar } from './env-sync.service';

type EnvTarget = 'production' | 'preview' | 'development';
type EnvType = 'plain' | 'secret' | 'encrypted';

interface VercelEnvRecord {
    id: string;
    key: string;
    value: string;
    target: EnvTarget[];
    type: EnvType;
}

let idCounter = 0;

function makeRecord(variable: EnvVar): VercelEnvRecord {
    return {
        id: `env_${++idCounter}`,
        key: variable.key,
        value: variable.value,
        target: [...variable.target] as EnvTarget[],
        type: variable.type as EnvType,
    };
}

type MockApi = {
    listEnvVars: ReturnType<typeof vi.fn>;
    createEnvVar: ReturnType<typeof vi.fn>;
    updateEnvVar: ReturnType<typeof vi.fn>;
    deleteEnvVar: ReturnType<typeof vi.fn>;
    store: VercelEnvRecord[];
};

function makeMockApi(store: VercelEnvRecord[]): MockApi {
    return {
        store,
        listEnvVars: vi.fn(async () => [...store]),
        createEnvVar: vi.fn(async (_pid: string, variable: EnvVar) => {
            const existing = store.findIndex(
                (r) => r.key === variable.key && r.target.sort().join() === [...variable.target].sort().join(),
            );
            if (existing >= 0) {
                store[existing] = { ...store[existing], value: variable.value, type: variable.type as EnvType };
                return store[existing];
            }
            const record = makeRecord(variable);
            store.push(record);
            return record;
        }),
        updateEnvVar: vi.fn(
            async (_pid: string, envId: string, patch: { value?: string; type?: string }) => {
                const idx = store.findIndex((r) => r.id === envId);
                if (idx === -1) throw new Error('Not found');
                store[idx] = { ...store[idx], ...patch };
                return store[idx];
            },
        ),
        deleteEnvVar: vi.fn(async (_pid: string, envId: string) => {
            const idx = store.findIndex((r) => r.id === envId);
            if (idx !== -1) store.splice(idx, 1);
        }),
    };
}

const PROJECT_ID = 'prj_retry_idempotency_test';

describe('EnvSyncService — retry idempotency (#1057)', () => {
    beforeEach(() => {
        idCounter = 0;
        vi.clearAllMocks();
    });

    it('retries after a partial create failure and converges without duplicates', async () => {
        const store: VercelEnvRecord[] = [];
        let createCallCount = 0;

        const api: MockApi = {
            store,
            listEnvVars: vi.fn(async () => [...store]),
            createEnvVar: vi.fn(async (_pid: string, variable: EnvVar) => {
                createCallCount++;
                if (createCallCount === 2) {
                    const err = new Error('transient failure');
                    (err as any).status = 500;
                    throw err;
                }
                const existing = store.findIndex(
                    (r) => r.key === variable.key && r.target.sort().join() === [...variable.target].sort().join(),
                );
                if (existing >= 0) {
                    store[existing] = { ...store[existing], value: variable.value, type: variable.type as EnvType };
                    return store[existing];
                }
                const record = makeRecord(variable);
                store.push(record);
                return record;
            }),
            updateEnvVar: vi.fn(async (_pid: string, envId: string, patch: { value?: string; type?: string }) => {
                const idx = store.findIndex((r) => r.id === envId);
                if (idx === -1) throw new Error('Not found');
                store[idx] = { ...store[idx], ...patch };
                return store[idx];
            }),
            deleteEnvVar: vi.fn(async (_pid: string, envId: string) => {
                const idx = store.findIndex((r) => r.id === envId);
                if (idx !== -1) store.splice(idx, 1);
            }),
        };

        const service = new EnvSyncService(api, {
            maxAttempts: 3,
            baseDelayMs: 0,
            maxDelayMs: 0,
            sleep: () => Promise.resolve(),
        });

        const vars: EnvVar[] = [
            { key: 'KEY_A', value: 'value-a', target: ['production'], type: 'plain' },
            { key: 'KEY_B', value: 'value-b', target: ['production'], type: 'plain' },
        ];

        const result = await service.sync(PROJECT_ID, vars);

        expect(result.created).toBe(1);
        expect(result.updated).toBe(0);
        expect(result.deleted).toBe(0);
        expect(store.filter((r) => r.key === 'KEY_A')).toHaveLength(1);
        expect(store.filter((r) => r.key === 'KEY_B')).toHaveLength(1);
    });

    it('retries after a partial delete failure and converges correctly', async () => {
        const store: VercelEnvRecord[] = [
            makeRecord({ key: 'KEY_A', value: 'value-a', target: ['production'], type: 'plain' }),
            makeRecord({ key: 'KEY_B', value: 'value-b', target: ['production'], type: 'plain' }),
        ];
        let deleteCallCount = 0;

        const api: MockApi = {
            store,
            listEnvVars: vi.fn(async () => [...store]),
            createEnvVar: vi.fn(async () => makeRecord({ key: 'NEW', value: 'new', target: ['production'], type: 'plain' })),
            updateEnvVar: vi.fn(async () => ({}) as any),
            deleteEnvVar: vi.fn(async (_pid: string, envId: string) => {
                deleteCallCount++;
                if (deleteCallCount === 1) {
                    const err = new Error('transient failure');
                    (err as any).status = 500;
                    throw err;
                }
                const idx = store.findIndex((r) => r.id === envId);
                if (idx !== -1) store.splice(idx, 1);
            }),
        };

        const service = new EnvSyncService(api, {
            maxAttempts: 3,
            baseDelayMs: 0,
            maxDelayMs: 0,
            sleep: () => Promise.resolve(),
        });

        const result = await service.sync(PROJECT_ID, []);

        expect(result.deleted).toBe(2);
        expect(store).toHaveLength(0);
    });

    it('treats create already-exists error as a no-op success on retry', async () => {
        const store: VercelEnvRecord[] = [];
        let createCallCount = 0;

        const api: MockApi = {
            store,
            listEnvVars: vi.fn(async () => [...store]),
            createEnvVar: vi.fn(async (_pid: string, variable: EnvVar) => {
                createCallCount++;
                if (createCallCount === 1) {
                    const record = makeRecord(variable);
                    store.push(record);
                    const err = new Error('already exists');
                    (err as any).status = 409;
                    throw err;
                }
                const existing = store.findIndex(
                    (r) => r.key === variable.key && r.target.sort().join() === [...variable.target].sort().join(),
                );
                if (existing >= 0) {
                    return store[existing];
                }
                const record = makeRecord(variable);
                store.push(record);
                return record;
            }),
            updateEnvVar: vi.fn(async () => ({}) as any),
            deleteEnvVar: vi.fn(async () => {}),
        };

        const service = new EnvSyncService(api, {
            maxAttempts: 3,
            baseDelayMs: 0,
            maxDelayMs: 0,
            sleep: () => Promise.resolve(),
        });

        const vars: EnvVar[] = [
            { key: 'KEY_A', value: 'value-a', target: ['production'], type: 'plain' },
        ];

        const result = await service.sync(PROJECT_ID, vars);

        expect(result.created).toBe(1);
        expect(store.filter((r) => r.key === 'KEY_A')).toHaveLength(1);
    });

    it('treats delete not-found error as already-deleted on retry', async () => {
        const store: VercelEnvRecord[] = [
            makeRecord({ key: 'KEY_A', value: 'value-a', target: ['production'], type: 'plain' }),
        ];
        let deleteCallCount = 0;

        const api: MockApi = {
            store,
            listEnvVars: vi.fn(async () => [...store]),
            createEnvVar: vi.fn(async () => ({}) as any),
            updateEnvVar: vi.fn(async () => ({}) as any),
            deleteEnvVar: vi.fn(async (_pid: string, envId: string) => {
                deleteCallCount++;
                if (deleteCallCount === 1) {
                    const idx = store.findIndex((r) => r.id === envId);
                    if (idx !== -1) store.splice(idx, 1);
                    const err = new Error('not found');
                    (err as any).status = 404;
                    throw err;
                }
                const idx = store.findIndex((r) => r.id === envId);
                if (idx !== -1) store.splice(idx, 1);
            }),
        };

        const service = new EnvSyncService(api, {
            maxAttempts: 3,
            baseDelayMs: 0,
            maxDelayMs: 0,
            sleep: () => Promise.resolve(),
        });

        const result = await service.sync(PROJECT_ID, []);

        expect(result.deleted).toBe(1);
        expect(store).toHaveLength(0);
    });
});
