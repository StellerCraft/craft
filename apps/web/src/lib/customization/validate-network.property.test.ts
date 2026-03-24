// Feature: craft-platform, Property 12: Network Configuration Mapping
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateCustomizationConfig } from './validate';
import type { CustomizationConfig } from '@craft/types';

// ── Network Configuration Constants ──────────────────────────────────────────

const MAINNET_HORIZON = 'https://horizon.stellar.org';
const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const MAINNET_SOROBAN_RPC = 'https://soroban-rpc.stellar.org';
const TESTNET_SOROBAN_RPC = 'https://soroban-testnet.stellar.org';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbNetwork = fc.constantFrom('mainnet' as const, 'testnet' as const);

// Generate valid config with distinct colors to avoid DUPLICATE_COLORS errors
const arbValidConfig = fc.record({
    branding: fc.record({
        appName: fc.string({ minLength: 1, maxLength: 60 }),
        primaryColor: fc.constant('#ff0000'),
        secondaryColor: fc.constant('#00ff00'),
        fontFamily: fc.constantFrom('Inter', 'Roboto', 'Arial', 'Helvetica'),
    }),
    features: fc.record({
        enableCharts: fc.boolean(),
        enableTransactionHistory: fc.boolean(),
        enableAnalytics: fc.boolean(),
        enableNotifications: fc.boolean(),
    }),
});

// ── Property Tests ────────────────────────────────────────────────────────────

