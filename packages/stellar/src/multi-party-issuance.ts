/**
 * Multi-Party Asset Issuance with Authorization Gate (#783)
 *
 * Manages a state machine that requires N-of-M co-issuer signatures before
 * an asset distribution account is funded and trust-line flags are set.
 *
 * ## Supported configurations
 * - 2-of-3: two co-signers required out of three
 * - 3-of-5: three co-signers required out of five
 * - Any N-of-M where N ≤ M
 *
 * ## State machine
 * ```
 *   pending → partial_approval → approved → issued
 *                  ↓                ↓
 *               expired          expired
 * ```
 * - `pending`          – session created, no signatures yet
 * - `partial_approval` – at least one signature collected, fewer than N
 * - `approved`         – N signatures reached; combined XDR is ready to submit
 * - `issued`           – caller confirmed the transaction was submitted
 * - `expired`          – 24-hour timeout elapsed before reaching `approved`
 *
 * ## Signature protocol
 * Each co-signer receives the base (unsigned) transaction XDR, signs it
 * off-chain, and submits the signed XDR back via `addCoSignerSignature`.
 * When N signatures are collected the signed transactions are merged into a
 * single envelope that carries all required signatures.
 *
 * ## Persistence
 * Sessions are held in an in-memory Map.  In production, replace the store
 * operations with Supabase upserts for durability across restarts and
 * multi-instance deployments.
 */

import { TransactionBuilder, Transaction, Keypair } from 'stellar-sdk';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IssuanceState = 'pending' | 'partial_approval' | 'approved' | 'issued' | 'expired';

export interface MultiPartyConfig {
    /** N: number of co-signer signatures required to approve. */
    required: number;
    /** M: total number of eligible co-signers (must be ≥ required). */
    total: number;
    /**
     * Milliseconds until the session expires if not fully signed.
     * Defaults to 24 hours.
     */
    timeoutMs?: number;
}

export interface IssuanceSession {
    id: string;
    config: MultiPartyConfig;
    state: IssuanceState;
    /** Base (unsigned) issuance transaction XDR distributed to co-signers. */
    baseTxXdr: string;
    /** Public keys of co-signers who have submitted a signed transaction. */
    collectedSignerKeys: string[];
    /** Combined transaction XDR (set once state reaches `approved`). */
    combinedTxXdr?: string;
    createdAt: number;
    expiresAt: number;
}

export type AddSignatureResult =
    | { ok: true; session: IssuanceSession }
    | { ok: false; error: string };

export type MarkIssuedResult =
    | { ok: true; session: IssuanceSession }
    | { ok: false; error: string };

// ---------------------------------------------------------------------------
// In-memory session store
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

const sessionStore = new Map<string, IssuanceSession>();
let _nextId = 1;

/** Flush all sessions. Call in test teardown for isolation. */
export function clearIssuanceSessions(): void {
    sessionStore.clear();
    _nextId = 1;
}

