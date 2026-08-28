/**
 * Fee-Bump Transaction Orchestrator – Platform-Sponsored User Execution (#784)
 *
 * Wraps any user-submitted Stellar transaction in a platform-sponsored fee-bump
 * envelope, applying a priority fee and tracking per-user usage for monthly billing.
 *
 * ## Flow
 * 1. Validate the inner transaction XDR (must be parseable by stellar-sdk).
 * 2. Call `buildFeeBumpTransaction` to compute the priority fee and construct
 *    the fee-bump envelope.
 * 3. Record the fee-bump usage (count + total stroops paid) against the user.
 * 4. Return the fee-bump transaction XDR ready for signing by the fee account.
 *
 * ## Usage tracking
 * Usage is stored in an in-memory Map keyed by `userId`.  In production this
 * should be replaced with a Supabase upsert for durability across restarts.
 * The in-memory store is intentionally simple so tests can remain unit tests
 * without a live database.
 */

import { TransactionBuilder, Transaction } from 'stellar-sdk';
import type { SorobanRpc } from 'stellar-sdk';
import { buildFeeBumpTransaction } from './soroban';
import type { FeeBumpResult } from './soroban';

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export interface FeeBumpUsageRecord {
    userId: string;
    /** Number of fee-bump transactions orchestrated this billing period. */
    count: number;
    /** Cumulative fee paid in stroops. */
    totalFeesPaid: number;
    /** Unix timestamp (ms) of the most recent transaction. */
    lastUsedAt: number;
}

/**
 * Pluggable interface for storing and retrieving fee-bump usage records.
 * Allows production implementations to use durable storage (Supabase, etc.)
 * while keeping the orchestrator pure and testable.
 */
export interface FeeBumpUsageStore {
    /**
     * Record a fee-bump transaction for a user (update or create).
     * @param userId - User identifier
     * @param feeCharged - Fee amount in stroops for this transaction
     */
    record(userId: string, feeCharged: number): Promise<void>;
}

/** Default in-memory implementation of FeeBumpUsageStore. */
class InMemoryFeeBumpUsageStore implements FeeBumpUsageStore {
    private store = new Map<string, FeeBumpUsageRecord>();

    get(userId: string): FeeBumpUsageRecord | undefined {
        const record = this.store.get(userId);
        return record ? { ...record } : undefined;
    }

    async record(userId: string, feeCharged: number): Promise<void> {
        const existing = this.store.get(userId);
        if (existing) {
            existing.count += 1;
            existing.totalFeesPaid += feeCharged;
            existing.lastUsedAt = Date.now();
        } else {
            this.store.set(userId, {
                userId,
                count: 1,
                totalFeesPaid: feeCharged,
                lastUsedAt: Date.now(),
            });
        }
    }

    clear(): void {
        this.store.clear();
    }
}

/** Global default store instance. */
const defaultStore = new InMemoryFeeBumpUsageStore();

/** Flush all usage records in the default store. Call in test teardown for isolation. */
export function clearFeeBumpUsage(): void {
    defaultStore.clear();
}

/** Return the current usage record for a user from the default store. */
export function getFeeBumpUsage(userId: string): FeeBumpUsageRecord | undefined {
    return defaultStore.get(userId);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export type OrchestrateFeeBumpResult =
    | { ok: true; feeBumpXdr: string; feeCharged: number }
    | { ok: false; error: string };

/**
 * Orchestrates a fee-bump transaction for a user-submitted inner transaction.
 *
 * Validates the inner XDR, wraps it in a fee-bump envelope signed by the
 * platform fee account, and records the fee-bump against the user.
 *
 * @param innerTxXdr        - Signed inner transaction XDR submitted by the user
 * @param feeSourcePublicKey - Platform fee account that pays the bump fee
 * @param userId             - Identifier for the user (used for usage tracking)
 * @param client             - Soroban RPC client for fee statistics
 * @param networkPassphrase  - Stellar network passphrase for XDR validation
 * @param _buildFeeBump      - Override for `buildFeeBumpTransaction` (for testing)
 * @param store              - Optional FeeBumpUsageStore for recording usage
 *                             (defaults to in-memory store)
 */
export async function orchestrateFeeBump(
    innerTxXdr: string,
    feeSourcePublicKey: string,
    userId: string,
    client: SorobanRpc.Server,
    networkPassphrase: string,
    _buildFeeBump: typeof buildFeeBumpTransaction = buildFeeBumpTransaction,
    store: FeeBumpUsageStore = defaultStore,
): Promise<OrchestrateFeeBumpResult> {
    // Validate the inner transaction XDR before attempting to wrap it.
    let innerTx: any;
    try {
        innerTx = TransactionBuilder.fromXDR(innerTxXdr, networkPassphrase);
    } catch {
        return { ok: false, error: 'Invalid inner transaction XDR: unable to parse' };
    }

    // Reject if the inner transaction is already a fee-bump (cannot nest fee-bumps).
    if (!(innerTx instanceof Transaction)) {
        return { ok: false, error: 'Cannot fee-bump an already fee-bumped transaction' };
    }

    // Construct the fee-bump envelope.
    const result: FeeBumpResult = await _buildFeeBump(innerTxXdr, feeSourcePublicKey, client);
    if (!result.ok) {
        return result;
    }

    // Record usage through the provided store.
    await store.record(userId, result.feeCharged);

    return { ok: true, feeBumpXdr: result.feeBumpXdr, feeCharged: result.feeCharged };
}
