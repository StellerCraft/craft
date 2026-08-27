/**
 * Multi-Party Asset Issuance Tests (#783)
 *
 * Covers: 2-of-3 approval, timeout expiry, and combined transaction submission.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    Networks,
    Keypair,
    TransactionBuilder,
    BASE_FEE,
    Operation,
    Asset,
} from 'stellar-sdk';
import {
    createIssuanceSession,
    addCoSignerSignature,
    markIssued,
    expireTimedOutSessions,
    getIssuanceSession,
    clearIssuanceSessions,
    type MultiPartyConfig,
} from './multi-party-issuance';

const NETWORK = Networks.TESTNET;

const SOURCE_KP = Keypair.random();
const SIGNER_A = Keypair.random();
const SIGNER_B = Keypair.random();
const SIGNER_C = Keypair.random();

function buildBaseTxXdr(): string {
    const account = {
        accountId: () => SOURCE_KP.publicKey(),
        sequenceNumber: () => '1000',
        incrementSequenceNumber: () => {},
    } as any;

    return new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
        .addOperation(
            Operation.payment({
                destination: Keypair.random().publicKey(),
                asset: Asset.native(),
                amount: '10',
            }),
        )
        .setTimeout(60)
        .build()
        .toXDR();
}

function signTxXdr(txXdr: string, keypair: Keypair): string {
    const tx = TransactionBuilder.fromXDR(txXdr, NETWORK) as any;
    tx.sign(keypair);
    return tx.toXDR();
}

beforeEach(() => {
    clearIssuanceSessions();
});

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

describe('createIssuanceSession', () => {
    it('creates a session in pending state', () => {
        const config: MultiPartyConfig = { required: 2, total: 3 };
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession(config, baseTxXdr);

        expect(session.state).toBe('pending');
        expect(session.collectedSignerKeys).toHaveLength(0);
        expect(session.id).toBeTruthy();
        expect(session.expiresAt).toBeGreaterThan(session.createdAt);
    });

    it('throws for invalid N-of-M configuration', () => {
        expect(() => createIssuanceSession({ required: 4, total: 3 }, 'xdr')).toThrow();
        expect(() => createIssuanceSession({ required: 0, total: 3 }, 'xdr')).toThrow();
    });

    it('respects a custom timeout', () => {
        const config: MultiPartyConfig = { required: 1, total: 1, timeoutMs: 5_000 };
        const session = createIssuanceSession(config, buildBaseTxXdr());

        expect(session.expiresAt - session.createdAt).toBe(5_000);
    });
});

// ---------------------------------------------------------------------------
// 2-of-3 approval flow
// ---------------------------------------------------------------------------

describe('2-of-3 authorization flow', () => {
    it('transitions pending → partial_approval after first signature', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        const result = addCoSignerSignature(
            session.id,
            SIGNER_A.publicKey(),
            signTxXdr(baseTxXdr, SIGNER_A),
            NETWORK,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.session.state).toBe('partial_approval');
        expect(result.session.collectedSignerKeys).toHaveLength(1);
    });

    it('transitions partial_approval → approved after second signature', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        addCoSignerSignature(session.id, SIGNER_A.publicKey(), signTxXdr(baseTxXdr, SIGNER_A), NETWORK);
        const result = addCoSignerSignature(session.id, SIGNER_B.publicKey(), signTxXdr(baseTxXdr, SIGNER_B), NETWORK);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.session.state).toBe('approved');
        expect(result.session.combinedTxXdr).toBeTruthy();
        expect(result.session.collectedSignerKeys).toHaveLength(2);
    });

    it('the combined XDR is parseable', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        addCoSignerSignature(session.id, SIGNER_A.publicKey(), signTxXdr(baseTxXdr, SIGNER_A), NETWORK);
        const result = addCoSignerSignature(session.id, SIGNER_B.publicKey(), signTxXdr(baseTxXdr, SIGNER_B), NETWORK);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(() =>
            TransactionBuilder.fromXDR(result.session.combinedTxXdr!, NETWORK),
        ).not.toThrow();
    });

    it('does not advance state beyond approved when a third signature arrives', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        addCoSignerSignature(session.id, SIGNER_A.publicKey(), signTxXdr(baseTxXdr, SIGNER_A), NETWORK);
        addCoSignerSignature(session.id, SIGNER_B.publicKey(), signTxXdr(baseTxXdr, SIGNER_B), NETWORK);

        const result = addCoSignerSignature(session.id, SIGNER_C.publicKey(), signTxXdr(baseTxXdr, SIGNER_C), NETWORK);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/already in state/);
    });

    it('rejects a duplicate signature from the same signer', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        addCoSignerSignature(session.id, SIGNER_A.publicKey(), signTxXdr(baseTxXdr, SIGNER_A), NETWORK);
        const result = addCoSignerSignature(session.id, SIGNER_A.publicKey(), signTxXdr(baseTxXdr, SIGNER_A), NETWORK);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/already signed/);
    });
});

// ---------------------------------------------------------------------------
// 3-of-5 approval flow
// ---------------------------------------------------------------------------

describe('3-of-5 authorization flow', () => {
    const EXTRA_A = Keypair.random();
    const EXTRA_B = Keypair.random();

    it('reaches approved after exactly 3 signatures', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 3, total: 5 }, baseTxXdr);

        addCoSignerSignature(session.id, SIGNER_A.publicKey(), signTxXdr(baseTxXdr, SIGNER_A), NETWORK);
        expect(getIssuanceSession(session.id)!.state).toBe('partial_approval');

        addCoSignerSignature(session.id, SIGNER_B.publicKey(), signTxXdr(baseTxXdr, SIGNER_B), NETWORK);
        expect(getIssuanceSession(session.id)!.state).toBe('partial_approval');

        addCoSignerSignature(session.id, EXTRA_A.publicKey(), signTxXdr(baseTxXdr, EXTRA_A), NETWORK);
        expect(getIssuanceSession(session.id)!.state).toBe('approved');
    });
});

// ---------------------------------------------------------------------------
// Timeout expiry
// ---------------------------------------------------------------------------

describe('session timeout expiry', () => {
    it('expireTimedOutSessions marks overdue sessions as expired', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession(
            { required: 2, total: 3, timeoutMs: 60_000 },
            baseTxXdr,
        );

        // Pass a far-future timestamp so the session looks past its timeout.
        const count = expireTimedOutSessions(Date.now() + 1_000_000_000);

        expect(count).toBe(1);
        expect(getIssuanceSession(session.id)!.state).toBe('expired');
    });

    it('addCoSignerSignature detects an expired session', () => {
        const baseTxXdr = buildBaseTxXdr();
        // Create with a negative timeout so expiresAt is already in the past.
        const session = createIssuanceSession(
            { required: 2, total: 3, timeoutMs: -1 },
            baseTxXdr,
        );

        const result = addCoSignerSignature(
            session.id,
            SIGNER_A.publicKey(),
            signTxXdr(baseTxXdr, SIGNER_A),
            NETWORK,
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/expired/);
    });

    it('does not expire approved or issued sessions', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession(
            { required: 1, total: 1, timeoutMs: 60_000 },
            baseTxXdr,
        );

        addCoSignerSignature(session.id, SIGNER_A.publicKey(), signTxXdr(baseTxXdr, SIGNER_A), NETWORK);
        markIssued(session.id);

        // Simulate far-future "now" so every session looks past its timeout.
        // Issued sessions must not be expired regardless.
        const count = expireTimedOutSessions(Date.now() + 1_000_000_000);
        expect(count).toBe(0);
        expect(getIssuanceSession(session.id)!.state).toBe('issued');
    });
});

// ---------------------------------------------------------------------------
// markIssued
// ---------------------------------------------------------------------------

describe('markIssued', () => {
    it('transitions approved → issued', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 1, total: 1 }, baseTxXdr);

        addCoSignerSignature(session.id, SIGNER_A.publicKey(), signTxXdr(baseTxXdr, SIGNER_A), NETWORK);
        const result = markIssued(session.id);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.session.state).toBe('issued');
    });

    it('fails when session is not in approved state', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        const result = markIssued(session.id);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/approved/);
    });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('error handling', () => {
    it('returns error for unknown session id', () => {
        const result = addCoSignerSignature('nonexistent', SIGNER_A.publicKey(), 'xdr', NETWORK);
        expect(result.ok).toBe(false);
    });

    it('rejects invalid signed XDR', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        const result = addCoSignerSignature(session.id, SIGNER_A.publicKey(), 'invalid-xdr', NETWORK);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/Invalid signed transaction XDR/);
    });

    it('rejects a transaction signed by a different keypair than the claimed signer', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        // Sign with SIGNER_B but claim it's from SIGNER_A
        const signedByB = signTxXdr(baseTxXdr, SIGNER_B);
        const result = addCoSignerSignature(session.id, SIGNER_A.publicKey(), signedByB, NETWORK);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/Signature does not match claimed co-signer/);
    });

    it('rejects an unsigned transaction', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        // Submit the base (unsigned) transaction
        const result = addCoSignerSignature(session.id, SIGNER_A.publicKey(), baseTxXdr, NETWORK);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/Signature does not match claimed co-signer/);
    });
});

// ── Regression: #1101 – co-signer must sign the session's base transaction ───

describe('regression #1101 – reject co-signer signatures against a different transaction', () => {
    it('rejects a validly-signed but different transaction from a legitimate co-signer', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        // Build a *different* transaction (different sequence number / operations)
        const differentTxXdr = buildBaseTxXdr(); // fresh call gives new seq "1000" but same builder—
        // To guarantee it differs, sign a different payload:
        const differentAccount = {
            accountId: () => SOURCE_KP.publicKey(),
            sequenceNumber: () => '9999',
            incrementSequenceNumber: () => {},
        } as any;
        const { TransactionBuilder: TB, BASE_FEE: BF, Operation: Op, Asset: As, Networks: Ns } =
            require('stellar-sdk');
        const altTxXdr = new TB(differentAccount, { fee: BF, networkPassphrase: Ns.TESTNET })
            .addOperation(Op.payment({
                destination: SIGNER_C.publicKey(),
                asset: As.native(),
                amount: '99',
            }))
            .setTimeout(60)
            .build()
            .toXDR();

        const signedAltTx = signTxXdr(altTxXdr, SIGNER_A);

        const result = addCoSignerSignature(
            session.id,
            SIGNER_A.publicKey(),
            signedAltTx,
            NETWORK,
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/does not match the session base transaction/);
    });

    it('the mismatch error is distinct from an invalid-signature error', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        const differentAccount = {
            accountId: () => SOURCE_KP.publicKey(),
            sequenceNumber: () => '8888',
            incrementSequenceNumber: () => {},
        } as any;
        const { TransactionBuilder: TB, BASE_FEE: BF, Operation: Op, Asset: As, Networks: Ns } =
            require('stellar-sdk');
        const altTxXdr = new TB(differentAccount, { fee: BF, networkPassphrase: Ns.TESTNET })
            .addOperation(Op.payment({
                destination: SIGNER_B.publicKey(),
                asset: As.native(),
                amount: '1',
            }))
            .setTimeout(60)
            .build()
            .toXDR();

        const signedAltTx = signTxXdr(altTxXdr, SIGNER_A);

        const mismatchResult = addCoSignerSignature(
            session.id,
            SIGNER_A.publicKey(),
            signedAltTx,
            NETWORK,
        );

        expect(mismatchResult.ok).toBe(false);
        if (mismatchResult.ok) return;
        // Must say "transaction" not "signature"
        expect(mismatchResult.error).not.toMatch(/Signature does not match/);
        expect(mismatchResult.error).toMatch(/transaction/i);
    });

    it('still accepts a correctly-signed base transaction after the fix', () => {
        const baseTxXdr = buildBaseTxXdr();
        const session = createIssuanceSession({ required: 2, total: 3 }, baseTxXdr);

        const result = addCoSignerSignature(
            session.id,
            SIGNER_A.publicKey(),
            signTxXdr(baseTxXdr, SIGNER_A),
            NETWORK,
        );

        expect(result.ok).toBe(true);
    });
});
