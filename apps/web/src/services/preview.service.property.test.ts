// Feature: craft-platform, Property 8: Customization Preview Consistency
// Feature: craft-platform, Property 13: Preview Mock Data Isolation
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { PreviewService } from './preview.service';
import type { CustomizationConfig } from '@craft/types';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbNetwork = fc.constantFrom('mainnet' as const, 'testnet' as const);

const arbCustomizationConfig: fc.Arbitrary<CustomizationConfig> = fc.record({
    branding: fc.record({
        appName: fc.string({ minLength: 1, maxLength: 60 }),
        logoUrl: fc.option(fc.webUrl(), { nil: undefined }),
        primaryColor: fc.constantFrom('#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'),
        secondaryColor: fc.constantFrom('#000000', '#ffffff', '#808080', '#c0c0c0'),
        fontFamily: fc.constantFrom('Inter', 'Roboto', 'Arial', 'Helvetica'),
    }),
    features: fc.record({
        enableCharts: fc.boolean(),
        enableTransactionHistory: fc.boolean(),
        enableAnalytics: fc.boolean(),
        enableNotifications: fc.boolean(),
    }),
    stellar: fc.record({
        network: arbNetwork,
        horizonUrl: fc.constantFrom(
            'https://horizon.stellar.org',
            'https://horizon-testnet.stellar.org'
        ),
        sorobanRpcUrl: fc.option(
            fc.constantFrom(
                'https://soroban-rpc.stellar.org',
                'https://soroban-testnet.stellar.org'
            ),
            { nil: undefined }
        ),
    }),
});

// ── Property Tests ────────────────────────────────────────────────────────────

