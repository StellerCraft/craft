import type { StellarMockData, StellarAsset, MockTransaction, TemplateCategory } from '@craft/types';

/**
 * MockStellarGenerator
 * 
 * Generates deterministic fake Stellar data for preview rendering.
 * Supports seedable generation for testing and template-specific data.
 * Ensures no real network access in preview scenarios.
 */
export class MockStellarGenerator {
    private seed: number;

    constructor(seed?: number) {
        this.seed = seed ?? 42;
    }

    /**
     * Generate complete mock Stellar data for a given network and template category.
     */
    generateMockData(
        network: 'mainnet' | 'testnet',
        category?: TemplateCategory
    ): StellarMockData {
        const isMainnet = network === 'mainnet';

        return {
            accountBalance: this.generateAccountBalance(isMainnet),
            recentTransactions: this.generateTransactions(isMainnet, category),
            assetPrices: this.generateAssetPrices(isMainnet),
        };
    }

    /**
     * Generate account balance based on network.
     * Mainnet has higher balances for realistic preview.
     */
    generateAccountBalance(isMainnet: boolean): string {
        const base = isMainnet ? 10000 : 5000;
        const variance = this.seededRandom() * 1000;
        const balance = base + variance;
        return balance.toFixed(7);
    }

    /**
     * Generate mock transactions based on network and template category.
     * Different categories show different transaction types.
     */
    generateTransactions(
        isMainnet: boolean,
        category?: TemplateCategory
    ): MockTransaction[] {
        const assets = this.getNetworkAssets(isMainnet);
        const now = new Date();

        switch (category) {
            case 'dex':
                return this.generateDexTransactions(assets, now);
            case 'lending':
                return this.generateLendingTransactions(assets, now);
            case 'payment':
                return this.generatePaymentTransactions(assets, now);
            case 'asset-issuance':
                return this.generateAssetIssuanceTransactions(assets, now);
            default:
                return this.generateDefaultTransactions(assets, now);
        }
    }

    /**
     * Generate asset prices based on network.
     * Mainnet has higher prices for realistic preview.
     */
    generateAssetPrices(isMainnet: boolean): Record<string, number> {
        const multiplier = isMainnet ? 1.2 : 1.0;

        return {
            XLM: 0.10 * multiplier,
            USDC: 1.0,
            BTC: 40000.0 * multiplier,
            ETH: 2500.0 * multiplier,
            AQUA: 0.05 * multiplier,
            yXLM: 0.11 * multiplier,
        };
    }

    /**
     * Get network-specific asset definitions.
     */
    private getNetworkAssets(isMainnet: boolean): {
        xlm: StellarAsset;
        usdc: StellarAsset;
        btc: StellarAsset;
    } {
        return {
            xlm: {
                code: 'XLM',
                issuer: '',
                type: 'native',
            },
            usdc: {
                code: 'USDC',
                issuer: isMainnet
                    ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
                    : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
                type: 'credit_alphanum4',
            },
            btc: {
                code: 'BTC',
                issuer: isMainnet
                    ? 'GAUTUYY2THLF7SGITDFMXJVYH3LHDSMGEAKSBU267M2K7A3W543CKUEF'
                    : 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ65JJLDHKHRUZI3EUEKMTCH',
                type: 'credit_alphanum4',
            },
        };
    }

    /**
     * Generate DEX-specific transactions (swaps, liquidity).
     */
    private generateDexTransactions(
        assets: ReturnType<typeof this.getNetworkAssets>,
        now: Date
    ): MockTransaction[] {
        return [
            {
                id: this.generateTxId(1),
                type: 'swap',
                amount: '100.0000000',
                asset: assets.xlm,
                timestamp: new Date(now.getTime() - 1800000), // 30 min ago
            },
            {
                id: this.generateTxId(2),
                type: 'swap',
                amount: '50.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
            },
            {
                id: this.generateTxId(3),
                type: 'add_liquidity',
                amount: '200.0000000',
                asset: assets.xlm,
                timestamp: new Date(now.getTime() - 7200000), // 2 hours ago
            },
            {
                id: this.generateTxId(4),
                type: 'remove_liquidity',
                amount: '75.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 86400000), // 1 day ago
            },
        ];
    }

