import { describe, it, expect } from 'vitest';
import { validateStellarConfig, DEFAULT_STELLAR_CONFIG } from './validate-stellar';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A valid 56-char Soroban contract address (starts with C). */
const VALID_CONTRACT = 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST';

/** A valid Stellar account ID (starts with G). */
const VALID_ISSUER = 'GBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST';

const validTestnet = {
    network: 'testnet' as const,
    horizonUrl: 'https://horizon-testnet.stellar.org',
};

const validMainnet = {
    network: 'mainnet' as const,
    horizonUrl: 'https://horizon.stellar.org',
};

// ── Basic validation ──────────────────────────────────────────────────────────

describe('validateStellarConfig — basic', () => {
    it('accepts a minimal valid testnet config', () => {
        expect(validateStellarConfig(validTestnet)).toEqual({ valid: true, errors: [] });
    });

    it('accepts a minimal valid mainnet config', () => {
        expect(validateStellarConfig(validMainnet)).toEqual({ valid: true, errors: [] });
    });

    it('accepts a config with optional sorobanRpcUrl', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        });
        expect(result.valid).toBe(true);
    });

    it('returns errors for null input', () => {
        const result = validateStellarConfig(null);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns errors for empty object', () => {
        const result = validateStellarConfig({});
        expect(result.valid).toBe(false);
    });
});

// ── Network field ─────────────────────────────────────────────────────────────

describe('validateStellarConfig — network', () => {
    it('rejects an unsupported network value', () => {
        const result = validateStellarConfig({ ...validTestnet, network: 'devnet' });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('network');
        expect(result.errors[0].message).toMatch(/mainnet or testnet/i);
    });

    it('rejects a missing network', () => {
        const { network: _n, ...rest } = validTestnet;
        const result = validateStellarConfig(rest);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === 'network')).toBe(true);
    });
});

// ── Horizon URL ───────────────────────────────────────────────────────────────

describe('validateStellarConfig — horizonUrl', () => {
    it('rejects a non-URL horizon value', () => {
        const result = validateStellarConfig({ ...validTestnet, horizonUrl: 'not-a-url' });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('horizonUrl');
    });

    it('rejects a missing horizonUrl', () => {
        const { horizonUrl: _h, ...rest } = validTestnet;
        const result = validateStellarConfig(rest);
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === 'horizonUrl')).toBe(true);
    });

    it('rejects mainnet network with testnet Horizon URL', () => {
        const result = validateStellarConfig({
            network: 'mainnet',
            horizonUrl: 'https://horizon-testnet.stellar.org',
        });
        expect(result.valid).toBe(false);
        const err = result.errors.find((e) => e.field === 'horizonUrl');
        expect(err).toBeDefined();
        expect(err!.message).toMatch(/testnet.*mainnet|mainnet.*testnet/i);
    });

    it('rejects testnet network with mainnet Horizon URL', () => {
        const result = validateStellarConfig({
            network: 'testnet',
            horizonUrl: 'https://horizon.stellar.org',
        });
        expect(result.valid).toBe(false);
        const err = result.errors.find((e) => e.field === 'horizonUrl');
        expect(err).toBeDefined();
    });

    it('accepts a custom Horizon URL that does not match defaults', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            horizonUrl: 'https://my-custom-horizon.example.com',
        });
        expect(result.valid).toBe(true);
    });
});

// ── Soroban RPC URL ───────────────────────────────────────────────────────────

describe('validateStellarConfig — sorobanRpcUrl', () => {
    it('accepts a valid sorobanRpcUrl', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        });
        expect(result.valid).toBe(true);
    });

    it('rejects an invalid sorobanRpcUrl', () => {
        const result = validateStellarConfig({ ...validTestnet, sorobanRpcUrl: 'bad-url' });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('sorobanRpcUrl');
    });

    it('accepts config without sorobanRpcUrl', () => {
        expect(validateStellarConfig(validTestnet)).toEqual({ valid: true, errors: [] });
    });
});

// ── Asset pairs ───────────────────────────────────────────────────────────────

