/**
 * Tests for rotateProfileEncryptedColumns batching behavior (#1063)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { encrypt, decrypt } from './field-encryption';
import { rotateProfileEncryptedColumns } from './key-rotation';

const VALID_KEY = 'a'.repeat(64);

function makeOldBlob(plaintext: string): string {
    const realBlob = encrypt(plaintext);
    return 'v0' + realBlob.slice(2);
}

describe('key-rotation: rotateProfileEncryptedColumns', () => {
    beforeEach(() => {
        process.env.FIELD_ENCRYPTION_KEY = VALID_KEY;
        process.env.FIELD_ENCRYPTION_KEY_0 = VALID_KEY;
    });

    afterEach(() => {
        delete process.env.FIELD_ENCRYPTION_KEY;
        delete process.env.FIELD_ENCRYPTION_KEY_0;
    });

    it('rotates rows using a single batched upsert instead of one round trip per row', async () => {
        const upsertPayloads: unknown[] = [];

        const rows = [
            { 
                id: 'row-1', 
                stripe_customer_id_encrypted: makeOldBlob('cus_1'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_1'),
            },
            { 
                id: 'row-2', 
                stripe_customer_id_encrypted: makeOldBlob('cus_2'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_2'),
            },
            { 
                id: 'row-3', 
                stripe_customer_id_encrypted: makeOldBlob('cus_3'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_3'),
            },
        ];

        const supabase = {
            from: (table: string) => ({
                select: (cols: string) => ({
                    not: (col: string) => Promise.resolve({ data: rows, error: null }),
                }),
                upsert: (payload: unknown) => {
                    upsertPayloads.push(payload);
                    return Promise.resolve({ error: null });
                },
            }),
        } as any;

        const summary = await rotateProfileEncryptedColumns(supabase);

        expect(summary.stripe_customer_id_encrypted.total).toBe(3);
        expect(summary.stripe_customer_id_encrypted.rotated).toBe(3);
        expect(summary.stripe_subscription_id_encrypted.total).toBe(3);
        expect(summary.stripe_subscription_id_encrypted.rotated).toBe(3);

        expect(upsertPayloads).toHaveLength(2);
        expect((upsertPayloads[0] as any[]).length).toBe(3);
        expect((upsertPayloads[1] as any[]).length).toBe(3);
    });

    it('skips rows already at the current key version and only upserts changed rows', async () => {
        const upsertPayloads: unknown[] = [];

        const currentBlob = encrypt('cus_current');
        const rows = [
            { 
                id: 'row-keep', 
                stripe_customer_id_encrypted: currentBlob,
                stripe_subscription_id_encrypted: makeOldBlob('sub_old'),
            },
            { 
                id: 'row-rotate', 
                stripe_customer_id_encrypted: makeOldBlob('cus_old'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_old2'),
            },
        ];

        const supabase = {
            from: (table: string) => ({
                select: (cols: string) => ({
                    not: (col: string) => Promise.resolve({ data: rows, error: null }),
                }),
                upsert: (payload: unknown) => {
                    upsertPayloads.push(payload);
                    return Promise.resolve({ error: null });
                },
            }),
        } as any;

        const summary = await rotateProfileEncryptedColumns(supabase);

        expect(summary.stripe_customer_id_encrypted.total).toBe(2);
        expect(summary.stripe_customer_id_encrypted.rotated).toBe(1);
        expect(summary.stripe_subscription_id_encrypted.total).toBe(2);
        expect(summary.stripe_subscription_id_encrypted.rotated).toBe(2);

        expect(upsertPayloads).toHaveLength(2);
        const customerPayload = upsertPayloads[0] as any[];
        expect(customerPayload).toHaveLength(1);
        expect(customerPayload[0].id).toBe('row-rotate');
    });

    it('reports an error when the batched upsert fails', async () => {
        const rows = [
            { 
                id: 'row-1', 
                stripe_customer_id_encrypted: makeOldBlob('cus_1'),
                stripe_subscription_id_encrypted: makeOldBlob('sub_1'),
            },
        ];

        let callCount = 0;
        const supabase = {
            from: (table: string) => ({
                select: (cols: string) => ({
                    not: (col: string) => Promise.resolve({ data: rows, error: null }),
                }),
                upsert: (payload: unknown) => {
                    callCount++;
                    if (callCount === 1) {
                        return Promise.resolve({ error: null });
                    }
                    return Promise.resolve({ error: { message: 'upsert failed' } });
                },
            }),
        } as any;

        await expect(
            rotateProfileEncryptedColumns(supabase),
        ).rejects.toThrow('Failed to update rows for stripe_subscription_id_encrypted: upsert failed');
    });
});

/**
 * Concurrency coverage: encrypted-field reads racing a key-rotation run (#1323)
 *
 * The rotation reads a snapshot of each column, re-encrypts it in memory, then
 * writes the changed rows back with one batched upsert per column. These tests
 * run a simulated reader against the same backing store while the upsert is
 * mid-flight and assert every value the reader observes decrypts to the
 * original plaintext under either the old (v0) or new (v1) key.
 */
