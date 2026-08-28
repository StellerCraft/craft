/**
 * Soroban Contract Ledger Entry TTL Management (Issue #092)
 *
 * Tracks the time-to-live (TTL) of persistent Soroban ledger entries and
 * automatically builds TTL extension transactions before they expire.
 *
 * ## Background
 * Soroban persistent storage entries carry a `liveUntilLedgerSeq` value.
 * Once `currentLedger > liveUntilLedgerSeq` the entry is archived and no
 * longer accessible without a restore operation.  With ~5 s per ledger,
 * 1 000 remaining ledgers is approximately 83 minutes of runway.
 *
 * ## Flow
 * 1. Call `getLedgerEntryTtl` with a list of ledger keys.
 * 2. Inspect `isNearExpiration` / `isExpired` on each result.
 * 3. Pass at-risk keys to `buildTtlExtensionTransaction` to obtain a
 *    prepared, unsigned transaction that extends their TTL.
 * 4. Sign and submit the prepared transaction via `sendSorobanTransaction`.
 *
 * ## High-level helper
 * `checkContractTtl(contractId)` wraps steps 1–3 for the common case of
 * managing a contract's own instance entry.
 *
 * @see https://developers.stellar.org/docs/smart-contracts/storage-and-ttl
 */

import {
    SorobanRpc,
    xdr,
    Contract,
    TransactionBuilder,
    Operation,
    BASE_FEE,
    SorobanDataBuilder,
} from 'stellar-sdk';
import { getSorobanRpcUrl, getNetworkPassphrase } from './config';
import { parseStellarError } from './errors';
import type { LedgerEventEmitter } from './dex-price-feed';

// ── Defaults ──────────────────────────────────────────────────────────────────

/**
 * Warn when fewer than this many ledgers remain on an entry.
 * ~1 000 ledgers ≈ 83 minutes at 5 s/ledger.
 */
export const DEFAULT_WARNING_LEDGERS = 1_000;

/**
 * Target live-until value expressed as ledgers **from now** when extending TTL.
 * ~172 800 ledgers ≈ 1 week at 5 s/ledger.
 */
export const DEFAULT_EXTEND_TO_LEDGERS = 172_800;

// ── Public types ──────────────────────────────────────────────────────────────

export interface TtlThresholds {
    /** Remaining-ledger count below which an entry is considered near expiration. */
    warningLedgers?: number;
    /** How many ledgers from now to extend an at-risk entry's TTL to. */
    extendToLedgers?: number;
}

export interface LedgerEntryTtlInfo {
    key: xdr.LedgerKey;
    /** Ledger sequence after which the entry is archived, or null if unavailable. */
    liveUntilLedger: number | null;
    /** Sequence number of the latest ledger at query time. */
    currentLedger: number;
    /** Remaining ledgers = liveUntilLedger − currentLedger, or null. */
    remainingLedgers: number | null;
    /** true when liveUntilLedger < currentLedger (entry has expired). */
    isExpired: boolean;
    /** true when remainingLedgers < warningLedgers (entry is at risk). */
    isNearExpiration: boolean;
}

export interface ContractTtlStatus {
    contractId: string;
    /** TTL info for the contract's own instance entry. */
    instanceTtl: LedgerEntryTtlInfo;
    /** Prepared unsigned transaction XDR for TTL extension, or null when not needed. */
    extensionTxXdr: string | null;
}

export type TtlCheckResult =
    | { ok: true; status: ContractTtlStatus }
    | { ok: false; error: string };

// ── Ledger key helpers ────────────────────────────────────────────────────────

/**
 * Build the `LedgerKey` for a Soroban contract's own instance entry.
 * This is the key under which the contract's WASM hash and storage are held.
 *
 * @param contractId - The contract address (C...)
 */
export function buildContractInstanceKey(contractId: string): xdr.LedgerKey {
    return new Contract(contractId).getFootprint();
}

/**
 * Build a `LedgerKey` for a named persistent contract data entry.
 *
 * @param contractId - The contract address (C...)
 * @param storageKey - The `ScVal` used as the storage key inside the contract
 */
export function buildContractDataKey(contractId: string, storageKey: xdr.ScVal): xdr.LedgerKey {
    const contract = new Contract(contractId);
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: contract.address().toScAddress(),
            key: storageKey,
            durability: xdr.ContractDataDurability.persistent(),
        }),
    );
}

