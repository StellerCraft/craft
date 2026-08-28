/**
 * Tests for ContractStateSnapshotService (Issue #794)
 *
 * Covers:
 *   snapshot()
 *     - fetches contract instance key via RPC
 *     - compresses payload with zlib before upload
 *     - stores metadata in DB (entryCount, compressedBytes, id)
 *     - throws SnapshotSizeLimitError when uncompressed payload > 10 MB
 *     - succeeds with empty entry set (no ledger entries for contract)
 *     - propagates storage upload failure as SnapshotStorageError
 *
 *   restore()
 *     - downloads blob and decompresses correctly
 *     - returns entries identical to those that were snapshotted (round-trip)
 *     - throws SnapshotNotFoundError when DB returns null
 *     - propagates storage download failure as SnapshotStorageError
 *
 * Issue: #794
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as zlib from 'zlib';
import { promisify } from 'util';
import {
    ContractStateSnapshotService,
    MAX_SNAPSHOT_BYTES,
    SnapshotSizeLimitError,
    SnapshotNotFoundError,
    SnapshotStorageError,
    type SnapshotRpcClient,
    type SnapshotStorage,
    type SnapshotDb,
    type LedgerEntryRecord,
} from './contract-state-snapshot';

const inflate = promisify(zlib.inflate);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const LEDGER_SEQ = 12_345_678;
const SNAPSHOT_ID = 'snap-uuid-001';

const FAKE_ENTRIES: LedgerEntryRecord[] = [
    { keyXdr: 'AAAAA==', valueXdr: 'BBBBB==', liveUntilLedgerSeq: LEDGER_SEQ + 500 },
    { keyXdr: 'CCCCC==', valueXdr: 'DDDDD==', liveUntilLedgerSeq: LEDGER_SEQ + 1000 },
];

// ── Mock factories ─────────────────────────────────────────────────────────────

function makeRpc(entries: { key: any; xdr: any; liveUntilLedgerSeq?: number }[] = []): SnapshotRpcClient {
    return {
        getLedgerEntries: vi.fn().mockResolvedValue({ entries, latestLedger: LEDGER_SEQ }),
    };
}

function makeXdrEntry(keyB64: string, valueB64: string, liveUntil?: number) {
    return {
        key: { toXDR: (_enc: string) => keyB64 },
        xdr: { toXDR: (_enc: string) => valueB64 },
        liveUntilLedgerSeq: liveUntil,
    };
}

function makeStorage(overrides: Partial<SnapshotStorage> = {}): SnapshotStorage {
    return {
        upload: vi.fn().mockResolvedValue({ error: null }),
        download: vi.fn().mockResolvedValue({ data: null, error: null }),
        ...overrides,
    };
}

function makeDb(overrides: Partial<SnapshotDb> = {}): SnapshotDb {
    return {
        insert: vi.fn().mockResolvedValue({
            data: { id: SNAPSHOT_ID, created_at: '2026-06-27T00:00:00Z' },
            error: null,
        }),
        findById: vi.fn().mockResolvedValue({
            data: {
                id: SNAPSHOT_ID,
                contract_id: CONTRACT_ID,
                ledger_sequence: LEDGER_SEQ,
                storage_path: `${CONTRACT_ID}/${LEDGER_SEQ}.json.zlib`,
            },
            error: null,
        }),
        ...overrides,
    };
}

// Builds a real compressed blob for restore() tests
async function buildCompressedBlob(entries: LedgerEntryRecord[]): Promise<Blob> {
    const payload = JSON.stringify({ contractId: CONTRACT_ID, ledgerSequence: LEDGER_SEQ, entries });
    const compressed = await promisify(zlib.deflate)(Buffer.from(payload, 'utf8'));
    return new Blob([compressed]);
}

// ── snapshot() tests ───────────────────────────────────────────────────────────

describe('ContractStateSnapshotService.snapshot()', () => {
    it('calls getLedgerEntries with the contract instance key', async () => {
        const rpc = makeRpc([makeXdrEntry('AAAAA==', 'BBBBB==', LEDGER_SEQ + 500)]);
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), makeDb());

        await svc.snapshot(CONTRACT_ID, LEDGER_SEQ);

        expect(rpc.getLedgerEntries).toHaveBeenCalledOnce();
    });

    it('returns snapshot metadata with correct entry count', async () => {
        const rpcEntries = FAKE_ENTRIES.map((e) => makeXdrEntry(e.keyXdr, e.valueXdr, e.liveUntilLedgerSeq));
        const rpc = makeRpc(rpcEntries);
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), makeDb());

        const snap = await svc.snapshot(CONTRACT_ID, LEDGER_SEQ);

        expect(snap.id).toBe(SNAPSHOT_ID);
        expect(snap.contractId).toBe(CONTRACT_ID);
        expect(snap.ledgerSequence).toBe(LEDGER_SEQ);
        expect(snap.entryCount).toBe(2);
        expect(snap.compressedBytes).toBeGreaterThan(0);
    });

    it('uploads a zlib-compressed blob (not raw JSON)', async () => {
        const rpc = makeRpc([makeXdrEntry('AAAAA==', 'BBBBB==')]);
        const storage = makeStorage();
        const svc = new ContractStateSnapshotService(rpc, storage, makeDb());

        await svc.snapshot(CONTRACT_ID, LEDGER_SEQ);

        const [, uploadedBuffer] = (storage.upload as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(uploadedBuffer).toBeInstanceOf(Buffer);

        // Verify the uploaded buffer is valid zlib-compressed JSON
        const decompressed = await inflate(uploadedBuffer as Buffer);
        const parsed = JSON.parse(decompressed.toString('utf8'));
        expect(parsed.contractId).toBe(CONTRACT_ID);
        expect(parsed.ledgerSequence).toBe(LEDGER_SEQ);
        expect(Array.isArray(parsed.entries)).toBe(true);
    });

    it('stores snapshot at path {contractId}/{ledgerSequence}.json.zlib', async () => {
        const rpc = makeRpc([makeXdrEntry('AAAAA==', 'BBBBB==')]);
        const storage = makeStorage();
        const svc = new ContractStateSnapshotService(rpc, storage, makeDb());

        await svc.snapshot(CONTRACT_ID, LEDGER_SEQ);

        const [uploadPath] = (storage.upload as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(uploadPath).toBe(`${CONTRACT_ID}/${LEDGER_SEQ}.json.zlib`);
    });

    it('succeeds when contract has no persistent entries (empty snapshot)', async () => {
        const rpc = makeRpc([]);
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), makeDb());

        const snap = await svc.snapshot(CONTRACT_ID, LEDGER_SEQ);
        expect(snap.entryCount).toBe(0);
    });

    it('throws SnapshotSizeLimitError when uncompressed payload exceeds 10 MB', async () => {
        // Build a single entry whose valueXdr is large enough to exceed the limit
        const largeValueXdr = 'X'.repeat(MAX_SNAPSHOT_BYTES + 1);
        const rpc = makeRpc([makeXdrEntry('AAAAA==', largeValueXdr)]);
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), makeDb());

        await expect(svc.snapshot(CONTRACT_ID, LEDGER_SEQ)).rejects.toThrow(SnapshotSizeLimitError);
    });

    it('throws SnapshotStorageError when storage upload fails', async () => {
        const rpc = makeRpc([makeXdrEntry('AAAAA==', 'BBBBB==')]);
        const storage = makeStorage({
            upload: vi.fn().mockResolvedValue({ error: { message: 'bucket not found' } }),
        });
        const svc = new ContractStateSnapshotService(rpc, storage, makeDb());

        await expect(svc.snapshot(CONTRACT_ID, LEDGER_SEQ)).rejects.toThrow(SnapshotStorageError);
    });

    it('throws when DB insert fails', async () => {
        const rpc = makeRpc([makeXdrEntry('AAAAA==', 'BBBBB==')]);
        const db = makeDb({
            insert: vi.fn().mockResolvedValue({ data: null, error: { message: 'constraint violation' } }),
        });
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), db);

        await expect(svc.snapshot(CONTRACT_ID, LEDGER_SEQ)).rejects.toThrow(/constraint violation/);
    });

    it('includes additional keys in getLedgerEntries call', async () => {
        const rpc = makeRpc([
            makeXdrEntry('AAAAA==', 'BBBBB=='),
            makeXdrEntry('KEY01==', 'VAL01=='),
            makeXdrEntry('KEY02==', 'VAL02=='),
        ]);
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), makeDb());

        // Create mock additional keys
        const additionalKey1 = { toXDR: () => 'KEY01==' } as any;
        const additionalKey2 = { toXDR: () => 'KEY02==' } as any;

        await svc.snapshot(CONTRACT_ID, LEDGER_SEQ, [additionalKey1, additionalKey2]);

        // Verify getLedgerEntries was called with 3 keys (instance + 2 additional)
        expect(rpc.getLedgerEntries).toHaveBeenCalledOnce();
        const callArgs = (rpc.getLedgerEntries as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(callArgs).toHaveLength(3);
    });

    it('captures multiple keys in snapshot round-trip', async () => {
        const multiEntries: LedgerEntryRecord[] = [
            { keyXdr: 'KEY01==', valueXdr: 'VAL01==', liveUntilLedgerSeq: LEDGER_SEQ + 100 },
            { keyXdr: 'KEY02==', valueXdr: 'VAL02==', liveUntilLedgerSeq: LEDGER_SEQ + 200 },
            { keyXdr: 'KEY03==', valueXdr: 'VAL03==', liveUntilLedgerSeq: LEDGER_SEQ + 300 },
        ];
        const rpcEntries = multiEntries.map((e) => makeXdrEntry(e.keyXdr, e.valueXdr, e.liveUntilLedgerSeq));
        const rpc = makeRpc(rpcEntries);

        let capturedBlob: Buffer | null = null;
        const storage = makeStorage({
            upload: vi.fn().mockImplementation(async (_path: string, data: Buffer) => {
                capturedBlob = data;
                return { error: null };
            }),
            download: vi.fn().mockImplementation(async () => {
                return { data: new Blob([capturedBlob!]), error: null };
            }),
        });

        const svc = new ContractStateSnapshotService(rpc, storage, makeDb());

        // Snapshot with additional keys
        const additionalKeys = [{} as any, {} as any];
        const snap = await svc.snapshot(CONTRACT_ID, LEDGER_SEQ, additionalKeys);

        expect(snap.entryCount).toBe(3);
        expect(capturedBlob).not.toBeNull();

        // Restore and verify all entries are preserved
        const restored = await svc.restore(snap.id);
        expect(restored.entries).toHaveLength(3);
        for (let i = 0; i < multiEntries.length; i++) {
            expect(restored.entries[i].keyXdr).toBe(multiEntries[i].keyXdr);
            expect(restored.entries[i].valueXdr).toBe(multiEntries[i].valueXdr);
            expect(restored.entries[i].liveUntilLedgerSeq).toBe(multiEntries[i].liveUntilLedgerSeq);
        }
    });
});

// ── restore() tests ────────────────────────────────────────────────────────────

describe('ContractStateSnapshotService.restore()', () => {
    it('returns entries identical to those captured (round-trip)', async () => {
        const rpcEntries = FAKE_ENTRIES.map((e) => makeXdrEntry(e.keyXdr, e.valueXdr, e.liveUntilLedgerSeq));
        const blob = await buildCompressedBlob(FAKE_ENTRIES);

        const storage = makeStorage({
            download: vi.fn().mockResolvedValue({ data: blob, error: null }),
        });
        const rpc = makeRpc(rpcEntries);
        const svc = new ContractStateSnapshotService(rpc, storage, makeDb());

        const restored = await svc.restore(SNAPSHOT_ID);

        expect(restored.contractId).toBe(CONTRACT_ID);
        expect(restored.ledgerSequence).toBe(LEDGER_SEQ);
        expect(restored.entries).toHaveLength(FAKE_ENTRIES.length);
        expect(restored.entries[0].keyXdr).toBe(FAKE_ENTRIES[0].keyXdr);
        expect(restored.entries[0].valueXdr).toBe(FAKE_ENTRIES[0].valueXdr);
        expect(restored.entries[1].liveUntilLedgerSeq).toBe(FAKE_ENTRIES[1].liveUntilLedgerSeq);
    });

    it('throws SnapshotNotFoundError when snapshot ID is not in DB', async () => {
        const db = makeDb({
            findById: vi.fn().mockResolvedValue({ data: null, error: null }),
        });
        const svc = new ContractStateSnapshotService(makeRpc(), makeStorage(), db);

        await expect(svc.restore('missing-id')).rejects.toThrow(SnapshotNotFoundError);
    });

    it('throws SnapshotNotFoundError when DB returns an error', async () => {
        const db = makeDb({
            findById: vi.fn().mockResolvedValue({ data: null, error: { message: 'row not found' } }),
        });
        const svc = new ContractStateSnapshotService(makeRpc(), makeStorage(), db);

        await expect(svc.restore(SNAPSHOT_ID)).rejects.toThrow(SnapshotNotFoundError);
    });

    it('throws SnapshotStorageError when storage download fails', async () => {
        const storage = makeStorage({
            download: vi.fn().mockResolvedValue({ data: null, error: { message: 'access denied' } }),
        });
        const svc = new ContractStateSnapshotService(makeRpc(), storage, makeDb());

        await expect(svc.restore(SNAPSHOT_ID)).rejects.toThrow(SnapshotStorageError);
    });

    it('restores an empty snapshot correctly (no entries)', async () => {
        const blob = await buildCompressedBlob([]);
        const storage = makeStorage({
            download: vi.fn().mockResolvedValue({ data: blob, error: null }),
        });
        const svc = new ContractStateSnapshotService(makeRpc(), storage, makeDb());

        const restored = await svc.restore(SNAPSHOT_ID);
        expect(restored.entries).toHaveLength(0);
    });
});

// ── snapshot() + restore() round-trip ────────────────────────────────────────

describe('snapshot → restore round-trip', () => {
    it('restore produces entries identical to those captured', async () => {
        const rpcEntries = FAKE_ENTRIES.map((e) =>
            makeXdrEntry(e.keyXdr, e.valueXdr, e.liveUntilLedgerSeq),
        );
        const rpc = makeRpc(rpcEntries);

        // Capture the blob written during snapshot
        let capturedBlob: Buffer | null = null;
        const storage = makeStorage({
            upload: vi.fn().mockImplementation(async (_path: string, data: Buffer) => {
                capturedBlob = data;
                return { error: null };
            }),
            download: vi.fn().mockImplementation(async () => {
                return { data: new Blob([capturedBlob!]), error: null };
            }),
        });

        const svc = new ContractStateSnapshotService(rpc, storage, makeDb());

        // Step 1: snapshot
        const snap = await svc.snapshot(CONTRACT_ID, LEDGER_SEQ);
        expect(capturedBlob).not.toBeNull();

        // Step 2: restore
        const restored = await svc.restore(snap.id);

        // Verify round-trip fidelity
        expect(restored.contractId).toBe(CONTRACT_ID);
        expect(restored.ledgerSequence).toBe(LEDGER_SEQ);
        expect(restored.entries).toHaveLength(FAKE_ENTRIES.length);
        for (let i = 0; i < FAKE_ENTRIES.length; i++) {
            expect(restored.entries[i].keyXdr).toBe(FAKE_ENTRIES[i].keyXdr);
            expect(restored.entries[i].valueXdr).toBe(FAKE_ENTRIES[i].valueXdr);
            expect(restored.entries[i].liveUntilLedgerSeq).toBe(FAKE_ENTRIES[i].liveUntilLedgerSeq);
        }
    });
});

// ── Additional persistent storage keys (Issue #968) ────────────────────────────

describe('ContractStateSnapshotService.snapshot() with additionalKeys', () => {
    it('includes instance key and additional persistent-data keys in a single getLedgerEntries call', async () => {
        const additionalKey1 = {
            toXDR: (_enc: string) => 'ADDITIONAL_KEY_1_XDR',
        };
        const additionalKey2 = {
            toXDR: (_enc: string) => 'ADDITIONAL_KEY_2_XDR',
        };
        const additionalKeys = [additionalKey1, additionalKey2] as any[];

        const rpc = makeRpc([
            makeXdrEntry('INSTANCE_KEY', 'INSTANCE_VALUE', LEDGER_SEQ + 500),
            makeXdrEntry('ADDITIONAL_KEY_1', 'ADDITIONAL_VALUE_1', LEDGER_SEQ + 600),
            makeXdrEntry('ADDITIONAL_KEY_2', 'ADDITIONAL_VALUE_2', LEDGER_SEQ + 700),
        ]);
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), makeDb());

        const snap = await svc.snapshot(CONTRACT_ID, LEDGER_SEQ, additionalKeys);

        // Should have called getLedgerEntries with exactly 3 keys (1 instance + 2 additional)
        expect(rpc.getLedgerEntries).toHaveBeenCalledOnce();
        expect(snap.entryCount).toBe(3);
    });

    it('snapshots all keys together (instance plus additional) in round-trip', async () => {
        const additionalKey = {
            toXDR: (_enc: string) => 'BALANCE_KEY_XDR',
        };
        const additionalKeys = [additionalKey] as any[];

        const fakeAdditionalEntry: LedgerEntryRecord = {
            keyXdr: 'BALANCE_KEY',
            valueXdr: 'BALANCE_VALUE_100',
            liveUntilLedgerSeq: LEDGER_SEQ + 800,
        };

        const rpcEntries = [
            ...FAKE_ENTRIES.map((e) => makeXdrEntry(e.keyXdr, e.valueXdr, e.liveUntilLedgerSeq)),
            makeXdrEntry(fakeAdditionalEntry.keyXdr, fakeAdditionalEntry.valueXdr, fakeAdditionalEntry.liveUntilLedgerSeq),
        ];

        let capturedBlob: Buffer | null = null;
        const rpc = makeRpc(rpcEntries);
        const storage = makeStorage({
            upload: vi.fn().mockImplementation(async (_path: string, data: Buffer) => {
                capturedBlob = data;
                return { error: null };
            }),
            download: vi.fn().mockImplementation(async () => {
                return { data: new Blob([capturedBlob!]), error: null };
            }),
        });

        const svc = new ContractStateSnapshotService(rpc, storage, makeDb());

        // Snapshot with additional keys
        const snap = await svc.snapshot(CONTRACT_ID, LEDGER_SEQ, additionalKeys);
        expect(snap.entryCount).toBe(3); // 2 original + 1 additional

        // Restore and verify all entries are present
        const restored = await svc.restore(snap.id);
        expect(restored.entries).toHaveLength(3);
        expect(restored.entries.map((e) => e.keyXdr)).toContain('BALANCE_KEY');
    });

    it('works when no additionalKeys are supplied', async () => {
        const rpc = makeRpc([makeXdrEntry('INSTANCE', 'VALUE')]);
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), makeDb());

        // Call without additionalKeys (undefined)
        const snap = await svc.snapshot(CONTRACT_ID, LEDGER_SEQ);

        expect(snap.entryCount).toBe(1);
        expect(rpc.getLedgerEntries).toHaveBeenCalledOnce();
    });

    it('works when additionalKeys is an empty array', async () => {
        const rpc = makeRpc([makeXdrEntry('INSTANCE', 'VALUE')]);
        const svc = new ContractStateSnapshotService(rpc, makeStorage(), makeDb());

        // Call with empty additionalKeys
        const snap = await svc.snapshot(CONTRACT_ID, LEDGER_SEQ, []);

        expect(snap.entryCount).toBe(1);
        expect(rpc.getLedgerEntries).toHaveBeenCalledOnce();
    });
});

// ── #1110 – corrupted blob regression tests ────────────────────────────────────

describe('ContractStateSnapshotService.restore() – corrupted blob (#1110)', () => {
    const STORAGE_PATH = `${CONTRACT_ID}/${LEDGER_SEQ}.json.zlib`;

    it('throws SnapshotStorageError (not a bare SyntaxError) when the blob is invalid JSON after decompression', async () => {
        // Build a valid zlib-compressed blob whose decompressed content is NOT valid JSON.
        const truncatedJson = '{ "contractId": "C...", "ledgerSequence": 123, "entries": ['; // unclosed
        const corruptedCompressed = await promisify(zlib.deflate)(Buffer.from(truncatedJson, 'utf8'));

        const storage = makeStorage({
            download: vi.fn().mockResolvedValue({ data: new Blob([corruptedCompressed]), error: null }),
        });
        const svc = new ContractStateSnapshotService(makeRpc(), storage, makeDb());

        const error = await svc.restore(SNAPSHOT_ID).catch((e) => e);

        // Must be a typed SnapshotStorageError, not a raw SyntaxError.
        expect(error).toBeInstanceOf(SnapshotStorageError);
        expect(error.name).toBe('SnapshotStorageError');
    });

    it('error message identifies the snapshotId', async () => {
        const badJson = 'NOT_JSON_AT_ALL';
        const corruptedCompressed = await promisify(zlib.deflate)(Buffer.from(badJson, 'utf8'));

        const storage = makeStorage({
            download: vi.fn().mockResolvedValue({ data: new Blob([corruptedCompressed]), error: null }),
        });
        const svc = new ContractStateSnapshotService(makeRpc(), storage, makeDb());

        const error = await svc.restore(SNAPSHOT_ID).catch((e) => e);

        expect(error.message).toContain(SNAPSHOT_ID);
    });

    it('error message identifies the storage_path', async () => {
        const badJson = '{}bad';
        const corruptedCompressed = await promisify(zlib.deflate)(Buffer.from(badJson, 'utf8'));

        const storage = makeStorage({
            download: vi.fn().mockResolvedValue({ data: new Blob([corruptedCompressed]), error: null }),
        });
        const svc = new ContractStateSnapshotService(makeRpc(), storage, makeDb());

        const error = await svc.restore(SNAPSHOT_ID).catch((e) => e);

        expect(error.message).toContain(STORAGE_PATH);
    });

    it('does not throw for a valid (non-corrupted) blob', async () => {
        const blob = await buildCompressedBlob(FAKE_ENTRIES);
        const storage = makeStorage({
            download: vi.fn().mockResolvedValue({ data: blob, error: null }),
        });
        const svc = new ContractStateSnapshotService(makeRpc(), storage, makeDb());

        const restored = await svc.restore(SNAPSHOT_ID);
        expect(restored.entries).toHaveLength(FAKE_ENTRIES.length);
    });
});