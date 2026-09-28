// Feature: craft-platform, Property 9: Stellar Configuration Validation
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateCustomizationConfig } from './validate';
import type { CustomizationConfig, StellarAsset, AssetPair } from '@craft/types';
import { encodeContractAddress } from '../stellar/strkey-test-utils';

// ── Network constants ─────────────────────────────────────────────────────────

const MAINNET_HORIZON = 'https://horizon.stellar.org';
const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const MAINNET_SOROBAN_RPC = 'https://soroban-rpc.stellar.org';
const TESTNET_SOROBAN_RPC = 'https://soroban-testnet.stellar.org';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbNetwork = fc.constantFrom('mainnet' as const, 'testnet' as const);

/** Valid Stellar asset code: 1–4 chars (alphanum4) or 5–12 chars (alphanum12) */
const arbAssetCode4 = fc.stringMatching(/^[A-Z]{1,4}$/);
const arbAssetCode12 = fc.stringMatching(/^[A-Z]{5,12}$/);
const arbAssetCode = fc.oneof(arbAssetCode4, arbAssetCode12);

/** Stellar account IDs start with G and are 56 chars (base32) */
const arbAccountId = fc.stringMatching(/^G[A-Z2-7]{55}$/);

const arbStellarAsset: fc.Arbitrary<StellarAsset> = fc
    .tuple(arbAssetCode, arbAccountId)
    .map(([code, issuer]) => ({
        code,
        issuer,
        type: (code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12') as StellarAsset['type'],
    }));

const arbAssetPair: fc.Arbitrary<AssetPair> = fc
    .tuple(arbStellarAsset, arbStellarAsset)
    .map(([base, counter]) => ({ base, counter }));

const arbAssetPairs = fc.array(arbAssetPair, { maxLength: 5 });

/** Contract addresses: real strkey-encoded Soroban contract IDs (valid checksum, version byte 0x10) */
const arbContractId = fc.uint8Array({ minLength: 32, maxLength: 32 }).map(encodeContractAddress);
const arbContractAddresses = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 32 }),
    arbContractId,
    { maxKeys: 5 }
);

/** Base config with distinct colors to avoid DUPLICATE_COLORS interference */
const arbValidBaseConfig = fc.record({
    branding: fc.record({
        appName: fc.string({ minLength: 1, maxLength: 60 }),
        primaryColor: fc.constant('#000000'),
        secondaryColor: fc.constant('#ffffff'),
        fontFamily: fc.constantFrom('Inter', 'Roboto', 'Arial'),
    }),
    features: fc.record({
        enableCharts: fc.boolean(),
        enableTransactionHistory: fc.boolean(),
        enableAnalytics: fc.boolean(),
        enableNotifications: fc.boolean(),
    }),
});

/** Builds a full valid CustomizationConfig for a given network */
function makeValidConfig(
    base: Omit<CustomizationConfig, 'stellar'>,
    network: 'mainnet' | 'testnet',
    overrides: Partial<CustomizationConfig['stellar']> = {}
): CustomizationConfig {
    return {
        ...base,
        stellar: {
            network,
            horizonUrl: network === 'mainnet' ? MAINNET_HORIZON : TESTNET_HORIZON,
            ...overrides,
        },
    };
}

// ── Property 9: Stellar Configuration Validation ──────────────────────────────