describe('key-rotation: reads racing an in-flight rotation', () => {
    const OLD_KEY = 'b'.repeat(64);
    const NEW_KEY = 'c'.repeat(64);

    const COLUMNS = ['stripe_customer_id_encrypted', 'stripe_subscription_id_encrypted'] as const;

    /** Encrypts under OLD_KEY and labels the blob as key version 0. */
    function encryptWithOldKey(plaintext: string): string {
        const saved = process.env.FIELD_ENCRYPTION_KEY;
        process.env.FIELD_ENCRYPTION_KEY = OLD_KEY;
        try {
            return 'v0' + encrypt(plaintext).slice(2);
        } finally {
            process.env.FIELD_ENCRYPTION_KEY = saved;
        }
    }

    type Row = { id: string } & Record<(typeof COLUMNS)[number], string>;

    function seedStore(count: number): { store: Map<string, Row>; plaintexts: Map<string, Record<string, string>> } {
        const store = new Map<string, Row>();
        const plaintexts = new Map<string, Record<string, string>>();
        for (let i = 0; i < count; i++) {
            const id = `row-${i}`;
            const plain = {
                stripe_customer_id_encrypted: `cus_${i}`,
                stripe_subscription_id_encrypted: `sub_${i}`,
            };
            plaintexts.set(id, plain);
            store.set(id, {
                id,
                stripe_customer_id_encrypted: encryptWithOldKey(plain.stripe_customer_id_encrypted),
                stripe_subscription_id_encrypted: encryptWithOldKey(plain.stripe_subscription_id_encrypted),
            });
        }
        return { store, plaintexts };
    }

    /** Simulated application read path: fetch the stored blob, decrypt it. */
    function readField(store: Map<string, Row>, id: string, col: (typeof COLUMNS)[number]) {
        const stored = store.get(id)![col];
        return { version: stored.split('.')[0], plaintext: decrypt(stored) };
    }

    function readAll(store: Map<string, Row>, plaintexts: Map<string, Record<string, string>>) {
        const versions = new Set<string>();
        for (const id of store.keys()) {
            for (const col of COLUMNS) {
                const { version, plaintext } = readField(store, id, col);
                expect(['v0', 'v1']).toContain(version);
                expect(plaintext).toBe(plaintexts.get(id)![col]);
                versions.add(version);
            }
        }
        return versions;
    }

    /**
     * Supabase stub backed by `store`. The upsert applies its rows one at a
     * time, yielding to the event loop between rows (a worst case — Postgres
     * applies the whole batched upsert atomically), and calls `onRowWritten`
     * after each row so a concurrent reader can run mid-flight.
     */
    function makeSupabase(store: Map<string, Row>, onRowWritten: () => void) {
        return {
            from: () => ({
                select: (cols: string) => ({
                    not: async (col: string) => {
                        const selected = [...store.values()].map((row) => ({
                            id: row.id,
                            [col]: row[col as (typeof COLUMNS)[number]],
                        }));
                        expect(cols).toBe(`id, ${col}`);
                        return { data: selected, error: null };
                    },
                }),
                upsert: async (payload: Array<Record<string, string>>) => {
                    for (const update of payload) {
                        await new Promise((resolve) => setTimeout(resolve, 0));
                        Object.assign(store.get(update.id)!, update);
                        onRowWritten();
                    }
                    return { error: null };
                },
            }),
        } as any;
    }

    beforeEach(() => {
        // Current key (v1) is NEW_KEY; the old key is retained as v0 during rotation.
        process.env.FIELD_ENCRYPTION_KEY = NEW_KEY;
        process.env.FIELD_ENCRYPTION_KEY_0 = OLD_KEY;
    });

    afterEach(() => {
        delete process.env.FIELD_ENCRYPTION_KEY;
        delete process.env.FIELD_ENCRYPTION_KEY_0;
    });

    it('every read during the batched upsert decrypts under either the old or new key', async () => {
        const { store, plaintexts } = seedStore(5);
        const observedVersions = new Set<string>();
        let reads = 0;

        const supabase = makeSupabase(store, () => {
            reads++;
            for (const v of readAll(store, plaintexts)) observedVersions.add(v);
        });

        const summary = await rotateProfileEncryptedColumns(supabase);

        expect(summary.stripe_customer_id_encrypted.rotated).toBe(5);
        expect(summary.stripe_subscription_id_encrypted.rotated).toBe(5);
        expect(reads).toBe(10);
        // Mid-flight reads really did observe a mixture of old- and new-key blobs.
        expect(observedVersions).toEqual(new Set(['v0', 'v1']));

        // After rotation everything is on the new key and still decrypts correctly.
        expect(readAll(store, plaintexts)).toEqual(new Set(['v1']));
    });

    it('a reader polling concurrently with the whole rotation never sees a corrupted value', async () => {
        const { store, plaintexts } = seedStore(8);
        const supabase = makeSupabase(store, () => {});

        let done = false;
        let polls = 0;
        const reader = (async () => {
            while (!done) {
                readAll(store, plaintexts);
                polls++;
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        })();

        await rotateProfileEncryptedColumns(supabase);
        done = true;
        await reader;

        expect(polls).toBeGreaterThan(1);
        expect(readAll(store, plaintexts)).toEqual(new Set(['v1']));
    });

    it('a read while the upsert is pending sees the untouched old-key blob', async () => {
        const { store, plaintexts } = seedStore(3);
        let releaseUpsert!: () => void;
        const upsertGate = new Promise<void>((resolve) => { releaseUpsert = resolve; });
        let upsertStarted!: () => void;
        const upsertStartedSignal = new Promise<void>((resolve) => { upsertStarted = resolve; });

        const supabase = {
            from: () => ({
                select: (cols: string) => ({
                    not: async (col: string) => ({
                        data: [...store.values()].map((row) => ({ id: row.id, [col]: (row as any)[col] })),
                        error: null,
                    }),
                }),
                upsert: async (payload: Array<Record<string, string>>) => {
                    upsertStarted();
                    await upsertGate;
                    for (const update of payload) Object.assign(store.get(update.id)!, update);
                    return { error: null };
                },
            }),
        } as any;

        const rotation = rotateProfileEncryptedColumns(supabase);
        await upsertStartedSignal;

        // Upsert is mid-flight: the re-encrypted values exist only in the batch payload.
        expect(readAll(store, plaintexts)).toEqual(new Set(['v0']));

        releaseUpsert();
        await rotation;
        expect(readAll(store, plaintexts)).toEqual(new Set(['v1']));
    });

    it('reads fail loudly (not silently) if the old key is dropped before rotation finishes', async () => {
        const { store } = seedStore(1);
        delete process.env.FIELD_ENCRYPTION_KEY_0;

        expect(() => readField(store, 'row-0', 'stripe_customer_id_encrypted')).toThrow(
            /FIELD_ENCRYPTION_KEY_0 must be a 64-character hex string/,
        );
    });
});
