/**
 * Soroban Contract State Snapshot Service (Issue #794)
 *
 * Captures all persistent ContractData ledger entries for a contract at a
 * given ledger sequence and stores them compressed in Supabase Storage.
 * Supports restoring the snapshot into a Soroban simulation context for
 * offline debugging and point-in-time replay.
 *
 * ## Snapshot format
 * Each snapshot blob is zlib-deflate compressed JSON:
 *   { contractId, ledgerSequence, entries: [{ keyXdr, valueXdr, liveUntilLedgerSeq }] }
 *
 * ## Size limit
 * Uncompressed payload is capped at MAX_SNAPSHOT_BYTES (10 MB).
 * Exceeding this limit throws SnapshotSizeLimitError before any upload.
 *
 * ## Storage layout
 *   Bucket : contract-snapshots
 *   Path   : {contractId}/{ledgerSequence}.json.zlib
 *
 * ## DB metadata table: contract_snapshots
 *   id, contract_id, ledger_sequence, storage_path, entry_count,
 *   compressed_bytes, created_at
 *
 * ## Additional storage keys
 * To capture entries beyond the contract instance key, callers must supply
 * them explicitly via the `additionalKeys` parameter to `snapshot()`. The
 * instance key is always included automatically.
 *
 * Issue: #794, #968
 */

import { xdr, Contract } from 'stellar-sdk';
import type { SorobanRpc } from 'stellar-sdk';
import * as zlib from 'zlib';
import { promisify } from 'util';

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024; // 10 MB
export const SNAPSHOT_STORAGE_BUCKET = 'contract-snapshots';
export const SNAPSHOT_DB_TABLE = 'contract_snapshots';

const deflate = promisify(zlib.deflate);
const inflate = promisify(zlib.inflate);

// ── Error types ───────────────────────────────────────────────────────────────

export class SnapshotSizeLimitError extends Error {
    constructor(contractId: string, bytes: number) {
        super(
            `Snapshot for ${contractId} exceeds the 10 MB limit ` +
            `(uncompressed size: ${(bytes / 1024 / 1024).toFixed(2)} MB)`,
        );
        this.name = 'SnapshotSizeLimitError';
    }
}

export class SnapshotNotFoundError extends Error {
    constructor(snapshotId: string) {
        super(`Snapshot "${snapshotId}" not found`);
        this.name = 'SnapshotNotFoundError';
    }
}

export class SnapshotStorageError extends Error {
    constructor(operation: 'upload' | 'download', message: string) {
        super(`Snapshot ${operation} failed: ${message}`);
        this.name = 'SnapshotStorageError';
    }
}

// ── Data types ────────────────────────────────────────────────────────────────

export interface LedgerEntryRecord {
    /** Base64-encoded XDR of the ledger key. */
    keyXdr: string;
    /** Base64-encoded XDR of the ledger entry value. */
    valueXdr: string;
    /** Ledger sequence until which this entry is live; absent for expired entries. */
    liveUntilLedgerSeq?: number;
}

export interface SnapshotPayload {
    contractId: string;
    ledgerSequence: number;
    entries: LedgerEntryRecord[];
}

export interface ContractSnapshot {
    id: string;
    contractId: string;
    ledgerSequence: number;
    entryCount: number;
    compressedBytes: number;
    createdAt: string;
}

export interface RestoredSnapshot {
    contractId: string;
    ledgerSequence: number;
    entries: LedgerEntryRecord[];
}

// ── Narrow dependency interfaces for testability ──────────────────────────────

export interface SnapshotRpcClient {
    getLedgerEntries(
        ...keys: xdr.LedgerKey[]
    ): Promise<SorobanRpc.Api.GetLedgerEntriesResponse>;
}

export interface SnapshotStorage {
    upload(
        path: string,
        data: Buffer,
        opts: { contentType: string; upsert: boolean },
    ): Promise<{ error: { message: string } | null }>;

    download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
}

export interface SnapshotDb {
    insert(row: {
        contract_id: string;
        ledger_sequence: number;
        storage_path: string;
        entry_count: number;
        compressed_bytes: number;
    }): Promise<{ data: { id: string; created_at: string } | null; error: { message: string } | null }>;