describe('Stellar Configuration Validation — Property 9', () => {
    // ── Valid configurations ──────────────────────────────────────────────────

    describe('valid configurations always pass', () => {
        it('accepts any valid network + matching horizon URL combination', () => {
            fc.assert(
                fc.property(arbValidBaseConfig, arbNetwork, (base, network) => {
                    const config = makeValidConfig(base, network);
                    const result = validateCustomizationConfig(config);

                    expect(result.valid).toBe(true);
                    expect(result.errors).toEqual([]);
                }),
                { numRuns: 100 }
            );
        });

        it('accepts any valid network + horizon + soroban RPC combination', () => {
            fc.assert(
                fc.property(arbValidBaseConfig, arbNetwork, (base, network) => {
                    const sorobanRpcUrl =
                        network === 'mainnet' ? MAINNET_SOROBAN_RPC : TESTNET_SOROBAN_RPC;
                    const config = makeValidConfig(base, network, { sorobanRpcUrl });
                    const result = validateCustomizationConfig(config);

                    expect(result.valid).toBe(true);
                    expect(result.errors).toEqual([]);
                }),
                { numRuns: 100 }
            );
        });

        it('accepts any valid network + asset pairs combination', () => {
            fc.assert(
                fc.property(arbValidBaseConfig, arbNetwork, arbAssetPairs, (base, network, assetPairs) => {
                    const config = makeValidConfig(base, network, { assetPairs });
                    const result = validateCustomizationConfig(config);

                    expect(result.valid).toBe(true);
                    expect(result.errors).toEqual([]);
                }),
                { numRuns: 100 }
            );
        });

        it('accepts any valid network + contract addresses combination', () => {
            fc.assert(
                fc.property(
                    arbValidBaseConfig,
                    arbNetwork,
                    arbContractAddresses,
                    (base, network, contractAddresses) => {
                        const config = makeValidConfig(base, network, { contractAddresses });
                        const result = validateCustomizationConfig(config);

                        expect(result.valid).toBe(true);
                        expect(result.errors).toEqual([]);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('accepts any valid combination of network, asset pairs, and contract addresses', () => {
            fc.assert(
                fc.property(
                    arbValidBaseConfig,
                    arbNetwork,
                    arbAssetPairs,
                    arbContractAddresses,
                    (base, network, assetPairs, contractAddresses) => {
                        const sorobanRpcUrl =
                            network === 'mainnet' ? MAINNET_SOROBAN_RPC : TESTNET_SOROBAN_RPC;
                        const config = makeValidConfig(base, network, {
                            sorobanRpcUrl,
                            assetPairs,
                            contractAddresses,
                        });
                        const result = validateCustomizationConfig(config);

                        expect(result.valid).toBe(true);
                        expect(result.errors).toEqual([]);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ── Invalid configurations ────────────────────────────────────────────────

    describe('invalid configurations always fail with specific errors', () => {
        it('fails with HORIZON_NETWORK_MISMATCH when network and horizon URL are mismatched', () => {
            fc.assert(
                fc.property(
                    arbValidBaseConfig,
                    arbNetwork,
                    arbAssetPairs,
                    arbContractAddresses,
                    (base, network, assetPairs, contractAddresses) => {
                        const wrongHorizonUrl =
                            network === 'mainnet' ? TESTNET_HORIZON : MAINNET_HORIZON;
                        const config: CustomizationConfig = {
                            ...base,
                            stellar: {
                                network,
                                horizonUrl: wrongHorizonUrl,
                                assetPairs,
                                contractAddresses,
                            },
                        };
                        const result = validateCustomizationConfig(config);

                        // Invariant: mismatch always fails with exactly one HORIZON_NETWORK_MISMATCH
                        expect(result.valid).toBe(false);
                        const mismatchErrors = result.errors.filter(
                            (e) => e.code === 'HORIZON_NETWORK_MISMATCH'
                        );
                        expect(mismatchErrors).toHaveLength(1);
                        expect(mismatchErrors[0].field).toBe('stellar.horizonUrl');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('fails with stellar.horizonUrl error when horizon URL is not a valid URL', () => {
            fc.assert(
                fc.property(
                    arbValidBaseConfig,
                    arbNetwork,
                    // Generate strings that are definitely not URLs
                    fc.string().filter((s) => !s.startsWith('http')),
                    (base, network, invalidHorizon) => {
                        const config = {
                            ...base,
                            stellar: {
                                network,
                                horizonUrl: invalidHorizon,
                            },
                        } as CustomizationConfig;
                        const result = validateCustomizationConfig(config);

                        // Invariant: non-URL horizon always fails schema validation
                        expect(result.valid).toBe(false);
                        const urlErrors = result.errors.filter(
                            (e) => e.field === 'stellar.horizonUrl'
                        );
                        expect(urlErrors.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('fails with stellar.sorobanRpcUrl error when soroban RPC URL is not a valid URL', () => {
            fc.assert(
                fc.property(
                    arbValidBaseConfig,
                    arbNetwork,
                    fc.string().filter((s) => !s.startsWith('http')),
                    (base, network, invalidRpc) => {
                        const config = {
                            ...base,
                            stellar: {
                                network,
                                horizonUrl:
                                    network === 'mainnet' ? MAINNET_HORIZON : TESTNET_HORIZON,
                                sorobanRpcUrl: invalidRpc,
                            },
                        } as CustomizationConfig;
                        const result = validateCustomizationConfig(config);

                        // Invariant: non-URL soroban RPC always fails schema validation
                        expect(result.valid).toBe(false);
                        const rpcErrors = result.errors.filter(
                            (e) => e.field === 'stellar.sorobanRpcUrl'
                        );
                        expect(rpcErrors.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('fails with stellar.network error for any non-enum network value', () => {
            fc.assert(
                fc.property(
                    arbValidBaseConfig,
                    // Generate strings that are not 'mainnet' or 'testnet'
                    fc.string().filter((s) => s !== 'mainnet' && s !== 'testnet'),
                    (base, invalidNetwork) => {
                        const config = {
                            ...base,
                            stellar: {
                                network: invalidNetwork,
                                horizonUrl: MAINNET_HORIZON,
                            },
                        } as unknown as CustomizationConfig;
                        const result = validateCustomizationConfig(config);

                        // Invariant: invalid network enum always fails
                        expect(result.valid).toBe(false);
                        const networkErrors = result.errors.filter(
                            (e) => e.field === 'stellar.network'
                        );
                        expect(networkErrors.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ── Structural invariants ─────────────────────────────────────────────────

    describe('structural invariants', () => {
        it('result.valid and result.errors are always consistent', () => {
            // Generate both valid and invalid configs to exercise both branches
            const arbConfig = fc.oneof(
                // Valid path
                fc.tuple(arbValidBaseConfig, arbNetwork).map(([base, network]) =>
                    makeValidConfig(base, network)
                ),
                // Invalid path: mismatched horizon
                fc.tuple(arbValidBaseConfig, arbNetwork).map(([base, network]) => ({
                    ...base,
                    stellar: {
                        network,
                        horizonUrl: network === 'mainnet' ? TESTNET_HORIZON : MAINNET_HORIZON,
                    },
                }))
            );

            fc.assert(
                fc.property(arbConfig, (config) => {
                    const result = validateCustomizationConfig(config);

                    // Invariant: valid=true iff errors is empty; valid=false iff errors is non-empty
                    if (result.valid) {
                        expect(result.errors).toEqual([]);
                    } else {
                        expect(result.errors.length).toBeGreaterThan(0);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('every error always has field, message, and code', () => {
            fc.assert(
                fc.property(arbValidBaseConfig, arbNetwork, (base, network) => {
                    // Force a mismatch to always get errors
                    const config: CustomizationConfig = {
                        ...base,
                        stellar: {
                            network,
                            horizonUrl: network === 'mainnet' ? TESTNET_HORIZON : MAINNET_HORIZON,
                        },
                    };
                    const result = validateCustomizationConfig(config);

                    for (const error of result.errors) {
                        expect(typeof error.field).toBe('string');
                        expect(error.field.length).toBeGreaterThan(0);
                        expect(typeof error.message).toBe('string');
                        expect(error.message.length).toBeGreaterThan(0);
                        expect(typeof error.code).toBe('string');
                        expect(error.code.length).toBeGreaterThan(0);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('asset pairs and contract addresses do not affect network mismatch detection', () => {
            fc.assert(
                fc.property(
                    arbValidBaseConfig,
                    arbNetwork,
                    arbAssetPairs,
                    arbContractAddresses,
                    (base, network, assetPairs, contractAddresses) => {
                        const wrongHorizonUrl =
                            network === 'mainnet' ? TESTNET_HORIZON : MAINNET_HORIZON;
                        const config: CustomizationConfig = {
                            ...base,
                            stellar: {
                                network,
                                horizonUrl: wrongHorizonUrl,
                                assetPairs,
                                contractAddresses,
                            },
                        };
                        const result = validateCustomizationConfig(config);

                        // Invariant: mismatch is detected regardless of asset pairs / contracts
                        expect(result.valid).toBe(false);
                        expect(
                            result.errors.some((e) => e.code === 'HORIZON_NETWORK_MISMATCH')
                        ).toBe(true);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