/** Return a snapshot of an existing session, or undefined. */
export function getIssuanceSession(id: string): IssuanceSession | undefined {
    const s = sessionStore.get(id);
    return s ? { ...s, collectedSignerKeys: [...s.collectedSignerKeys] } : undefined;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new issuance session for the given N-of-M configuration.
 *
 * @param config      - Authorization requirements
 * @param baseTxXdr   - Unsigned transaction XDR to be co-signed
 */
export function createIssuanceSession(config: MultiPartyConfig, baseTxXdr: string): IssuanceSession {
    if (config.required < 1 || config.required > config.total) {
        throw new Error(
            `Invalid config: required (${config.required}) must be between 1 and total (${config.total})`,
        );
    }

    const now = Date.now();
    const session: IssuanceSession = {
        id: `issuance-${_nextId++}`,
        config,
        state: 'pending',
        baseTxXdr,
        collectedSignerKeys: [],
        createdAt: now,
        expiresAt: now + (config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    };

    sessionStore.set(session.id, session);
    return { ...session };
}

/**
 * Submit a co-signer's signed version of the base transaction.
 *
 * - Rejects if the session is expired, already approved/issued, or if the
 *   signer has already contributed.
 * - Transitions state: `pending → partial_approval → approved`.
 * - When `approved`, combines all collected signatures into `combinedTxXdr`.
 *
 * @param sessionId        - Target issuance session
 * @param signerPublicKey  - Public key of the co-signer submitting the signature
 * @param signedTxXdr      - Transaction signed by this co-signer
 * @param networkPassphrase - Stellar network passphrase for XDR parsing
 */
export function addCoSignerSignature(
    sessionId: string,
    signerPublicKey: string,
    signedTxXdr: string,
    networkPassphrase: string,
): AddSignatureResult {
    const session = sessionStore.get(sessionId);
    if (!session) {
        return { ok: false, error: `Session '${sessionId}' not found` };
    }

    // Expire sessions that exceeded the timeout
    if (Date.now() > session.expiresAt) {
        session.state = 'expired';
        return { ok: false, error: 'Session has expired' };
    }

    if (session.state === 'approved' || session.state === 'issued') {
        return { ok: false, error: `Session is already in state '${session.state}'` };
    }

    if (session.state === 'expired') {
        return { ok: false, error: 'Session has expired' };
    }

    if (session.collectedSignerKeys.includes(signerPublicKey)) {
        return { ok: false, error: `Co-signer '${signerPublicKey}' has already signed` };
    }

    // Validate the signed XDR
    let parsedTx: Transaction;
    try {
        parsedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase) as Transaction;
    } catch {
        return { ok: false, error: 'Invalid signed transaction XDR' };
    }

    // Verify the submitted transaction matches the session's base transaction.
    // Compare transaction hashes on the unsigned envelopes so that differences
    // in source/sequence/operations/timeBounds are all caught in one check.
    const baseTx = TransactionBuilder.fromXDR(session.baseTxXdr, networkPassphrase) as Transaction;
    const baseHash = baseTx.hash().toString('hex');
    const submittedHash = parsedTx.hash().toString('hex');
    if (submittedHash !== baseHash) {
        return {
            ok: false,
            error: 'Submitted transaction does not match the session base transaction',
        };
    }

    // Verify that at least one signature matches the claimed co-signer's public key
    const signerKeypair = Keypair.fromPublicKey(signerPublicKey);
    const txHash = parsedTx.hash();
    const hasValidSignature = parsedTx.signatures.some((sig) => {
        try {
            return signerKeypair.verify(txHash, sig.signature());
        } catch {
            return false;
        }
    });

    if (!hasValidSignature) {
        return { ok: false, error: 'Signature does not match claimed co-signer public key' };
    }

    // Store the signed XDR alongside the signer key (we embed it in the session
    // transiently; only combinedTxXdr survives the snapshot).
    (session as any)._signedXdrs = (session as any)._signedXdrs ?? [];
    (session as any)._signedXdrs.push(signedTxXdr);
    session.collectedSignerKeys.push(signerPublicKey);

    const count = session.collectedSignerKeys.length;

    if (count >= session.config.required) {
        // Combine all collected signatures into one transaction envelope.
        try {
            session.combinedTxXdr = combineSignedTransactions(
                (session as any)._signedXdrs as string[],
                networkPassphrase,
            );
        } catch (e) {
            return { ok: false, error: `Signature combination failed: ${e}` };
        }
        session.state = 'approved';
    } else {
        session.state = 'partial_approval';
    }

    return {
        ok: true,
        session: { ...session, collectedSignerKeys: [...session.collectedSignerKeys] },
    };
}

/**
 * Mark an approved session as issued after the combined transaction has been
 * submitted to the Stellar network.
 *
 * @param sessionId - Target issuance session (must be in `approved` state)
 */
export function markIssued(sessionId: string): MarkIssuedResult {
    const session = sessionStore.get(sessionId);
    if (!session) {
        return { ok: false, error: `Session '${sessionId}' not found` };
    }
    if (session.state !== 'approved') {
        return {
            ok: false,
            error: `Cannot mark issued: session is in state '${session.state}' (expected 'approved')`,
        };
    }

    session.state = 'issued';
    return { ok: true, session: { ...session, collectedSignerKeys: [...session.collectedSignerKeys] } };
}

/**
 * Expire sessions that have passed their timeout without reaching `approved`.
 * Call this on demand or as a scheduled cleanup job.
 *
 * @param _now - Override the current timestamp (for testing).
 * @returns Number of sessions transitioned to `expired`.
 */
export function expireTimedOutSessions(_now: number = Date.now()): number {
    let expired = 0;

    for (const session of sessionStore.values()) {
        if (
            session.state !== 'approved' &&
            session.state !== 'issued' &&
            session.state !== 'expired' &&
            _now > session.expiresAt
        ) {
            session.state = 'expired';
            expired++;
        }
    }

    return expired;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Merge the signatures from multiple signed transaction XDRs into a single
 * transaction envelope, deduplicating by signature hint.
 */
function combineSignedTransactions(signedXdrs: string[], networkPassphrase: string): string {
    if (signedXdrs.length === 0) {
        throw new Error('No signed transactions to combine');
    }

    const base = TransactionBuilder.fromXDR(signedXdrs[0], networkPassphrase) as Transaction;

    for (let i = 1; i < signedXdrs.length; i++) {
        const other = TransactionBuilder.fromXDR(signedXdrs[i], networkPassphrase) as Transaction;
        for (const sig of other.signatures) {
            const hintHex = sig.hint().toString('hex');
            const alreadyPresent = base.signatures.some(
                (s) => s.hint().toString('hex') === hintHex,
            );
            if (!alreadyPresent) {
                base.signatures.push(sig);
            }
        }
    }

    return base.toXDR();
}