// ── TTL query ─────────────────────────────────────────────────────────────────

/**
 * Query the current TTL for each ledger key and classify entries as
 * near-expiration, expired, or healthy.
 *
 * @param keys - Ledger keys to inspect
 * @param thresholds - Optional TTL classification thresholds
 * @param client - Optional Soroban RPC client override (for testing)
 * @returns One `LedgerEntryTtlInfo` per key in the same order
 */
export async function getLedgerEntryTtl(
    keys: xdr.LedgerKey[],
    thresholds: TtlThresholds = {},
    client: Pick<SorobanRpc.Server, 'getLedgerEntries' | 'getLatestLedger'> = new SorobanRpc.Server(
        getSorobanRpcUrl(),
        { allowHttp: false },
    ),
): Promise<LedgerEntryTtlInfo[]> {
    const warningLedgers = thresholds.warningLedgers ?? DEFAULT_WARNING_LEDGERS;

    const [latestLedger, entriesResponse] = await Promise.all([
        client.getLatestLedger(),
        client.getLedgerEntries(...keys),
    ]);

    const currentLedger = latestLedger.sequence;

    return keys.map((key) => {
        const entry = entriesResponse.entries.find(
            (e) => e.key.toXDR('base64') === key.toXDR('base64'),
        );

        const liveUntilLedger = entry?.liveUntilLedgerSeq ?? null;
        const remainingLedgers =
            liveUntilLedger !== null ? liveUntilLedger - currentLedger : null;
        const isExpired = liveUntilLedger !== null && liveUntilLedger < currentLedger;
        const isNearExpiration =
            !isExpired && remainingLedgers !== null && remainingLedgers < warningLedgers;

        return { key, liveUntilLedger, currentLedger, remainingLedgers, isExpired, isNearExpiration };
    });
}

// ── TTL extension transaction builder ────────────────────────────────────────

/**
 * Build an unsigned `ExtendFootprintTtl` transaction for the given keys.
 *
 * The transaction must be signed and submitted by the caller. Simulate it
 * first via `SorobanRpc.Server.prepareTransaction` before signing.
 *
 * @param keys - Ledger keys whose TTL should be extended
 * @param sourcePublicKey - Account that will sign and pay fees
 * @param thresholds - Optional TTL thresholds (defaults used when omitted)
 * @param client - Optional Soroban RPC client override (for testing)
 * @returns Base64 XDR of the prepared unsigned transaction
 */
export async function buildTtlExtensionTransaction(
    keys: xdr.LedgerKey[],
    sourcePublicKey: string,
    thresholds: TtlThresholds = {},
    client: Pick<SorobanRpc.Server, 'getAccount' | 'prepareTransaction'> = new SorobanRpc.Server(
        getSorobanRpcUrl(),
        { allowHttp: false },
    ),
): Promise<string> {
    const extendToLedgers = thresholds.extendToLedgers ?? DEFAULT_EXTEND_TO_LEDGERS;

    const account = await client.getAccount(sourcePublicKey);

    const sorobanData = new SorobanDataBuilder()
        .setReadOnly(keys)
        .build();

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: getNetworkPassphrase(),
    })
        .addOperation(Operation.extendFootprintTtl({ extendTo: extendToLedgers }))
        .setSorobanData(sorobanData)
        .setTimeout(30)
        .build();

    const prepared = await client.prepareTransaction(tx);
    return prepared.toXDR();
}

// ── High-level contract TTL check ────────────────────────────────────────────

/**
 * Check whether a contract's instance entry is approaching expiration and,
 * if so, build a TTL extension transaction automatically.
 *
 * @param contractId - The contract address (C...)
 * @param sourcePublicKey - Account to use when building the extension transaction
 * @param thresholds - Optional TTL classification and extension thresholds
 * @param ttlClient - Optional client override for TTL queries (for testing)
 * @param txClient - Optional client override for transaction building (for testing)
 * @returns `{ ok: true, status }` on success, `{ ok: false, error }` on failure
 *
 * @example
 * ```typescript
 * const result = await checkContractTtl(contractId, operatorKey);
 * if (result.ok && result.status.extensionTxXdr) {
 *   const signedXdr = await walletSign(result.status.extensionTxXdr);
 *   await sendSorobanTransaction(signedXdr);
 * }
 * ```
 */