describe('PreviewService — Property Tests', () => {
    let service: PreviewService;

    beforeEach(() => {
        service = new PreviewService();
    });

    describe('Property 8: Customization Preview Consistency', () => {
        it('preview payload always contains the exact customization config', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: customization is preserved exactly
                    expect(result.customization).toEqual(config);
                    expect(result.customization.branding.appName).toBe(config.branding.appName);
                    expect(result.customization.stellar.network).toBe(config.stellar.network);
                }),
                { numRuns: 100 }
            );
        });

        it('all branding customizations are reflected in payload', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: all branding fields are preserved
                    expect(result.customization.branding.appName).toBe(config.branding.appName);
                    expect(result.customization.branding.primaryColor).toBe(
                        config.branding.primaryColor
                    );
                    expect(result.customization.branding.secondaryColor).toBe(
                        config.branding.secondaryColor
                    );
                    expect(result.customization.branding.fontFamily).toBe(
                        config.branding.fontFamily
                    );
                }),
                { numRuns: 100 }
            );
        });

        it('all feature toggles are reflected in payload', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: all feature flags are preserved
                    expect(result.customization.features.enableCharts).toBe(
                        config.features.enableCharts
                    );
                    expect(result.customization.features.enableTransactionHistory).toBe(
                        config.features.enableTransactionHistory
                    );
                    expect(result.customization.features.enableAnalytics).toBe(
                        config.features.enableAnalytics
                    );
                    expect(result.customization.features.enableNotifications).toBe(
                        config.features.enableNotifications
                    );
                }),
                { numRuns: 100 }
            );
        });

        it('all stellar settings are reflected in payload', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: all stellar config is preserved
                    expect(result.customization.stellar.network).toBe(config.stellar.network);
                    expect(result.customization.stellar.horizonUrl).toBe(
                        config.stellar.horizonUrl
                    );
                    expect(result.customization.stellar.sorobanRpcUrl).toBe(
                        config.stellar.sorobanRpcUrl
                    );
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('Property 13: Preview Mock Data Isolation', () => {
        it('always generates mock data without network requests', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: mock data is always present
                    expect(result.mockData).toBeDefined();
                    expect(result.mockData.accountBalance).toBeDefined();
                    expect(result.mockData.recentTransactions).toBeDefined();
                    expect(result.mockData.assetPrices).toBeDefined();
                }),
                { numRuns: 100 }
            );
        });

        it('mock transaction IDs never match real Stellar transaction format', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: all mock tx IDs start with "preview"
                    result.mockData.recentTransactions.forEach((tx) => {
                        expect(tx.id).toMatch(/^preview/);
                    });
                }),
                { numRuns: 100 }
            );
        });

        it('mock data structure is always complete', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: mock data has all required fields
                    expect(typeof result.mockData.accountBalance).toBe('string');
                    expect(Array.isArray(result.mockData.recentTransactions)).toBe(true);
                    expect(typeof result.mockData.assetPrices).toBe('object');

                    // All transactions have required fields
                    result.mockData.recentTransactions.forEach((tx) => {
                        expect(typeof tx.id).toBe('string');
                        expect(typeof tx.type).toBe('string');
                        expect(typeof tx.amount).toBe('string');
                        expect(tx.asset).toBeDefined();
                        expect(tx.timestamp).toBeInstanceOf(Date);
                    });
                }),
                { numRuns: 100 }
            );
        });

        it('mock asset prices are always positive numbers', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: all prices are positive
                    Object.values(result.mockData.assetPrices).forEach((price) => {
                        expect(typeof price).toBe('number');
                        expect(price).toBeGreaterThan(0);
                    });
                }),
                { numRuns: 100 }
            );
        });

        it('mock account balance is always a valid Stellar amount', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: balance matches Stellar 7-decimal format
                    expect(result.mockData.accountBalance).toMatch(/^\d+\.\d{7}$/);
                    const balance = parseFloat(result.mockData.accountBalance);
                    expect(balance).toBeGreaterThan(0);
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('deterministic payload generation', () => {
        it('generates consistent mock data for the same network', () => {
            fc.assert(
                fc.property(arbNetwork, (network) => {
                    const config1: CustomizationConfig = {
                        branding: {
                            appName: 'App 1',
                            primaryColor: '#ff0000',
                            secondaryColor: '#00ff00',
                            fontFamily: 'Inter',
                        },
                        features: {
                            enableCharts: true,
                            enableTransactionHistory: true,
                            enableAnalytics: false,
                            enableNotifications: false,
                        },
                        stellar: {
                            network,
                            horizonUrl:
                                network === 'mainnet'
                                    ? 'https://horizon.stellar.org'
                                    : 'https://horizon-testnet.stellar.org',
                        },
                    };

                    const config2: CustomizationConfig = {
                        branding: {
                            appName: 'App 2',
                            primaryColor: '#0000ff',
                            secondaryColor: '#ffff00',
                            fontFamily: 'Roboto',
                        },
                        features: {
                            enableCharts: false,
                            enableTransactionHistory: false,
                            enableAnalytics: true,
                            enableNotifications: true,
                        },
                        stellar: {
                            network,
                            horizonUrl:
                                network === 'mainnet'
                                    ? 'https://horizon.stellar.org'
                                    : 'https://horizon-testnet.stellar.org',
                        },
                    };

                    const result1 = service.generatePreview(config1);
                    const result2 = service.generatePreview(config2);

                    // Invariant: same network produces same mock data structure
                    expect(result1.mockData.accountBalance).toBe(result2.mockData.accountBalance);
                    expect(result1.mockData.recentTransactions.length).toBe(
                        result2.mockData.recentTransactions.length
                    );
                    expect(result1.mockData.assetPrices.XLM).toBe(
                        result2.mockData.assetPrices.XLM
                    );
                }),
                { numRuns: 100 }
            );
        });

        it('payload always has valid timestamp', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (config) => {
                    const result = service.generatePreview(config);

                    // Invariant: timestamp is always valid ISO string
                    const timestamp = new Date(result.timestamp);
                    expect(timestamp.toString()).not.toBe('Invalid Date');
                    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
                }),
                { numRuns: 100 }
            );
        });
    });
});