    findById(id: string): Promise<{
        data: {
            id: string;
            contract_id: string;
            ledger_sequence: number;
            storage_path: string;
        } | null;
        error: { message: string } | null;
    }>;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class ContractStateSnapshotService {
    constructor(
        private readonly rpc: SnapshotRpcClient,
        private readonly storage: SnapshotStorage,
        private readonly db: SnapshotDb,
    ) {}

    /**
     * Capture persistent ContractData entries for `contractId` at `ledgerSequence`
     * and persist them compressed in Supabase Storage.
     *
     * Captures the contract instance entry by default. To include additional
     * persistent storage entries, pass `additionalKeys`.
     *
     * @param contractId - Contract address string
     * @param ledgerSequence - Ledger sequence number to capture
     * @param additionalKeys - Optional array of additional LedgerKey entries to capture
     *
     * @throws SnapshotSizeLimitError  when uncompressed payload exceeds 10 MB
     * @throws SnapshotStorageError    when the upload to Supabase Storage fails
     * @throws Error                   on DB metadata insert failure
     */
    async snapshot(
        contractId: string,
        ledgerSequence: number,
        additionalKeys: xdr.LedgerKey[] = [],
    ): Promise<ContractSnapshot> {
        const instanceKey = xdr.LedgerKey.contractData(
            new xdr.LedgerKeyContractData({
                contract: new Contract(contractId).address().toScAddress(),
                key: xdr.ScVal.scvLedgerKeyContractInstance(),
                durability: xdr.ContractDataDurability.persistent(),
            }),
        );

        const allKeys = [instanceKey, ...additionalKeys];
        const response = await this.rpc.getLedgerEntries(...allKeys);
        const rawEntries = response.entries ?? [];

        const entries: LedgerEntryRecord[] = rawEntries.map((entry) => ({
            keyXdr: entry.key.toXDR('base64'),
            valueXdr: entry.xdr.toXDR('base64'),
            liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
        }));

        const payload: SnapshotPayload = { contractId, ledgerSequence, entries };
        const json = JSON.stringify(payload);
        const uncompressedBytes = Buffer.byteLength(json, 'utf8');

        if (uncompressedBytes > MAX_SNAPSHOT_BYTES) {
            throw new SnapshotSizeLimitError(contractId, uncompressedBytes);
        }

        const compressed = await deflate(Buffer.from(json, 'utf8'));
        const storagePath = `${contractId}/${ledgerSequence}.json.zlib`;

        const { error: uploadError } = await this.storage.upload(
            storagePath,
            compressed,
            { contentType: 'application/zlib', upsert: true },
        );
        if (uploadError) {
            throw new SnapshotStorageError('upload', uploadError.message);
        }

        const { data, error: dbError } = await this.db.insert({
            contract_id: contractId,
            ledger_sequence: ledgerSequence,
            storage_path: storagePath,
            entry_count: entries.length,
            compressed_bytes: compressed.length,
        });

        if (dbError || !data) {
            throw new Error(`Failed to persist snapshot metadata: ${dbError?.message}`);
        }

        return {
            id: data.id,
            contractId,
            ledgerSequence,
            entryCount: entries.length,
            compressedBytes: compressed.length,
            createdAt: data.created_at,
        };
    }

    /**
     * Restore a previously captured snapshot for offline simulation.
     *
     * Downloads the compressed blob from Supabase Storage, decompresses it,
     * and returns the deserialized ledger entries.
     *
     * @throws SnapshotNotFoundError  when the snapshot ID does not exist in DB
     * @throws SnapshotStorageError   when the download from Supabase Storage fails
     * @throws SnapshotStorageError   when the downloaded blob contains corrupted
     *   or truncated JSON (identifies the snapshotId and storage_path)
     */
    async restore(snapshotId: string): Promise<RestoredSnapshot> {
        const { data: meta, error: metaError } = await this.db.findById(snapshotId);
        if (metaError || !meta) {
            throw new SnapshotNotFoundError(snapshotId);
        }

        const { data: blob, error: downloadError } = await this.storage.download(meta.storage_path);
        if (downloadError || !blob) {
            throw new SnapshotStorageError('download', downloadError?.message ?? 'empty response');
        }

        const buffer = Buffer.from(await blob.arrayBuffer());
        const decompressed = await inflate(buffer);

        let payload: SnapshotPayload;
        try {
            payload = JSON.parse(decompressed.toString('utf8')) as SnapshotPayload;
        } catch (err) {
            throw new SnapshotStorageError(
                'download',
                `Corrupted snapshot payload for snapshotId="${snapshotId}" ` +
                `at storage_path="${meta.storage_path}": ${(err as Error).message}`,
            );
        }

        return {
            contractId: payload.contractId,
            ledgerSequence: payload.ledgerSequence,
            entries: payload.entries,
        };
    }
}