export async function checkContractTtl(
    contractId: string,
    sourcePublicKey: string,
    thresholds: TtlThresholds = {},
    ttlClient?: Parameters<typeof getLedgerEntryTtl>[2],
    txClient?: Parameters<typeof buildTtlExtensionTransaction>[3],
): Promise<TtlCheckResult> {
    try {
        const instanceKey = buildContractInstanceKey(contractId);
        const [instanceTtl] = await getLedgerEntryTtl([instanceKey], thresholds, ttlClient);

        let extensionTxXdr: string | null = null;
        if (instanceTtl.isNearExpiration || instanceTtl.isExpired) {
            extensionTxXdr = await buildTtlExtensionTransaction(
                [instanceKey],
                sourcePublicKey,
                thresholds,
                txClient,
            );
        }

        return { ok: true, status: { contractId, instanceTtl, extensionTxXdr } };
    } catch (error: unknown) {
        const parsed = parseStellarError(error);
        return { ok: false, error: parsed.message };
    }
}

// ---------------------------------------------------------------------------
// Automated TTL Renewal with Ledger-Sequence Awareness (#792)
// ---------------------------------------------------------------------------

/** Threshold: queue renewal when TTL remaining drops below this many ledgers. */
export const RENEWAL_QUEUE_THRESHOLD = 1_000;

/** Trigger renewal when TTL remaining reaches this many ledgers (50% of threshold). */
export const RENEWAL_TRIGGER_LEDGERS = 500;

/**
 * Maximum number of ledger keys packed into a single `ExtendFootprintTtl`
 * renewal transaction.
 *
 * Soroban enforces hard per-transaction footprint and resource limits. A
 * watchlist covering many deployed contracts can have a large number of
 * entries reach their renewal urgency in the same tick; batching all of them
 * into one transaction would exceed those limits and fail the whole batch at
 * simulation/submission time — including entries nowhere near expiry. `_tick`
 * therefore splits an oversized queue into sequential sub-batches of at most
 * this size and attempts each independently.
 */
export const MAX_RENEWAL_BATCH_SIZE = 50;

export interface RenewalAlert {
    type: 'renewal_failed';
    keys: xdr.LedgerKey[];
    error: string;
    timestamp: number;
}

export type AlertHandler = (alert: RenewalAlert) => void;

export interface AutomaticTTLRenewerOptions {
    /** How often to poll ledger sequence in milliseconds. Default: 10 000 (10 s). Only used in polling mode. */
    pollIntervalMs?: number;
    /** TTL thresholds forwarded to `getLedgerEntryTtl` / `buildTtlExtensionTransaction`. */
    thresholds?: TtlThresholds;
    /** Called when a batch renewal transaction fails. */
    onAlert?: AlertHandler;
    /** Soroban RPC client for TTL queries. */
    ttlClient?: Parameters<typeof getLedgerEntryTtl>[2];
    /** Soroban RPC client for transaction building. */
    txClient?: Parameters<typeof buildTtlExtensionTransaction>[3];
    /** Optional ledger event emitter for event-driven mode. When provided, subscriptions are triggered on ledger-close events instead of polling. */
    ledgerEmitter?: LedgerEventEmitter;
}

/**
 * Monitors a set of ledger keys and automatically submits batched TTL
 * renewal transactions when entries approach expiry.
 *
 * ## How it works
 * 1. `start()` begins polling the ledger sequence at `pollIntervalMs`.
 * 2. On each tick all registered keys are queried via `getLedgerEntryTtl`.
 * 3. Keys with `remainingLedgers <= RENEWAL_QUEUE_THRESHOLD` are queued.
 * 4. When any queued key reaches `remainingLedgers <= RENEWAL_TRIGGER_LEDGERS`
 *    the entire queue is batched into a single `ExtendFootprintTtl` tx.
 * 5. If the renewal transaction fails, `onAlert` is called with a
 *    `RenewalAlert` so callers can take corrective action.
 */
export class AutomaticTTLRenewer {
    private readonly keys: xdr.LedgerKey[] = [];
    private readonly sourcePublicKey: string;
    private readonly options: Required<AutomaticTTLRenewerOptions>;
    private intervalHandle: ReturnType<typeof setInterval> | null = null;
    private ledgerHandler: ((ledger: any) => void) | null = null;

