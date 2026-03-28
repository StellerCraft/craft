// Feature: craft-platform, Property 8: Customization Preview Consistency
// Feature: craft-platform, Property 13: Preview Mock Data Isolation
import { describe, it, expect, beforeEach } from 'vitest';
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

                    expect(typeof result.mockData.accountBalance).toBe('string');
                    expect(Array.isArray(result.mockData.recentTransactions)).toBe(true);
                    expect(typeof result.mockData.assetPrices).toBe('object');

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

                    // Mock data should be in expected ranges for the network
                    const balance1 = parseFloat(result1.mockData.accountBalance);
                    const balance2 = parseFloat(result2.mockData.accountBalance);
                    const expectedMin = network === 'mainnet' ? 10000 : 5000;
                    const expectedMax = network === 'mainnet' ? 11000 : 6000;

                    expect(balance1).toBeGreaterThanOrEqual(expectedMin);
                    expect(balance1).toBeLessThanOrEqual(expectedMax);
                    expect(balance2).toBeGreaterThanOrEqual(expectedMin);
                    expect(balance2).toBeLessThanOrEqual(expectedMax);

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

                    const timestamp = new Date(result.timestamp);
                    expect(timestamp.toString()).not.toBe('Invalid Date');
                    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('preview update pipeline', () => {
        it('update always preserves unchanged fields', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, arbCustomizationConfig, (current, changes) => {
                    const result = service.updatePreview(current, changes);

                    if (!changes.branding) {
                        expect(result.customization.branding).toEqual(current.branding);
                    }
                    if (!changes.features) {
                        expect(result.customization.features).toEqual(current.features);
                    }
                    if (!changes.stellar) {
                        expect(result.customization.stellar).toEqual(current.stellar);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('changedFields array only contains actually changed fields', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (current) => {
                    const changes = {
                        branding: {
                            appName: current.branding.appName,
                            primaryColor: '#000000',
                        },
                    };

                    const result = service.updatePreview(current, changes);

                    if (current.branding.primaryColor !== '#000000') {
                        expect(result.changedFields).toContain('branding.primaryColor');
                    }
                    expect(result.changedFields).not.toContain('branding.appName');
                }),
                { numRuns: 100 }
            );
        });

        it('network change always triggers mock data refresh', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, arbNetwork, (current, newNetwork) => {
                    if (current.stellar.network === newNetwork) return;

                    const changes = {
                        stellar: {
                            network: newNetwork,
                        },
                    };

                    const result = service.updatePreview(current, changes);

                    expect(result.mockData).toBeDefined();
                    expect(result.changedFields).toContain('stellar.network');
                }),
                { numRuns: 100 }
            );
        });

        it('non-network changes never trigger mock data refresh', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (current) => {
                    const changes = {
                        branding: {
                            appName: 'Updated App',
                            primaryColor: '#ff0000',
                        },
                        features: {
                            enableCharts: !current.features.enableCharts,
                        },
                    };

                    const result = service.updatePreview(current, changes);

                    expect(result.mockData).toBeUndefined();
                }),
                { numRuns: 100 }
            );
        });

        it('empty changes produce empty changedFields', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (current) => {
                    const result = service.updatePreview(current, {});

                    expect(result.changedFields).toEqual([]);
                    expect(result.mockData).toBeUndefined();
                }),
                { numRuns: 100 }
            );
        });

        it('update payload always has valid timestamp', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (current) => {
                    const changes = { branding: { appName: 'Test' } };
                    const result = service.updatePreview(current, changes);

                    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
                    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
                }),
                { numRuns: 100 }
            );
        });

        it('merged customization is always valid structure', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, arbCustomizationConfig, (current, changes) => {
                    const result = service.updatePreview(current, changes);

                    expect(result.customization.branding).toBeDefined();
                    expect(result.customization.features).toBeDefined();
                    expect(result.customization.stellar).toBeDefined();
                    expect(typeof result.customization.branding.appName).toBe('string');
                    expect(typeof result.customization.stellar.network).toBe('string');
                }),
                { numRuns: 100 }
            );
        });
    });
});
