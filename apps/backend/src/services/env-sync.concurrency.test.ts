/**
 * Env-Sync Service Race Condition Tests (#734)
 *
 * Tests concurrent writes from two deployment pipelines targeting the same
 * Vercel project. Covers:
 *   - Concurrent writes produce consistent final state (last write wins)
 *   - Partial write failure leaves the store in a recoverable state
 *   - Optimistic concurrency: transient version-mismatch errors trigger retry
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

function makeMockApi(store: VercelEnvRecord[], writeDelayMs = 0): MockApi {
    return {
        store,
        listEnvVars: vi.fn(async () => [...store]),
        createEnvVar: vi.fn(async (_pid: string, variable: EnvVar) => {
            if (writeDelayMs > 0) {
                await new Promise((r) => setTimeout(r, writeDelayMs));
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
        updateEnvVar: vi.fn(
            async (_pid: string, envId: string, patch: { value?: string; type?: string }) => {
                if (writeDelayMs > 0) {
                    await new Promise((r) => setTimeout(r, writeDelayMs));
                }
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

const PROJECT_ID = 'prj_concurrency_test';

describe('EnvSyncService – concurrent write race condition detection (#734)', () => {
    beforeEach(() => {
        idCounter = 0;
        vi.clearAllMocks();
    });

    describe('concurrent writes from two pipeline instances', () => {
        it('final env state reflects exactly one record per key, not a partial merge', async () => {
            const store: VercelEnvRecord[] = [];

            // Pipeline A writes with a 5ms delay; pipeline B writes immediately.
            // Both read the same initial empty store, so both will attempt to create DB_URL.
            const apiA = makeMockApi(store, 5);
            const apiB = makeMockApi(store, 0);

            const serviceA = new EnvSyncService(apiA, { maxAttempts: 1 });
            const serviceB = new EnvSyncService(apiB, { maxAttempts: 1 });

            const desiredA: EnvVar[] = [
                { key: 'DB_URL', value: 'postgres://pipeline-a', target: ['production'], type: 'plain' },
            ];
            const desiredB: EnvVar[] = [
                { key: 'DB_URL', value: 'postgres://pipeline-b', target: ['production'], type: 'plain' },
            ];

            await Promise.all([serviceA.sync(PROJECT_ID, desiredA), serviceB.sync(PROJECT_ID, desiredB)]);

            // Exactly one record must exist — no phantom duplicates
            const keys = store.filter((r) => r.key === 'DB_URL');
            expect(keys).toHaveLength(1);

            // The surviving value must be one of the two valid inputs (no corruption)
            expect(['postgres://pipeline-a', 'postgres://pipeline-b']).toContain(keys[0].value);
        });

        it('concurrent writes of disjoint keys produce all expected records without cross-contamination', async () => {
            const store: VercelEnvRecord[] = [];

            const apiA = makeMockApi(store, 5);
            const apiB = makeMockApi(store, 0);

            const serviceA = new EnvSyncService(apiA, { maxAttempts: 1 });
            const serviceB = new EnvSyncService(apiB, { maxAttempts: 1 });

            const desiredA: EnvVar[] = [
                { key: 'API_KEY_A', value: 'key-from-pipeline-a', target: ['production'], type: 'plain' },
            ];
            const desiredB: EnvVar[] = [
                { key: 'API_KEY_B', value: 'key-from-pipeline-b', target: ['production'], type: 'plain' },
            ];

            const [resultA, resultB] = await Promise.all([
                serviceA.sync(PROJECT_ID, desiredA),
                serviceB.sync(PROJECT_ID, desiredB),
            ]);

            expect(resultA.created).toBe(1);
            expect(resultB.created).toBe(1);

            const recA = store.find((r) => r.key === 'API_KEY_A');
            const recB = store.find((r) => r.key === 'API_KEY_B');

            expect(recA?.value).toBe('key-from-pipeline-a');
            expect(recB?.value).toBe('key-from-pipeline-b');
        });
    });

    describe('partial write failure', () => {
        it('write A succeeds, write B fails: store is consistent and recoverable', async () => {
            const store: VercelEnvRecord[] = [];
            let createCallCount = 0;

            const api: MockApi = {
                store,
                listEnvVars: vi.fn(async () => [...store]),
                createEnvVar: vi.fn(async (_pid: string, variable: EnvVar) => {
                    createCallCount++;
                    if (createCallCount === 2) {
                        throw new Error('Simulated transient API failure on second write');
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
                deleteEnvVar: vi.fn(async () => {}),
            };

            const service = new EnvSyncService(api, { maxAttempts: 1 });

            const vars: EnvVar[] = [
                { key: 'KEY_A', value: 'value-a', target: ['production'], type: 'plain' },
                { key: 'KEY_B', value: 'value-b', target: ['production'], type: 'plain' },
            ];

            // With maxAttempts: 1 the sync will throw after the first non-retryable failure
            await expect(service.sync(PROJECT_ID, vars)).rejects.toThrow();

            // KEY_A was written before the failure — it must be present
            expect(store.find((r) => r.key === 'KEY_A')).toBeDefined();

            // KEY_B was never written — the partial state is queryable and clear
            expect(store.find((r) => r.key === 'KEY_B')).toBeUndefined();

            // A subsequent sync that retries from scratch should produce a fully consistent state
            const recoveryApi = makeMockApi(store);
            const recoveryService = new EnvSyncService(recoveryApi, { maxAttempts: 1 });

            const result = await recoveryService.sync(PROJECT_ID, vars);

            // KEY_A already exists (unchanged value → no update), KEY_B is created
            expect(result.created).toBe(1);
            expect(store.find((r) => r.key === 'KEY_B')).toBeDefined();
        });
    });

    describe('optimistic concurrency: version mismatch triggers retry with latest version', () => {
        it('transient version conflict error is retried and eventually resolves', async () => {
            const store: VercelEnvRecord[] = [];
            store.push(makeRecord({ key: 'CONFIG', value: 'v1', target: ['production'], type: 'plain' }));

            let updateCallCount = 0;

            const api: MockApi = {
                store,
                listEnvVars: vi.fn(async () => [...store]),
                createEnvVar: vi.fn(async (_pid: string, variable: EnvVar) => {
                    const record = makeRecord(variable);
                    store.push(record);
                    return record;
                }),
                updateEnvVar: vi.fn(async (_pid: string, envId: string, patch: { value?: string; type?: string }) => {
                    updateCallCount++;
                    if (updateCallCount === 1) {
                        // First attempt: simulate a version mismatch (retryable transient error)
                        throw new Error('Version mismatch: resource was modified concurrently');
                    }
                    const idx = store.findIndex((r) => r.id === envId);
                    if (idx === -1) throw new Error('Not found');
                    store[idx] = { ...store[idx], ...patch };
                    return store[idx];
                }),
                deleteEnvVar: vi.fn(async () => {}),
            };

            // maxAttempts: 3 with no sleep so retries are instant in tests
            const service = new EnvSyncService(api, {
                maxAttempts: 3,
                baseDelayMs: 0,
                maxDelayMs: 0,
                sleep: () => Promise.resolve(),
            });

            await service.sync(PROJECT_ID, [
                { key: 'CONFIG', value: 'v2', target: ['production'], type: 'plain' },
            ]);

            // Must have retried after the version conflict
            expect(updateCallCount).toBeGreaterThan(1);

            // Final state must reflect the desired value, not the stale one
            const final = store.find((r) => r.key === 'CONFIG');
            expect(final?.value).toBe('v2');
        });

        it('exhausting retries after persistent version conflicts throws and leaves store unchanged', async () => {
            const store: VercelEnvRecord[] = [];
            store.push(makeRecord({ key: 'LOCKED', value: 'original', target: ['production'], type: 'plain' }));

            const api: MockApi = {
                store,
                listEnvVars: vi.fn(async () => [...store]),
                createEnvVar: vi.fn(),
                updateEnvVar: vi.fn(async () => {
                    throw new Error('Version mismatch: resource is permanently locked');
                }),
                deleteEnvVar: vi.fn(),
            };

            const service = new EnvSyncService(api, {
                maxAttempts: 3,
                baseDelayMs: 0,
                maxDelayMs: 0,
                sleep: () => Promise.resolve(),
            });

            await expect(
                service.sync(PROJECT_ID, [
                    { key: 'LOCKED', value: 'updated', target: ['production'], type: 'plain' },
                ]),
            ).rejects.toThrow();

            // Store must be unchanged after exhausted retries
            expect(store.find((r) => r.key === 'LOCKED')?.value).toBe('original');
        });
    });
});