    constructor(sourcePublicKey: string, options: AutomaticTTLRenewerOptions = {}) {
        this.sourcePublicKey = sourcePublicKey;
        this.options = {
            pollIntervalMs: options.pollIntervalMs ?? 10_000,
            thresholds: options.thresholds ?? {},
            onAlert: options.onAlert ?? (() => undefined),
            ttlClient: options.ttlClient ?? (new SorobanRpc.Server(getSorobanRpcUrl(), { allowHttp: false }) as Parameters<typeof getLedgerEntryTtl>[2]),
            txClient: options.txClient ?? (new SorobanRpc.Server(getSorobanRpcUrl(), { allowHttp: false }) as Parameters<typeof buildTtlExtensionTransaction>[3]),
            ledgerEmitter: options.ledgerEmitter,
        };
    }

    /** Register a ledger key to be monitored. */
    watch(key: xdr.LedgerKey): this {
        this.keys.push(key);
        return this;
    }

    /** Start the monitoring loop (polling or event-driven based on configuration). */
    start(): this {
        if (this.options.ledgerEmitter) {
            if (this.ledgerHandler !== null) return this;
            this.ledgerHandler = () => void this._tick();
            this.options.ledgerEmitter.on('ledger', this.ledgerHandler);
        } else {
            if (this.intervalHandle !== null) return this;
            this.intervalHandle = setInterval(() => void this._tick(), this.options.pollIntervalMs);
        }
        return this;
    }

    /** Stop the monitoring loop (polling or event-driven). */
    stop(): this {
        if (this.options.ledgerEmitter) {
            if (this.ledgerHandler !== null) {
                this.options.ledgerEmitter.off('ledger', this.ledgerHandler);
                this.ledgerHandler = null;
            }
        } else {
            if (this.intervalHandle !== null) {
                clearInterval(this.intervalHandle);
                this.intervalHandle = null;
            }
        }
        return this;
    }

    /** Run one poll cycle (exposed for testing). */
    async _tick(): Promise<void> {
        if (this.keys.length === 0) return;

        const infos = await getLedgerEntryTtl(
            this.keys,
            this.options.thresholds,
            this.options.ttlClient,
        );

        // Queue keys approaching expiry
        const queued = infos
            .filter(
                (info) =>
                    info.remainingLedgers !== null &&
                    info.remainingLedgers <= RENEWAL_QUEUE_THRESHOLD,
            )
            .map((info) => info.key);

        if (queued.length === 0) return;

        // Trigger batch renewal when any key is at or below the trigger threshold
        const shouldRenewNow = infos.some(
            (info) =>
                info.isExpired ||
                (info.remainingLedgers !== null &&
                    info.remainingLedgers <= RENEWAL_TRIGGER_LEDGERS),
        );

        if (!shouldRenewNow) return;

        // Split the queue into sub-batches capped at MAX_RENEWAL_BATCH_SIZE so a
        // single renewal transaction cannot exceed Soroban's per-transaction
        // footprint/resource limits. Each sub-batch is built and attempted
        // independently: a failure in one does not prevent the others from being
        // tried, and fires its own onAlert rather than aborting the whole tick.
        for (let offset = 0; offset < queued.length; offset += MAX_RENEWAL_BATCH_SIZE) {
            const subBatch = queued.slice(offset, offset + MAX_RENEWAL_BATCH_SIZE);
            try {
                await buildTtlExtensionTransaction(
                    subBatch,
                    this.sourcePublicKey,
                    this.options.thresholds,
                    this.options.txClient,
                );
            } catch (error: unknown) {
                const parsed = parseStellarError(error);
                this.options.onAlert({
                    type: 'renewal_failed',
                    keys: subBatch,
                    error: parsed.message,
                    timestamp: Date.now(),
                });
            }
        }
    }
}

/** Convenience factory: create and start a renewer in one call. */
export function createAutoRenewer(
    sourcePublicKey: string,
    keys: xdr.LedgerKey[],
    options: AutomaticTTLRenewerOptions = {},
): AutomaticTTLRenewer {
    const renewer = new AutomaticTTLRenewer(sourcePublicKey, options);
    keys.forEach((k) => renewer.watch(k));
    return renewer.start();
}
