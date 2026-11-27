export type StellarAssetType = 'native' | 'credit_alphanum4' | 'credit_alphanum12';

/**
 * Throws when a credit asset code does not fit its declared type. Stellar
 * requires 1-4 characters for credit_alphanum4 and 5-12 for credit_alphanum12.
 */
export function assertValidStellarAssetCode(type: StellarAssetType, code: string): void {
    if (type === 'native') return;
    if (!/^[A-Z0-9]{1,12}$/.test(code)) {
        throw new Error('A credit Stellar asset code must be 1-12 uppercase alphanumeric characters.');
    }
    if (type === 'credit_alphanum4' && code.length > 4) {
        throw new Error('credit_alphanum4 asset codes must be 1-4 characters.');
    }
    if (type === 'credit_alphanum12' && code.length < 5) {
        throw new Error('credit_alphanum12 asset codes must be 5-12 characters.');
    }
}

export interface StellarAsset {
    code: string;
    issuer: string;
    type: StellarAssetType;
}

export interface AssetPair {
    base: StellarAsset;
    counter: StellarAsset;
}

export interface StellarNetworkConfig {
    network: 'mainnet' | 'testnet';
    horizonUrl: string;
    networkPassphrase: string;
    sorobanRpcUrl?: string;
}

export interface MockTransaction {
    id: string;
    type: string;
    amount: string;
    asset: StellarAsset;
    timestamp: Date;
}

export interface StellarMockData {
    accountBalance: string;
    recentTransactions: MockTransaction[];
    assetPrices: Record<string, number>;
}