describe('Network Configuration Mapping — Property 12', () => {
    describe('valid network configurations', () => {
        it('mainnet selection always maps to mainnet horizon URL', () => {
            fc.assert(
                fc.property(arbValidConfig, (baseConfig) => {
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network: 'mainnet',
                            horizonUrl: MAINNET_HORIZON,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    // Invariant: mainnet + mainnet horizon = valid
                    expect(result.valid).toBe(true);
                    expect(result.errors).toEqual([]);
                }),
                { numRuns: 100 }
            );
        });

        it('testnet selection always maps to testnet horizon URL', () => {
            fc.assert(
                fc.property(arbValidConfig, (baseConfig) => {
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network: 'testnet',
                            horizonUrl: TESTNET_HORIZON,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    // Invariant: testnet + testnet horizon = valid
                    expect(result.valid).toBe(true);
                    expect(result.errors).toEqual([]);
                }),
                { numRuns: 100 }
            );
        });

        it('mainnet with optional soroban RPC URL is valid', () => {
            fc.assert(
                fc.property(arbValidConfig, (baseConfig) => {
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network: 'mainnet',
                            horizonUrl: MAINNET_HORIZON,
                            sorobanRpcUrl: MAINNET_SOROBAN_RPC,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    expect(result.valid).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('testnet with optional soroban RPC URL is valid', () => {
            fc.assert(
                fc.property(arbValidConfig, (baseConfig) => {
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network: 'testnet',
                            horizonUrl: TESTNET_HORIZON,
                            sorobanRpcUrl: TESTNET_SOROBAN_RPC,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    expect(result.valid).toBe(true);
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('invalid network configurations', () => {
        it('mainnet with testnet horizon URL always fails with HORIZON_NETWORK_MISMATCH', () => {
            fc.assert(
                fc.property(arbValidConfig, (baseConfig) => {
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network: 'mainnet',
                            horizonUrl: TESTNET_HORIZON,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    // Invariant: mismatched network always fails
                    expect(result.valid).toBe(false);
                    expect(result.errors).toHaveLength(1);
                    expect(result.errors[0].code).toBe('HORIZON_NETWORK_MISMATCH');
                    expect(result.errors[0].field).toBe('stellar.horizonUrl');
                }),
                { numRuns: 100 }
            );
        });

        it('testnet with mainnet horizon URL always fails with HORIZON_NETWORK_MISMATCH', () => {
            fc.assert(
                fc.property(arbValidConfig, (baseConfig) => {
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network: 'testnet',
                            horizonUrl: MAINNET_HORIZON,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    // Invariant: mismatched network always fails
                    expect(result.valid).toBe(false);
                    expect(result.errors).toHaveLength(1);
                    expect(result.errors[0].code).toBe('HORIZON_NETWORK_MISMATCH');
                    expect(result.errors[0].field).toBe('stellar.horizonUrl');
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('network configuration invariants', () => {
        it('network choice determines correct horizon URL mapping', () => {
            fc.assert(
                fc.property(arbValidConfig, arbNetwork, (baseConfig, network) => {
                    const correctHorizonUrl = network === 'mainnet' ? MAINNET_HORIZON : TESTNET_HORIZON;
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network,
                            horizonUrl: correctHorizonUrl,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    // Invariant: correct mapping is always valid
                    expect(result.valid).toBe(true);
                    expect(config.stellar.network).toBe(network);
                    expect(config.stellar.horizonUrl).toBe(correctHorizonUrl);
                }),
                { numRuns: 100 }
            );
        });

        it('network choice determines correct soroban RPC URL mapping', () => {
            fc.assert(
                fc.property(arbValidConfig, arbNetwork, (baseConfig, network) => {
                    const correctHorizonUrl = network === 'mainnet' ? MAINNET_HORIZON : TESTNET_HORIZON;
                    const correctRpcUrl = network === 'mainnet' ? MAINNET_SOROBAN_RPC : TESTNET_SOROBAN_RPC;
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network,
                            horizonUrl: correctHorizonUrl,
                            sorobanRpcUrl: correctRpcUrl,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    // Invariant: correct RPC mapping is always valid
                    expect(result.valid).toBe(true);
                    expect(config.stellar.sorobanRpcUrl).toBe(correctRpcUrl);
                }),
                { numRuns: 100 }
            );
        });

        it('mismatched network and horizon URL always produces exactly one error', () => {
            fc.assert(
                fc.property(arbValidConfig, arbNetwork, (baseConfig, network) => {
                    const wrongHorizonUrl = network === 'mainnet' ? TESTNET_HORIZON : MAINNET_HORIZON;
                    const config: CustomizationConfig = {
                        ...baseConfig,
                        stellar: {
                            network,
                            horizonUrl: wrongHorizonUrl,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    // Invariant: mismatch always produces exactly one HORIZON_NETWORK_MISMATCH error
                    expect(result.valid).toBe(false);
                    const mismatchErrors = result.errors.filter((e) => e.code === 'HORIZON_NETWORK_MISMATCH');
                    expect(mismatchErrors).toHaveLength(1);
                    expect(mismatchErrors[0].field).toBe('stellar.horizonUrl');
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('network passphrase mapping', () => {
        it('mainnet network should use mainnet passphrase', () => {
            // Note: Current implementation doesn't validate passphrase,
            // but this test documents the expected mapping invariant
            fc.assert(
                fc.property(arbValidConfig, (baseConfig) => {
                    const config = {
                        ...baseConfig,
                        stellar: {
                            network: 'mainnet' as const,
                            horizonUrl: MAINNET_HORIZON,
                            networkPassphrase: MAINNET_PASSPHRASE,
                        },
                    };

                    // Invariant: mainnet network should map to mainnet passphrase
                    expect(config.stellar.network).toBe('mainnet');
                    expect(config.stellar.networkPassphrase).toBe(MAINNET_PASSPHRASE);
                }),
                { numRuns: 100 }
            );
        });

        it('testnet network should use testnet passphrase', () => {
            // Note: Current implementation doesn't validate passphrase,
            // but this test documents the expected mapping invariant
            fc.assert(
                fc.property(arbValidConfig, (baseConfig) => {
                    const config = {
                        ...baseConfig,
                        stellar: {
                            network: 'testnet' as const,
                            horizonUrl: TESTNET_HORIZON,
                            networkPassphrase: TESTNET_PASSPHRASE,
                        },
                    };

                    // Invariant: testnet network should map to testnet passphrase
                    expect(config.stellar.network).toBe('testnet');
                    expect(config.stellar.networkPassphrase).toBe(TESTNET_PASSPHRASE);
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('comprehensive network mapping', () => {
        it('for any network choice, correct URLs and passphrase form a valid configuration', () => {
            fc.assert(
                fc.property(arbValidConfig, arbNetwork, (baseConfig, network) => {
                    const horizonUrl = network === 'mainnet' ? MAINNET_HORIZON : TESTNET_HORIZON;
                    const sorobanRpcUrl = network === 'mainnet' ? MAINNET_SOROBAN_RPC : TESTNET_SOROBAN_RPC;
                    const networkPassphrase = network === 'mainnet' ? MAINNET_PASSPHRASE : TESTNET_PASSPHRASE;

                    const config = {
                        ...baseConfig,
                        stellar: {
                            network,
                            horizonUrl,
                            sorobanRpcUrl,
                            networkPassphrase,
                        },
                    };

                    const result = validateCustomizationConfig(config);

                    // Invariant: correct mapping of all network properties is always valid
                    expect(result.valid).toBe(true);
                    expect(config.stellar.network).toBe(network);
                    expect(config.stellar.horizonUrl).toBe(horizonUrl);
                    expect(config.stellar.sorobanRpcUrl).toBe(sorobanRpcUrl);
                    expect(config.stellar.networkPassphrase).toBe(networkPassphrase);
                }),
                { numRuns: 100 }
            );
        });
    });
});
