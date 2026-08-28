/**
 * Account Merge Protection Tests (#785)
 *
 * Covers: blocked merge (open trustlines), allowed merge, balance transfer
 * verification, active-offer blocking, wrong-destination blocking, and audit logging.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    Networks,
    Keypair,
    TransactionBuilder,
    BASE_FEE,
    Operation,
    Asset,
} from 'stellar-sdk';
import {
    inspectMergeTransaction,
    checkMergeAllowed,
    protectAgainstMerge,
    registerManagedAccount,
    isManagedAccount,
    onMergeDetected,
    getMergeAuditLog,
    clearMergeAuditLog,
    clearManagedAccounts,
    type AccountState,
    type MergeOperation,
} from './account-merge-protection';

const NETWORK = Networks.TESTNET;
const SOURCE_KP = Keypair.random();
const DEST_KP = Keypair.random();

function buildMergeTxXdr(sourceKp: Keypair, destination: string): string {
    const account = {
        accountId: () => sourceKp.publicKey(),
        sequenceNumber: () => '200',
        incrementSequenceNumber: () => {},
    } as any;

    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
        .addOperation(Operation.accountMerge({ destination }))
        .setTimeout(30)
        .build();

    tx.sign(sourceKp);
    return tx.toXDR();
}

function buildPaymentTxXdr(): string {
    const account = {
        accountId: () => SOURCE_KP.publicKey(),
        sequenceNumber: () => '200',
        incrementSequenceNumber: () => {},
    } as any;

    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
        .addOperation(
            Operation.payment({
                destination: DEST_KP.publicKey(),
                asset: Asset.native(),
                amount: '1',
            }),
        )
        .setTimeout(30)
        .build();

    tx.sign(SOURCE_KP);
    return tx.toXDR();
}

function makeAccountState(overrides: Partial<AccountState> = {}): AccountState {
    return {
        trustlines: [],
        offers: [],
        xlmBalanceStroops: '10000000',
        ...overrides,
    };
}

beforeEach(() => {
    clearMergeAuditLog();
    clearManagedAccounts();
});

// ---------------------------------------------------------------------------
// inspectMergeTransaction
// ---------------------------------------------------------------------------

describe('inspectMergeTransaction', () => {
    it('detects an AccountMerge operation', () => {
        const txXdr = buildMergeTxXdr(SOURCE_KP, DEST_KP.publicKey());
        const merges = inspectMergeTransaction(txXdr, NETWORK);

        expect(merges).toHaveLength(1);
        expect(merges[0].sourceAccount).toBe(SOURCE_KP.publicKey());
        expect(merges[0].destination).toBe(DEST_KP.publicKey());
    });

    it('returns empty array when no merge operation is present', () => {
        const txXdr = buildPaymentTxXdr();
        const merges = inspectMergeTransaction(txXdr, NETWORK);

        expect(merges).toHaveLength(0);
    });

    it('returns empty array for invalid XDR', () => {
        const merges = inspectMergeTransaction('not-valid-xdr', NETWORK);
        expect(merges).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// checkMergeAllowed
// ---------------------------------------------------------------------------

describe('checkMergeAllowed – blocked merge (open trustlines)', () => {
    it('blocks merge when account has open trustlines', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        const state = makeAccountState({
            trustlines: [
                { assetCode: 'USDC', assetIssuer: 'GABC...', balance: '100', limit: '1000' },
            ],
        });

        const decision = checkMergeAllowed(merge, state);

        expect(decision.allowed).toBe(false);
        if (decision.allowed) return;
        expect(decision.reason).toMatch(/trustline/);
    });

    it('blocks merge when account has active DEX offers', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        const state = makeAccountState({ offers: [{ id: 'offer-1' }] });

        const decision = checkMergeAllowed(merge, state);

        expect(decision.allowed).toBe(false);
        if (decision.allowed) return;
        expect(decision.reason).toMatch(/offer/);
    });

    it('blocks merge when destination does not match expected', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        const state = makeAccountState();
        const wrongExpected = Keypair.random().publicKey();

        const decision = checkMergeAllowed(merge, state, wrongExpected);

        expect(decision.allowed).toBe(false);
        if (decision.allowed) return;
        expect(decision.reason).toMatch(/destination/);
    });
});

describe('checkMergeAllowed – allowed merge', () => {
    it('allows merge when no trustlines, no offers, and destination matches', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        const state = makeAccountState({ xlmBalanceStroops: '50000000' });

        const decision = checkMergeAllowed(merge, state, DEST_KP.publicKey());

        expect(decision.allowed).toBe(true);
    });

    it('allows merge when no expectedDestination is enforced', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        const state = makeAccountState();

        const decision = checkMergeAllowed(merge, state);

        expect(decision.allowed).toBe(true);
    });
});

describe('checkMergeAllowed – residual balance verification', () => {
    it('returns the residual XLM balance when allowed', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        const state = makeAccountState({ xlmBalanceStroops: '75000000' });

        const decision = checkMergeAllowed(merge, state);

        expect(decision.allowed).toBe(true);
        if (!decision.allowed) return;
        expect(decision.residualXlmStroops).toBe('75000000');
    });
});

// ---------------------------------------------------------------------------
// protectAgainstMerge (integration)
// ---------------------------------------------------------------------------

describe('protectAgainstMerge', () => {
    it('returns a decision map with one entry for a merge transaction', async () => {
        const txXdr = buildMergeTxXdr(SOURCE_KP, DEST_KP.publicKey());
        const getState = vi.fn().mockResolvedValue(makeAccountState());

        const decisions = await protectAgainstMerge(txXdr, NETWORK, getState);

        expect(decisions.size).toBe(1);
        expect(decisions.get(SOURCE_KP.publicKey())?.allowed).toBe(true);
    });

    it('returns an empty map for a transaction without merge ops', async () => {
        const txXdr = buildPaymentTxXdr();
        const getState = vi.fn();

        const decisions = await protectAgainstMerge(txXdr, NETWORK, getState);

        expect(decisions.size).toBe(0);
        expect(getState).not.toHaveBeenCalled();
    });

    it('emits an audit log entry when a merge is detected', async () => {
        const txXdr = buildMergeTxXdr(SOURCE_KP, DEST_KP.publicKey());
        const getState = vi.fn().mockResolvedValue(makeAccountState());

        await protectAgainstMerge(txXdr, NETWORK, getState);

        const log = getMergeAuditLog();
        expect(log).toHaveLength(1);
        expect(log[0].sourceAccount).toBe(SOURCE_KP.publicKey());
        expect(log[0].destination).toBe(DEST_KP.publicKey());
    });

    it('fires onMergeDetected handlers when a merge is detected', async () => {
        const handler = vi.fn();
        const off = onMergeDetected(handler);

        const txXdr = buildMergeTxXdr(SOURCE_KP, DEST_KP.publicKey());
        const getState = vi.fn().mockResolvedValue(makeAccountState());

        await protectAgainstMerge(txXdr, NETWORK, getState);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].sourceAccount).toBe(SOURCE_KP.publicKey());
        off();
    });

    it('records blocked merges in the audit log', async () => {
        registerManagedAccount(SOURCE_KP.publicKey());
        const txXdr = buildMergeTxXdr(SOURCE_KP, DEST_KP.publicKey());
        const getState = vi.fn().mockResolvedValue(
            makeAccountState({
                trustlines: [{ assetCode: 'USDC', assetIssuer: 'GABC', balance: '50', limit: '1000' }],
            }),
        );

        const decisions = await protectAgainstMerge(txXdr, NETWORK, getState);

        expect(decisions.get(SOURCE_KP.publicKey())?.allowed).toBe(false);
        const log = getMergeAuditLog();
        expect(log[0].decision.allowed).toBe(false);
    });

    it('allows unmanaged account merges without calling getAccountState (#1127)', async () => {
        const unregisteredKp = Keypair.random();
        const txXdr = buildMergeTxXdr(unregisteredKp, DEST_KP.publicKey());
        const getState = vi.fn();

        const decisions = await protectAgainstMerge(txXdr, NETWORK, getState);

        // Unmanaged accounts should bypass state checking entirely
        expect(decisions.get(unregisteredKp.publicKey())?.allowed).toBe(true);
        expect(getState).not.toHaveBeenCalled();
    });

    it('records audit entry for unmanaged account merge (#1127)', async () => {
        const unregisteredKp = Keypair.random();
        const txXdr = buildMergeTxXdr(unregisteredKp, DEST_KP.publicKey());
        const getState = vi.fn().mockResolvedValue(makeAccountState());

        await protectAgainstMerge(txXdr, NETWORK, getState);

        const log = getMergeAuditLog();
        expect(log).toHaveLength(1);
        expect(log[0].sourceAccount).toBe(unregisteredKp.publicKey());
        expect(log[0].decision.allowed).toBe(true);
    });

    it('allows unmanaged account merges even with open trustlines (#956)', async () => {
        const unregisteredKp = Keypair.random();
        const txXdr = buildMergeTxXdr(unregisteredKp, DEST_KP.publicKey());
        const getState = vi.fn().mockResolvedValue(
            makeAccountState({
                trustlines: [{ assetCode: 'USDC', assetIssuer: 'GABC', balance: '50', limit: '1000' }],
            }),
        );

        const decisions = await protectAgainstMerge(txXdr, NETWORK, getState);

        expect(decisions.get(unregisteredKp.publicKey())?.allowed).toBe(true);
        expect(getState).not.toHaveBeenCalled();
        const log = getMergeAuditLog();
        expect(log[0].decision.allowed).toBe(true);
    });

    it('blocks managed account merges with open trustlines (#956)', async () => {
        registerManagedAccount(SOURCE_KP.publicKey());
        const txXdr = buildMergeTxXdr(SOURCE_KP, DEST_KP.publicKey());
        const getState = vi.fn().mockResolvedValue(
            makeAccountState({
                trustlines: [{ assetCode: 'USDC', assetIssuer: 'GABC', balance: '50', limit: '1000' }],
            }),
        );

        const decisions = await protectAgainstMerge(txXdr, NETWORK, getState);

        expect(decisions.get(SOURCE_KP.publicKey())?.allowed).toBe(false);
        expect(getState).toHaveBeenCalledOnce();
        const log = getMergeAuditLog();
        expect(log[0].decision.allowed).toBe(false);
    });

    it('emits audit entries for both managed and unmanaged account merges (#956)', async () => {
        const managedKp = SOURCE_KP;
        const unmanagedKp = Keypair.random();

        registerManagedAccount(managedKp.publicKey());

        const managedTxXdr = buildMergeTxXdr(managedKp, DEST_KP.publicKey());
        const unmanagedTxXdr = buildMergeTxXdr(unmanagedKp, DEST_KP.publicKey());

        const getState = vi.fn().mockResolvedValue(makeAccountState());

        await protectAgainstMerge(managedTxXdr, NETWORK, getState);
        await protectAgainstMerge(unmanagedTxXdr, NETWORK, getState);

        const log = getMergeAuditLog();
        expect(log).toHaveLength(2);
        expect(log[0].sourceAccount).toBe(managedKp.publicKey());
        expect(log[1].sourceAccount).toBe(unmanagedKp.publicKey());
    });
});

// ---------------------------------------------------------------------------
// Managed-account registry
// ---------------------------------------------------------------------------

describe('managed-account registry', () => {
    it('registers and checks managed accounts', () => {
        expect(isManagedAccount(SOURCE_KP.publicKey())).toBe(false);
        registerManagedAccount(SOURCE_KP.publicKey());
        expect(isManagedAccount(SOURCE_KP.publicKey())).toBe(true);
    });
});

// ── Regression: #1100 – balance check in open-trustline filter ───────────────

describe('regression #1100 – zero-balance trustline must not block merge', () => {
    it('allows merge when trustline has nonzero limit but zero balance', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        // limit > 0, balance === '0' — not an "open" trustline per the docs
        const state = makeAccountState({
            trustlines: [
                { assetCode: 'USDC', assetIssuer: 'GABC...', balance: '0', limit: '1000' },
            ],
        });

        const decision = checkMergeAllowed(merge, state);

        expect(decision.allowed).toBe(true);
    });

    it('allows merge when trustline has nonzero limit and zero decimal-string balance', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        const state = makeAccountState({
            trustlines: [
                { assetCode: 'BTC', assetIssuer: 'GBBB...', balance: '0.0000000', limit: '500' },
            ],
        });

        const decision = checkMergeAllowed(merge, state);

        expect(decision.allowed).toBe(true);
    });

    it('still blocks merge when trustline has both nonzero limit and nonzero balance', () => {
        const merge: MergeOperation = {
            sourceAccount: SOURCE_KP.publicKey(),
            destination: DEST_KP.publicKey(),
        };
        const state = makeAccountState({
            trustlines: [
                { assetCode: 'USDC', assetIssuer: 'GABC...', balance: '1', limit: '1000' },
            ],
        });

        const decision = checkMergeAllowed(merge, state);

        expect(decision.allowed).toBe(false);
        if (decision.allowed) return;
        expect(decision.reason).toMatch(/trustline/);
    });
});
