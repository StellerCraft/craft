/**
 * Tests for StellarConfigGenerator
 *
 * Covers:
 *   - buildStellarEnvVars
 *   - buildStellarRuntimeConfig
 *   - generateStellarConfigFile
 *   - formatAssetLabel
 *   - requiresSoroban / usesAssetPairs / usesContractAddresses
 *
 * Design properties verified:
 *   Property 12 — Network Configuration Mapping
 *   Property 16 — Code Generation Completeness
 *   Property 42 — Configuration-Driven Blockchain Settings
 *   Property 46 — Stellar SDK Inclusion
 *   Property 47 — Soroban Configuration Inclusion
 *
 * Feature: stellar-configuration-generation
 * Issue branch: issue-065-implement-stellar-configuration-generation
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    buildStellarEnvVars,
    buildStellarRuntimeConfig,
    generateStellarConfigFile,
    formatAssetLabel,
    requiresSoroban,
    usesAssetPairs,
    usesContractAddresses,
} from './stellar-config-generator';
import type { StellarConfig, AssetPair, StellarAsset } from '@craft/types';
import type { TemplateFamilyId } from '@/services/code-generator.service';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TESTNET_CONFIG: StellarConfig = {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
};

const MAINNET_CONFIG: StellarConfig = {
    network: 'mainnet',
    horizonUrl: 'https://horizon.stellar.org',
};

const USDC_ASSET: StellarAsset = {
    code: 'USDC',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    type: 'credit_alphanum4',
};

const XLM_ASSET: StellarAsset = {
    code: 'XLM',
    issuer: '',
    type: 'native',
};

const ASSET_PAIR: AssetPair = { base: XLM_ASSET, counter: USDC_ASSET };

const VALID_CONTRACT = 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST';

const SOROBAN_CONFIG: StellarConfig = {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    assetPairs: [ASSET_PAIR],
    contractAddresses: { dex: VALID_CONTRACT },
};

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbNetwork = fc.constantFrom<'mainnet' | 'testnet'>('mainnet', 'testnet');

const arbStellarConfig = arbNetwork.map(
    (network): StellarConfig => ({
        network,
        horizonUrl:
            network === 'mainnet'
                ? 'https://horizon.stellar.org'
                : 'https://horizon-testnet.stellar.org',
    })
);

const arbTemplateFamilyId = fc.constantFrom<TemplateFamilyId>(
    'stellar-dex',
    'soroban-defi',
    'payment-gateway',
    'asset-issuance'
);

// ── buildStellarEnvVars ───────────────────────────────────────────────────────

describe('buildStellarEnvVars', () => {
    describe('required fields', () => {
        it('includes NEXT_PUBLIC_STELLAR_NETWORK', () => {
            const vars = buildStellarEnvVars(TESTNET_CONFIG);
            expect(vars.NEXT_PUBLIC_STELLAR_NETWORK).toBe('testnet');
        });

        it('includes NEXT_PUBLIC_HORIZON_URL', () => {
            const vars = buildStellarEnvVars(TESTNET_CONFIG);
            expect(vars.NEXT_PUBLIC_HORIZON_URL).toBe('https://horizon-testnet.stellar.org');
        });

        it('includes NEXT_PUBLIC_NETWORK_PASSPHRASE for testnet', () => {
            const vars = buildStellarEnvVars(TESTNET_CONFIG);
            expect(vars.NEXT_PUBLIC_NETWORK_PASSPHRASE).toBe('Test SDF Network ; September 2015');
        });

        it('includes NEXT_PUBLIC_NETWORK_PASSPHRASE for mainnet', () => {
            const vars = buildStellarEnvVars(MAINNET_CONFIG);
            expect(vars.NEXT_PUBLIC_NETWORK_PASSPHRASE).toBe(
                'Public Global Stellar Network ; September 2015'
            );
        });
    });

    describe('optional fields', () => {
        it('omits NEXT_PUBLIC_SOROBAN_RPC_URL when not provided', () => {
            const vars = buildStellarEnvVars(TESTNET_CONFIG);
            expect(vars.NEXT_PUBLIC_SOROBAN_RPC_URL).toBeUndefined();
        });

        it('includes NEXT_PUBLIC_SOROBAN_RPC_URL when provided', () => {
            const vars = buildStellarEnvVars(SOROBAN_CONFIG);
            expect(vars.NEXT_PUBLIC_SOROBAN_RPC_URL).toBe('https://soroban-testnet.stellar.org');
        });

        it('omits NEXT_PUBLIC_ASSET_PAIRS when assetPairs is empty', () => {
            const vars = buildStellarEnvVars({ ...TESTNET_CONFIG, assetPairs: [] });
            expect(vars.NEXT_PUBLIC_ASSET_PAIRS).toBeUndefined();
        });

        it('omits NEXT_PUBLIC_ASSET_PAIRS when assetPairs is absent', () => {
            const vars = buildStellarEnvVars(TESTNET_CONFIG);
            expect(vars.NEXT_PUBLIC_ASSET_PAIRS).toBeUndefined();
        });

        it('includes NEXT_PUBLIC_ASSET_PAIRS as JSON when pairs present', () => {
            const vars = buildStellarEnvVars(SOROBAN_CONFIG);
            expect(vars.NEXT_PUBLIC_ASSET_PAIRS).toBe(JSON.stringify([ASSET_PAIR]));
        });

        it('omits NEXT_PUBLIC_CONTRACT_ADDRESSES when empty', () => {
            const vars = buildStellarEnvVars({ ...TESTNET_CONFIG, contractAddresses: {} });
            expect(vars.NEXT_PUBLIC_CONTRACT_ADDRESSES).toBeUndefined();
        });

        it('includes NEXT_PUBLIC_CONTRACT_ADDRESSES as JSON when present', () => {
            const vars = buildStellarEnvVars(SOROBAN_CONFIG);
            expect(vars.NEXT_PUBLIC_CONTRACT_ADDRESSES).toBe(
                JSON.stringify({ dex: VALID_CONTRACT })
            );
        });
    });

    describe('horizon URL fallback', () => {
        it('uses provided horizonUrl over default', () => {
            const custom = { ...TESTNET_CONFIG, horizonUrl: 'https://my-horizon.example.com' };
            const vars = buildStellarEnvVars(custom);
            expect(vars.NEXT_PUBLIC_HORIZON_URL).toBe('https://my-horizon.example.com');
        });
    });

    describe('Property 12 — Network Configuration Mapping', () => {
        it('always maps network to correct passphrase', () => {
            fc.assert(
                fc.property(arbStellarConfig, (config) => {
                    const vars = buildStellarEnvVars(config);
                    if (config.network === 'mainnet') {
                        expect(vars.NEXT_PUBLIC_NETWORK_PASSPHRASE).toContain('Public Global');
                    } else {
                        expect(vars.NEXT_PUBLIC_NETWORK_PASSPHRASE).toContain('Test SDF');
                    }
                })
            );
        });

        it('always includes all three required env vars', () => {
            fc.assert(
                fc.property(arbStellarConfig, (config) => {
                    const vars = buildStellarEnvVars(config);
                    expect(vars.NEXT_PUBLIC_STELLAR_NETWORK).toBeDefined();
                    expect(vars.NEXT_PUBLIC_HORIZON_URL).toBeDefined();
                    expect(vars.NEXT_PUBLIC_NETWORK_PASSPHRASE).toBeDefined();
                })
            );
        });
    });
});

// ── buildStellarRuntimeConfig ─────────────────────────────────────────────────

describe('buildStellarRuntimeConfig', () => {
    it('maps network correctly', () => {
        const config = buildStellarRuntimeConfig(MAINNET_CONFIG);
        expect(config.network).toBe('mainnet');
    });

    it('resolves horizonUrl', () => {
        const config = buildStellarRuntimeConfig(TESTNET_CONFIG);
        expect(config.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    });

    it('resolves networkPassphrase for testnet', () => {
        const config = buildStellarRuntimeConfig(TESTNET_CONFIG);
        expect(config.networkPassphrase).toBe('Test SDF Network ; September 2015');
    });

    it('resolves networkPassphrase for mainnet', () => {
        const config = buildStellarRuntimeConfig(MAINNET_CONFIG);
        expect(config.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
    });

    it('omits sorobanRpcUrl when not provided', () => {
        const config = buildStellarRuntimeConfig(TESTNET_CONFIG);
        expect(config.sorobanRpcUrl).toBeUndefined();
    });

    it('includes sorobanRpcUrl when provided', () => {
        const config = buildStellarRuntimeConfig(SOROBAN_CONFIG);
        expect(config.sorobanRpcUrl).toBe('https://soroban-testnet.stellar.org');
    });

    it('defaults assetPairs to empty array', () => {
        const config = buildStellarRuntimeConfig(TESTNET_CONFIG);
        expect(config.assetPairs).toEqual([]);
    });

    it('includes assetPairs when provided', () => {
        const config = buildStellarRuntimeConfig(SOROBAN_CONFIG);
        expect(config.assetPairs).toEqual([ASSET_PAIR]);
    });

    it('defaults contractAddresses to empty object', () => {
        const config = buildStellarRuntimeConfig(TESTNET_CONFIG);
        expect(config.contractAddresses).toEqual({});
    });

    it('includes contractAddresses when provided', () => {
        const config = buildStellarRuntimeConfig(SOROBAN_CONFIG);
        expect(config.contractAddresses).toEqual({ dex: VALID_CONTRACT });
    });

    describe('Property 42 — Configuration-Driven Blockchain Settings', () => {
        it('always reflects the input network', () => {
            fc.assert(
                fc.property(arbStellarConfig, (stellar) => {
                    const config = buildStellarRuntimeConfig(stellar);
                    expect(config.network).toBe(stellar.network);
                })
            );
        });

        it('always reflects the input horizonUrl', () => {
            fc.assert(
                fc.property(arbStellarConfig, (stellar) => {
                    const config = buildStellarRuntimeConfig(stellar);
                    expect(config.horizonUrl).toBe(stellar.horizonUrl);
                })
            );
        });
    });
});

// ── generateStellarConfigFile ─────────────────────────────────────────────────

describe('generateStellarConfigFile', () => {
    describe('Property 16 — Code Generation Completeness', () => {
        it('includes network value', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain("'testnet'");
        });

        it('includes horizonUrl value', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('https://horizon-testnet.stellar.org');
        });

        it('includes networkPassphrase value', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('Test SDF Network ; September 2015');
        });

        it('includes assetPairs line', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('assetPairs');
        });

        it('includes contractAddresses line', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('contractAddresses');
        });

        it('exports stellarConfig as default', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('export default stellarConfig');
        });

        it('imports AssetPair type', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain("import type { AssetPair }");
        });

        it('reads from env vars at runtime', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('process.env.NEXT_PUBLIC_STELLAR_NETWORK');
            expect(output).toContain('process.env.NEXT_PUBLIC_HORIZON_URL');
            expect(output).toContain('process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE');
        });

        it('always produces syntactically valid output for any config', () => {
            fc.assert(
                fc.property(arbTemplateFamilyId, arbStellarConfig, (family, stellar) => {
                    const output = generateStellarConfigFile(family, stellar);
                    expect(output).toContain('export const stellarConfig');
                    expect(output).toContain('export default stellarConfig');
                    expect(output.split('{').length).toBe(output.split('}').length);
                })
            );
        });
    });

    describe('Property 47 — Soroban Configuration Inclusion', () => {
        it('includes sorobanRpcUrl line when provided', () => {
            const output = generateStellarConfigFile('soroban-defi', SOROBAN_CONFIG);
            expect(output).toContain('sorobanRpcUrl');
            expect(output).toContain('https://soroban-testnet.stellar.org');
        });

        it('includes default sorobanRpcUrl for soroban-defi family even without explicit URL', () => {
            const output = generateStellarConfigFile('soroban-defi', TESTNET_CONFIG);
            expect(output).toContain('sorobanRpcUrl');
            expect(output).toContain('https://soroban-testnet.stellar.org');
        });

        it('omits sorobanRpcUrl for non-soroban families without explicit URL', () => {
            const output = generateStellarConfigFile('payment-gateway', TESTNET_CONFIG);
            expect(output).not.toContain('sorobanRpcUrl');
        });

        it('includes sorobanRpcUrl for payment-gateway when explicitly provided', () => {
            const output = generateStellarConfigFile('payment-gateway', SOROBAN_CONFIG);
            expect(output).toContain('sorobanRpcUrl');
        });
    });

    describe('asset pairs in generated file', () => {
        it('embeds asset pairs as JSON fallback', () => {
            const output = generateStellarConfigFile('stellar-dex', SOROBAN_CONFIG);
            expect(output).toContain(JSON.stringify([ASSET_PAIR]).replace(/'/g, "\\'"));
        });

        it('uses empty array fallback when no asset pairs', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain("'[]'");
        });

        it('reads asset pairs from env var at runtime', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('process.env.NEXT_PUBLIC_ASSET_PAIRS');
        });
    });

    describe('contract addresses in generated file', () => {
        it('embeds contract addresses as JSON fallback', () => {
            const output = generateStellarConfigFile('soroban-defi', SOROBAN_CONFIG);
            expect(output).toContain(JSON.stringify({ dex: VALID_CONTRACT }).replace(/'/g, "\\'"));
        });

        it('uses empty object fallback when no contracts', () => {
            const output = generateStellarConfigFile('soroban-defi', TESTNET_CONFIG);
            expect(output).toContain("'{}'");
        });

        it('reads contract addresses from env var at runtime', () => {
            const output = generateStellarConfigFile('soroban-defi', TESTNET_CONFIG);
            expect(output).toContain('process.env.NEXT_PUBLIC_CONTRACT_ADDRESSES');
        });
    });

    describe('template family annotation', () => {
        it('includes template family in header comment', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('// Template: stellar-dex');
        });

        it('includes CRAFT Platform attribution', () => {
            const output = generateStellarConfigFile('stellar-dex', TESTNET_CONFIG);
            expect(output).toContain('Auto-generated by CRAFT Platform');
        });
    });
});

// ── formatAssetLabel ──────────────────────────────────────────────────────────

describe('formatAssetLabel', () => {
    it('returns "XLM (native)" for native asset', () => {
        expect(formatAssetLabel(XLM_ASSET)).toBe('XLM (native)');
    });

    it('returns "CODE (ISSUER)" for non-native asset', () => {
        expect(formatAssetLabel(USDC_ASSET)).toBe(
            `USDC (${USDC_ASSET.issuer})`
        );
    });

    it('handles credit_alphanum12 assets', () => {
        const asset: StellarAsset = {
            code: 'LONGTOKEN',
            issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            type: 'credit_alphanum12',
        };
        expect(formatAssetLabel(asset)).toBe(`LONGTOKEN (${asset.issuer})`);
    });
});

// ── Template family predicates ────────────────────────────────────────────────

describe('requiresSoroban', () => {
    it('returns true for soroban-defi', () => {
        expect(requiresSoroban('soroban-defi')).toBe(true);
    });

    it('returns false for stellar-dex', () => {
        expect(requiresSoroban('stellar-dex')).toBe(false);
    });

    it('returns false for payment-gateway', () => {
        expect(requiresSoroban('payment-gateway')).toBe(false);
    });

    it('returns false for asset-issuance', () => {
        expect(requiresSoroban('asset-issuance')).toBe(false);
    });
});

describe('usesAssetPairs', () => {
    it('returns true for stellar-dex', () => {
        expect(usesAssetPairs('stellar-dex')).toBe(true);
    });

    it('returns true for soroban-defi', () => {
        expect(usesAssetPairs('soroban-defi')).toBe(true);
    });

    it('returns false for payment-gateway', () => {
        expect(usesAssetPairs('payment-gateway')).toBe(false);
    });

    it('returns false for asset-issuance', () => {
        expect(usesAssetPairs('asset-issuance')).toBe(false);
    });
});

describe('usesContractAddresses', () => {
    it('returns true for soroban-defi', () => {
        expect(usesContractAddresses('soroban-defi')).toBe(true);
    });

    it('returns true for asset-issuance', () => {
        expect(usesContractAddresses('asset-issuance')).toBe(true);
    });

    it('returns false for stellar-dex', () => {
        expect(usesContractAddresses('stellar-dex')).toBe(false);
    });

    it('returns false for payment-gateway', () => {
        expect(usesContractAddresses('payment-gateway')).toBe(false);
    });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe('Edge Cases', () => {
    it('handles single quotes in JSON values without breaking generated file', () => {
        // Contract addresses or asset codes with apostrophes should be escaped
        const config: StellarConfig = {
            ...TESTNET_CONFIG,
            contractAddresses: { "it's-a-key": VALID_CONTRACT },
        };
        const output = generateStellarConfigFile('soroban-defi', config);
        // Should not contain unescaped single quote inside the string literal
        const contractsLine = output
            .split('\n')
            .find((l) => l.includes('contractAddresses'));
        expect(contractsLine).toBeDefined();
        // The generated line should be parseable (no syntax break)
        expect(output).toContain('contractAddresses');
    });

    it('buildStellarEnvVars serialises multiple asset pairs correctly', () => {
        const config: StellarConfig = {
            ...TESTNET_CONFIG,
            assetPairs: [ASSET_PAIR, { base: USDC_ASSET, counter: XLM_ASSET }],
        };
        const vars = buildStellarEnvVars(config);
        const parsed = JSON.parse(vars.NEXT_PUBLIC_ASSET_PAIRS!);
        expect(parsed).toHaveLength(2);
    });

    it('buildStellarRuntimeConfig handles undefined assetPairs gracefully', () => {
        const config: StellarConfig = { ...TESTNET_CONFIG, assetPairs: undefined };
        const runtime = buildStellarRuntimeConfig(config);
        expect(runtime.assetPairs).toEqual([]);
    });

    it('buildStellarRuntimeConfig handles undefined contractAddresses gracefully', () => {
        const config: StellarConfig = { ...TESTNET_CONFIG, contractAddresses: undefined };
        const runtime = buildStellarRuntimeConfig(config);
        expect(runtime.contractAddresses).toEqual({});
    });
});