    /**
     * Generate lending-specific transactions (borrow, repay, supply).
     */
    private generateLendingTransactions(
        assets: ReturnType<typeof this.getNetworkAssets>,
        now: Date
    ): MockTransaction[] {
        return [
            {
                id: this.generateTxId(1),
                type: 'supply',
                amount: '500.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 3600000),
            },
            {
                id: this.generateTxId(2),
                type: 'borrow',
                amount: '200.0000000',
                asset: assets.xlm,
                timestamp: new Date(now.getTime() - 7200000),
            },
            {
                id: this.generateTxId(3),
                type: 'repay',
                amount: '50.0000000',
                asset: assets.xlm,
                timestamp: new Date(now.getTime() - 86400000),
            },
        ];
    }

    /**
     * Generate payment-specific transactions.
     */
    private generatePaymentTransactions(
        assets: ReturnType<typeof this.getNetworkAssets>,
        now: Date
    ): MockTransaction[] {
        return [
            {
                id: this.generateTxId(1),
                type: 'payment',
                amount: '100.0000000',
                asset: assets.xlm,
                timestamp: new Date(now.getTime() - 1800000),
            },
            {
                id: this.generateTxId(2),
                type: 'payment',
                amount: '25.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 3600000),
            },
            {
                id: this.generateTxId(3),
                type: 'payment',
                amount: '50.0000000',
                asset: assets.xlm,
                timestamp: new Date(now.getTime() - 7200000),
            },
            {
                id: this.generateTxId(4),
                type: 'payment',
                amount: '10.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 86400000),
            },
        ];
    }

    /**
     * Generate asset issuance transactions.
     */
    private generateAssetIssuanceTransactions(
        assets: ReturnType<typeof this.getNetworkAssets>,
        now: Date
    ): MockTransaction[] {
        return [
            {
                id: this.generateTxId(1),
                type: 'create_asset',
                amount: '1000000.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 86400000),
            },
            {
                id: this.generateTxId(2),
                type: 'mint',
                amount: '500.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 3600000),
            },
            {
                id: this.generateTxId(3),
                type: 'burn',
                amount: '100.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 1800000),
            },
        ];
    }

    /**
     * Generate default transactions (mixed types).
     */
    private generateDefaultTransactions(
        assets: ReturnType<typeof this.getNetworkAssets>,
        now: Date
    ): MockTransaction[] {
        return [
            {
                id: this.generateTxId(1),
                type: 'payment',
                amount: '100.0000000',
                asset: assets.xlm,
                timestamp: new Date(now.getTime() - 3600000),
            },
            {
                id: this.generateTxId(2),
                type: 'swap',
                amount: '50.0000000',
                asset: assets.usdc,
                timestamp: new Date(now.getTime() - 7200000),
            },
            {
                id: this.generateTxId(3),
                type: 'payment',
                amount: '25.5000000',
                asset: assets.xlm,
                timestamp: new Date(now.getTime() - 86400000),
            },
        ];
    }

    /**
     * Generate deterministic transaction ID using seed.
     */
    private generateTxId(index: number): string {
        const base = 'preview';
        const seededIndex = (this.seed + index) % 10000;
        const padded = seededIndex.toString().padStart(4, '0');
        return `${base}${padded}${'a'.repeat(60)}`;
    }

    /**
     * Seeded pseudo-random number generator (0-1).
     * Uses simple LCG algorithm for deterministic randomness.
     */
    private seededRandom(): number {
        this.seed = (this.seed * 1103515245 + 12345) % 2147483648;
        return this.seed / 2147483648;
    }

    /**
     * Reset seed for testing purposes.
     */
    resetSeed(seed: number): void {
        this.seed = seed;
    }
}

export const mockStellarGenerator = new MockStellarGenerator();