describe('validateStellarConfig — assetPairs', () => {
    const nativeAsset = { code: 'XLM', issuer: '', type: 'native' as const };
    const usdcAsset = { code: 'USDC', issuer: VALID_ISSUER, type: 'credit_alphanum4' as const };

    it('accepts a valid asset pair', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            assetPairs: [{ base: nativeAsset, counter: usdcAsset }],
        });
        expect(result.valid).toBe(true);
    });

    it('accepts an empty assetPairs array', () => {
        const result = validateStellarConfig({ ...validTestnet, assetPairs: [] });
        expect(result.valid).toBe(true);
    });

    it('rejects more than 20 asset pairs', () => {
        const pairs = Array.from({ length: 21 }, () => ({
            base: nativeAsset,
            counter: usdcAsset,
        }));
        const result = validateStellarConfig({ ...validTestnet, assetPairs: pairs });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('assetPairs');
    });

    it('rejects a non-native asset without an issuer', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            assetPairs: [
                {
                    base: nativeAsset,
                    counter: { code: 'USDC', issuer: '', type: 'credit_alphanum4' as const },
                },
            ],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field.includes('issuer'))).toBe(true);
    });

    it('rejects a non-native asset with an invalid issuer', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            assetPairs: [
                {
                    base: nativeAsset,
                    counter: { code: 'USDC', issuer: 'NOTANACCOUNTID', type: 'credit_alphanum4' as const },
                },
            ],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field.includes('issuer'))).toBe(true);
    });

    it('rejects a credit_alphanum4 asset with a code longer than 4 chars', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            assetPairs: [
                {
                    base: nativeAsset,
                    counter: { code: 'TOOLONG', issuer: VALID_ISSUER, type: 'credit_alphanum4' as const },
                },
            ],
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field.includes('code'))).toBe(true);
    });

    it('accepts a credit_alphanum12 asset with a long code', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            assetPairs: [
                {
                    base: nativeAsset,
                    counter: { code: 'LONGCODE1234', issuer: VALID_ISSUER, type: 'credit_alphanum12' as const },
                },
            ],
        });
        expect(result.valid).toBe(true);
    });

    it('rejects an asset code with invalid characters', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            assetPairs: [
                {
                    base: nativeAsset,
                    counter: { code: 'US$C', issuer: VALID_ISSUER, type: 'credit_alphanum4' as const },
                },
            ],
        });
        expect(result.valid).toBe(false);
    });
});

// ── Contract addresses ────────────────────────────────────────────────────────

describe('validateStellarConfig — contractAddresses', () => {
    it('accepts a valid contract address', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            contractAddresses: { amm: VALID_CONTRACT },
        });
        expect(result.valid).toBe(true);
    });

    it('accepts an empty contractAddresses object', () => {
        const result = validateStellarConfig({ ...validTestnet, contractAddresses: {} });
        expect(result.valid).toBe(true);
    });

    it('rejects a contract address that does not start with C', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            contractAddresses: { amm: VALID_ISSUER }, // starts with G
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('contractAddresses.amm');
    });

    it('rejects a contract address that is too short', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            contractAddresses: { amm: 'CSHORT' },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('contractAddresses.amm');
    });

    it('rejects a contract address with invalid characters', () => {
        const invalid = 'C' + '1'.repeat(54) + '-'; // 56 chars but last is invalid
        const result = validateStellarConfig({
            ...validTestnet,
            contractAddresses: { amm: invalid },
        });
        expect(result.valid).toBe(false);
    });

    it('accepts multiple valid contract addresses', () => {
        const result = validateStellarConfig({
            ...validTestnet,
            contractAddresses: {
                amm: VALID_CONTRACT,
                lending: 'CATPNZ2SJRSVZJBWXGFSMZQHQ47JM5PXNQRVJLGHGHVKPZ2OVH3FHXPA',
            },
        });
        expect(result.valid).toBe(true);
    });
});

// ── DEFAULT_STELLAR_CONFIG ────────────────────────────────────────────────────

describe('DEFAULT_STELLAR_CONFIG', () => {
    it('is valid according to the schema', () => {
        expect(validateStellarConfig(DEFAULT_STELLAR_CONFIG)).toEqual({ valid: true, errors: [] });
    });

    it('defaults to testnet', () => {
        expect(DEFAULT_STELLAR_CONFIG.network).toBe('testnet');
    });

    it('uses the testnet Horizon URL', () => {
        expect(DEFAULT_STELLAR_CONFIG.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    });
});
