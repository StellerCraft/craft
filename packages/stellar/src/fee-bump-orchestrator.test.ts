/**
 * Fee-Bump Orchestrator Tests (#784)
 *
 * Covers: valid wrapping, invalid inner transaction rejection, and fee tracking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Networks, Keypair, TransactionBuilder, BASE_FEE, Operation, Asset } from 'stellar-sdk';
import {
    orchestrateFeeBump,
    clearFeeBumpUsage,
    getFeeBumpUsage,
    type FeeBumpUsageStore,
    type FeeBumpUsageRecord,
} from './fee-bump-orchestrator';

const NETWORK_PASSPHRASE = Networks.TESTNET;
const SOURCE_KEYPAIR = Keypair.random();
const FEE_SOURCE_PUBKEY = Keypair.random().publicKey();
const USER_ID = 'user-abc-123';

function buildSignedInnerTxXdr(): string {
    const account = {
        accountId: () => SOURCE_KEYPAIR.publicKey(),
        sequenceNumber: () => '100',
        incrementSequenceNumber: () => {},
    } as any;

    const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(
            Operation.payment({
                destination: Keypair.random().publicKey(),
                asset: Asset.native(),
                amount: '1',
            }),
        )
        .setTimeout(30)
        .build();

    tx.sign(SOURCE_KEYPAIR);
    return tx.toXDR();
}

function makeMockBuildFeeBump(feeCharged: number) {
    return vi.fn().mockResolvedValue({
        ok: true,
        feeBumpXdr: 'mock-fee-bump-xdr',
        feeCharged,
    });
}

function buildAlreadyFeeBumpedTxXdr(): string {
    const account = {
        accountId: () => SOURCE_KEYPAIR.publicKey(),
        sequenceNumber: () => '100',
        incrementSequenceNumber: () => {},
    } as any;

    const innerTx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
    })
        .addOperation(
            Operation.payment({
                destination: Keypair.random().publicKey(),
                asset: Asset.native(),
                amount: '1',
            }),
        )
        .setTimeout(30)
        .build();

    innerTx.sign(SOURCE_KEYPAIR);

    // Wrap in a fee-bump envelope
    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        FEE_SOURCE_PUBKEY,
        '1000',
        innerTx,
        NETWORK_PASSPHRASE,
    );

    return feeBumpTx.toXDR();
}

beforeEach(() => {
    clearFeeBumpUsage();
});

describe('orchestrateFeeBump – valid wrapping', () => {
    it('returns ok:true with feeBumpXdr and feeCharged when inner tx is valid', async () => {
        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = makeMockBuildFeeBump(300);

        const result = await orchestrateFeeBump(
            innerXdr,
            FEE_SOURCE_PUBKEY,
            USER_ID,
            {} as any,
            NETWORK_PASSPHRASE,
            mockBuild,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.feeBumpXdr).toBe('mock-fee-bump-xdr');
        expect(result.feeCharged).toBe(300);
    });

    it('calls buildFeeBumpTransaction with the inner XDR and fee source', async () => {
        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = makeMockBuildFeeBump(150);

        await orchestrateFeeBump(
            innerXdr,
            FEE_SOURCE_PUBKEY,
            USER_ID,
            {} as any,
            NETWORK_PASSPHRASE,
            mockBuild,
        );

        expect(mockBuild).toHaveBeenCalledWith(innerXdr, FEE_SOURCE_PUBKEY, {});
    });
});

describe('orchestrateFeeBump – invalid inner transaction rejection', () => {
    it('returns ok:false for unparseable XDR without calling buildFeeBumpTransaction', async () => {
        const mockBuild = makeMockBuildFeeBump(300);

        const result = await orchestrateFeeBump(
            'not-valid-xdr',
            FEE_SOURCE_PUBKEY,
            USER_ID,
            {} as any,
            NETWORK_PASSPHRASE,
            mockBuild,
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/Invalid inner transaction XDR/);
        expect(mockBuild).not.toHaveBeenCalled();
    });

    it('returns ok:false for an already fee-bumped transaction without calling buildFeeBumpTransaction', async () => {
        const feeBumpXdr = buildAlreadyFeeBumpedTxXdr();
        const mockBuild = makeMockBuildFeeBump(300);

        const result = await orchestrateFeeBump(
            feeBumpXdr,
            FEE_SOURCE_PUBKEY,
            USER_ID,
            {} as any,
            NETWORK_PASSPHRASE,
            mockBuild,
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/Cannot fee-bump an already fee-bumped transaction/);
        expect(mockBuild).not.toHaveBeenCalled();
    });

    it('returns ok:false when buildFeeBumpTransaction fails', async () => {
        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = vi.fn().mockResolvedValue({ ok: false, error: 'RPC unavailable' });

        const result = await orchestrateFeeBump(
            innerXdr,
            FEE_SOURCE_PUBKEY,
            USER_ID,
            {} as any,
            NETWORK_PASSPHRASE,
            mockBuild,
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBe('RPC unavailable');
    });
});

describe('orchestrateFeeBump – fee tracking', () => {
    it('creates a usage record on first transaction', async () => {
        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = makeMockBuildFeeBump(300);

        await orchestrateFeeBump(innerXdr, FEE_SOURCE_PUBKEY, USER_ID, {} as any, NETWORK_PASSPHRASE, mockBuild);

        const usage = getFeeBumpUsage(USER_ID);
        expect(usage).toBeDefined();
        expect(usage!.count).toBe(1);
        expect(usage!.totalFeesPaid).toBe(300);
        expect(usage!.lastUsedAt).toBeGreaterThan(0);
    });

    it('accumulates count and totalFeesPaid across multiple transactions', async () => {
        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = makeMockBuildFeeBump(200);

        await orchestrateFeeBump(innerXdr, FEE_SOURCE_PUBKEY, USER_ID, {} as any, NETWORK_PASSPHRASE, mockBuild);
        await orchestrateFeeBump(innerXdr, FEE_SOURCE_PUBKEY, USER_ID, {} as any, NETWORK_PASSPHRASE, mockBuild);
        await orchestrateFeeBump(innerXdr, FEE_SOURCE_PUBKEY, USER_ID, {} as any, NETWORK_PASSPHRASE, mockBuild);

        const usage = getFeeBumpUsage(USER_ID);
        expect(usage!.count).toBe(3);
        expect(usage!.totalFeesPaid).toBe(600);
    });

    it('tracks different users independently', async () => {
        const innerXdr = buildSignedInnerTxXdr();

        await orchestrateFeeBump(innerXdr, FEE_SOURCE_PUBKEY, 'user-1', {} as any, NETWORK_PASSPHRASE, makeMockBuildFeeBump(100));
        await orchestrateFeeBump(innerXdr, FEE_SOURCE_PUBKEY, 'user-2', {} as any, NETWORK_PASSPHRASE, makeMockBuildFeeBump(500));

        expect(getFeeBumpUsage('user-1')!.totalFeesPaid).toBe(100);
        expect(getFeeBumpUsage('user-2')!.totalFeesPaid).toBe(500);
    });

    it('does not update usage when inner XDR is invalid', async () => {
        const mockBuild = makeMockBuildFeeBump(300);

        await orchestrateFeeBump('bad-xdr', FEE_SOURCE_PUBKEY, USER_ID, {} as any, NETWORK_PASSPHRASE, mockBuild);

        expect(getFeeBumpUsage(USER_ID)).toBeUndefined();
    });
});

// ── Pluggable FeeBumpUsageStore interface (Issue #970) ────────────────────

describe('orchestrateFeeBump – pluggable FeeBumpUsageStore', () => {
    it('records usage through a custom FeeBumpUsageStore implementation', async () => {
        const customStore: FeeBumpUsageStore = {
            record: vi.fn().mockResolvedValue(undefined),
        };

        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = makeMockBuildFeeBump(250);

        await orchestrateFeeBump(
            innerXdr,
            FEE_SOURCE_PUBKEY,
            USER_ID,
            {} as any,
            NETWORK_PASSPHRASE,
            mockBuild,
            customStore,
        );

        expect(customStore.record).toHaveBeenCalledWith(USER_ID, 250);
    });

    it('does not update the default store when a custom store is provided', async () => {
        const customStore: FeeBumpUsageStore = {
            record: vi.fn().mockResolvedValue(undefined),
        };

        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = makeMockBuildFeeBump(150);

        await orchestrateFeeBump(
            innerXdr,
            FEE_SOURCE_PUBKEY,
            'custom-user',
            {} as any,
            NETWORK_PASSPHRASE,
            mockBuild,
            customStore,
        );

        // The custom user should not be in the default store
        expect(getFeeBumpUsage('custom-user')).toBeUndefined();
        // But the custom store should have been called
        expect(customStore.record).toHaveBeenCalled();
    });

    it('uses the default store when no custom store is provided', async () => {
        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = makeMockBuildFeeBump(175);

        // Call without providing a custom store
        await orchestrateFeeBump(
            innerXdr,
            FEE_SOURCE_PUBKEY,
            'default-user',
            {} as any,
            NETWORK_PASSPHRASE,
            mockBuild,
        );

        const usage = getFeeBumpUsage('default-user');
        expect(usage).toBeDefined();
        expect(usage!.count).toBe(1);
        expect(usage!.totalFeesPaid).toBe(175);
    });

    it('propagates store.record errors to the result', async () => {
        const customStore: FeeBumpUsageStore = {
            record: vi.fn().mockRejectedValue(new Error('Database connection failed')),
        };

        const innerXdr = buildSignedInnerTxXdr();
        const mockBuild = makeMockBuildFeeBump(300);

        await expect(
            orchestrateFeeBump(
                innerXdr,
                FEE_SOURCE_PUBKEY,
                USER_ID,
                {} as any,
                NETWORK_PASSPHRASE,
                mockBuild,
                customStore,
            ),
        ).rejects.toThrow('Database connection failed');
    });
});
