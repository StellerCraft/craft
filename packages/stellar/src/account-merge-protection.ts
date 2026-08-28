/**
 * Stellar Account Merge Protection Service (#785)
 *
 * Detects `ACCOUNT_MERGE` operations targeting platform-managed accounts,
 * blocks merges when the account has open trustlines or active offers, and
 * verifies the residual XLM balance is transferred to the correct destination.
 *
 * ## Why this matters
 * `ACCOUNT_MERGE` permanently removes an account and transfers its XLM balance
 * to a destination.  If a deployment account is merged accidentally it becomes
 * unrecoverable – all contract associations and remaining balances are lost.
 *
 * ## Flow
 * 1. Call `inspectMergeTransaction(txXdr, networkPassphrase)` to scan a
 *    submitted transaction for any `AccountMerge` operations.
 * 2. For each detected merge, call `checkMergeAllowed` with the account's
 *    current trustline/offer state (injected via `AccountStateProvider`).
 * 3. If allowed, emit an audit log entry via the registered audit handler.
 *
 * ## Extending for production
 * - Replace the in-memory audit log with a Supabase insert.
 * - Wire `checkMergeAllowed` into your transaction pre-flight middleware.
 */

import { TransactionBuilder } from 'stellar-sdk';
import type { Transaction } from 'stellar-sdk';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MergeOperation {
    /** Public key of the account being merged (source account). */
    sourceAccount: string;
    /** Destination account that will receive the XLM balance. */
    destination: string;
}

export interface AccountState {
    /** Non-native asset balances; an open trustline is one with limit > 0. */
    trustlines: Array<{ assetCode: string; assetIssuer: string; balance: string; limit: string }>;
    /** Active offers on the DEX (buy or sell). */
    offers: Array<{ id: string }>;
    /** Current XLM balance in stroops. */
    xlmBalanceStroops: string;
}

export type MergeDecision =
    | { allowed: true; residualXlmStroops: string }
    | { allowed: false; reason: string };

export interface MergeAuditEntry {
    timestamp: number;
    sourceAccount: string;
    destination: string;
    decision: MergeDecision;
    txXdr: string;
}

/** Called for every detected merge, whether allowed or blocked. */
export type MergeAuditHandler = (entry: MergeAuditEntry) => void;

// ---------------------------------------------------------------------------
// Managed-account registry
// ---------------------------------------------------------------------------

const managedAccounts = new Set<string>();

/** Register an account as platform-managed (subject to merge protection). */
export function registerManagedAccount(publicKey: string): void {
    managedAccounts.add(publicKey);
}

/** Deregister a managed account. */
export function deregisterManagedAccount(publicKey: string): void {
    managedAccounts.delete(publicKey);
}

/** Return whether the given public key is a platform-managed account. */
export function isManagedAccount(publicKey: string): boolean {
    return managedAccounts.has(publicKey);
}

/** Flush the managed-account registry. Call in test teardown. */
export function clearManagedAccounts(): void {
    managedAccounts.clear();
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const auditLog: MergeAuditEntry[] = [];
const auditHandlers: MergeAuditHandler[] = [];

/** Return a read-only snapshot of all recorded audit entries. */
export function getMergeAuditLog(): readonly MergeAuditEntry[] {
    return auditLog;
}

/** Register a handler invoked whenever a merge is detected. Returns an unsubscribe fn. */
export function onMergeDetected(handler: MergeAuditHandler): () => void {
    auditHandlers.push(handler);
    return () => {
        const idx = auditHandlers.indexOf(handler);
        if (idx !== -1) auditHandlers.splice(idx, 1);
    };
}

/** Flush the audit log. Call in test teardown. */
export function clearMergeAuditLog(): void {
    auditLog.length = 0;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Scan a transaction XDR for `AccountMerge` operations.
 *
 * @returns An array of detected merge operations (may be empty).
 */
export function inspectMergeTransaction(
    txXdr: string,
    networkPassphrase: string,
): MergeOperation[] {
    let tx: Transaction;
    try {
        tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase) as Transaction;
    } catch {
        return [];
    }

    const merges: MergeOperation[] = [];
    const sourceAccount = tx.source;

    for (const op of tx.operations) {
        if (op.type === 'accountMerge') {
            // The source of a merge op defaults to the transaction source account
            // unless overridden at the operation level.
            const opSource = (op as any).source ?? sourceAccount;
            merges.push({
                sourceAccount: opSource,
                destination: (op as any).destination as string,
            });
        }
    }

    return merges;
}

/**
 * Determine whether a detected merge operation should be allowed.
 *
 * Rules:
 * 1. Accounts with open trustlines (limit > 0 and balance > 0) are blocked –
 *    they cannot be merged until trustlines are cleared.
 * 2. Accounts with active offers are blocked.
 * 3. The expected destination must match the actual operation destination.
 *
 * @param merge               - The detected merge operation
 * @param accountState        - Current on-chain state of the source account
 * @param expectedDestination - Optional override for the required destination
 */
export function checkMergeAllowed(
    merge: MergeOperation,
    accountState: AccountState,
    expectedDestination?: string,
): MergeDecision {
    // Check open trustlines (limit > 0 AND balance > 0, per module documentation)
    const openTrustlines = accountState.trustlines.filter(
        (t) => Number(t.limit) > 0 && Number(t.balance) > 0,
    );
    if (openTrustlines.length > 0) {
        return {
            allowed: false,
            reason: `Account has ${openTrustlines.length} open trustline(s): ${openTrustlines
                .map((t) => `${t.assetCode}:${t.assetIssuer}`)
                .join(', ')}`,
        };
    }

    // Check active offers
    if (accountState.offers.length > 0) {
        return {
            allowed: false,
            reason: `Account has ${accountState.offers.length} active offer(s) on the DEX`,
        };
    }

    // Verify destination matches expected
    if (expectedDestination && merge.destination !== expectedDestination) {
        return {
            allowed: false,
            reason: `Merge destination '${merge.destination}' does not match expected '${expectedDestination}'`,
        };
    }

    return {
        allowed: true,
        residualXlmStroops: accountState.xlmBalanceStroops,
    };
}

/**
 * Full protection check: inspect the transaction, evaluate each merge
 * against the provided account states, emit audit entries, and return
 * a per-merge decision map.
 *
 * @param txXdr             - Transaction XDR to inspect
 * @param networkPassphrase - Stellar network passphrase
 * @param getAccountState   - Provider called for each detected merge's source account
 * @param expectedDestination - Optional required destination for all merges
 */
export async function protectAgainstMerge(
    txXdr: string,
    networkPassphrase: string,
    getAccountState: (publicKey: string) => Promise<AccountState>,
    expectedDestination?: string,
): Promise<Map<string, MergeDecision>> {
    const merges = inspectMergeTransaction(txXdr, networkPassphrase);
    const decisions = new Map<string, MergeDecision>();

    for (const merge of merges) {
        let decision: MergeDecision;

        // Only apply merge protection rules to registered managed accounts
        if (!isManagedAccount(merge.sourceAccount)) {
            decision = {
                allowed: true,
                residualXlmStroops: '0',
            };
        } else {
            const state = await getAccountState(merge.sourceAccount);
            decision = checkMergeAllowed(merge, state, expectedDestination);
        }

        const entry: MergeAuditEntry = {
            timestamp: Date.now(),
            sourceAccount: merge.sourceAccount,
            destination: merge.destination,
            decision,
            txXdr,
        };

        auditLog.push(entry);
        for (const handler of auditHandlers) {
            handler(entry);
        }

        decisions.set(merge.sourceAccount, decision);
    }

    return decisions;
}
