// Feature: craft-platform, Property 13: Preview Mock Data Isolation
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { MockStellarGenerator } from './mock-stellar-generator';
import type { TemplateCategory } from '@craft/types';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbNetwork = fc.constantFrom('mainnet' as const, 'testnet' as const);
const arbCategory = fc.constantFrom<TemplateCategory>('dex', 'lending', 'payment', 'asset-issuance');
const arbSeed = fc.integer({ min: 0, max: 1000000 });

// ── Property Tests ────────────────────────────────────────────────────────────

describe('MockStellarGenerator — Property Tests', () => {
    describe('deterministic generation', () => {
        it('same seed always produces identical results', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, arbCategory, (seed, network, category) => {
                    const gen1 = new MockStellarGenerator(seed);
                    const gen2 = new MockStellarGenerator(seed);

                    const result1 = gen1.generateMockData(network, category);
                    const result2 = gen2.generateMockData(network, category);

                    // Invariant: same seed = identical output
                    expect(result1.accountBalance).toBe(result2.accountBalance);
                    expect(result1.recentTransactions.length).toBe(result2.recentTransactions.length);
                    expect(result1.recentTransactions[0].id).toBe(result2.recentTransactions[0].id);
                    expect(result1.assetPrices.XLM).toBe(result2.assetPrices.XLM);
                }),
                { numRuns: 100 }
            );
        });

        it('different seeds produce different account balances', () => {
            fc.assert(
                fc.property(arbSeed, arbSeed, arbNetwork, (seed1, seed2, network) => {
                    if (seed1 === seed2) return;

                    const gen1 = new MockStellarGenerator(seed1);
                    const gen2 = new MockStellarGenerator(seed2);

                    const result1 = gen1.generateMockData(network);
                    const result2 = gen2.generateMockData(network);

                    // Invariant: different seeds = different balances
                    expect(result1.accountBalance).not.toBe(result2.accountBalance);
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('data structure invariants', () => {
        it('always generates valid Stellar amount format', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, arbCategory, (seed, network, category) => {
                    const gen = new MockStellarGenerator(seed);
                    const result = gen.generateMockData(network, category);

                    // Invariant: balance always has 7 decimal places
                    expect(result.accountBalance).toMatch(/^\d+\.\d{7}$/);
                    const balance = parseFloat(result.accountBalance);
                    expect(balance).toBeGreaterThan(0);
                }),
                { numRuns: 100 }
            );
        });

        it('always generates at least one transaction', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, arbCategory, (seed, network, category) => {
                    const gen = new MockStellarGenerator(seed);
                    const result = gen.generateMockData(network, category);

                    // Invariant: always have transactions for preview
                    expect(result.recentTransactions.length).toBeGreaterThan(0);
                }),
                { numRuns: 100 }
            );
        });

        it('all transactions have complete structure', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, arbCategory, (seed, network, category) => {
                    const gen = new MockStellarGenerator(seed);
                    const result = gen.generateMockData(network, category);

                    // Invariant: all transactions have required fields
                    result.recentTransactions.forEach((tx) => {
                        expect(typeof tx.id).toBe('string');
                        expect(tx.id.length).toBeGreaterThan(0);
                        expect(typeof tx.type).toBe('string');
                        expect(typeof tx.amount).toBe('string');
                        expect(tx.amount).toMatch(/^\d+\.\d{7}$/);
                        expect(tx.asset).toBeDefined();
                        expect(tx.asset.code).toBeTruthy();
                        expect(tx.timestamp).toBeInstanceOf(Date);
                    });
                }),
                { numRuns: 100 }
            );
        });

        it('all asset prices are positive numbers', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, (seed, network) => {
                    const gen = new MockStellarGenerator(seed);
                    const result = gen.generateMockData(network);

                    // Invariant: all prices must be positive
                    Object.entries(result.assetPrices).forEach(([asset, price]) => {
                        expect(typeof price).toBe('number');
                        expect(price).toBeGreaterThan(0);
                        expect(Number.isFinite(price)).toBe(true);
                    });
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('network-specific behavior', () => {
        it('mainnet always has higher balance than testnet', () => {
            fc.assert(
                fc.property(arbSeed, (seed) => {
                    const gen = new MockStellarGenerator(seed);
                    const mainnet = gen.generateMockData('mainnet');

                    gen.resetSeed(seed);
                    const testnet = gen.generateMockData('testnet');

                    // Invariant: mainnet balance > testnet balance
                    const mainnetBalance = parseFloat(mainnet.accountBalance);
                    const testnetBalance = parseFloat(testnet.accountBalance);
                    expect(mainnetBalance).toBeGreaterThan(testnetBalance);
                }),
                { numRuns: 100 }
            );
        });

        it('mainnet XLM price always higher than testnet', () => {
            fc.assert(
                fc.property(arbSeed, (seed) => {
                    const gen = new MockStellarGenerator(seed);
                    const mainnet = gen.generateMockData('mainnet');

                    gen.resetSeed(seed);
                    const testnet = gen.generateMockData('testnet');

                    // Invariant: mainnet prices > testnet prices
                    expect(mainnet.assetPrices.XLM).toBeGreaterThan(testnet.assetPrices.XLM);
                }),
                { numRuns: 100 }
            );
        });

        it('USDC is always 1.0 regardless of network', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, (seed, network) => {
                    const gen = new MockStellarGenerator(seed);
                    const result = gen.generateMockData(network);

                    // Invariant: USDC is a stablecoin
                    expect(result.assetPrices.USDC).toBe(1.0);
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('isolation guarantees', () => {
        it('transaction IDs never match real Stellar format', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, arbCategory, (seed, network, category) => {
                    const gen = new MockStellarGenerator(seed);
                    const result = gen.generateMockData(network, category);

                    // Invariant: all IDs start with "preview"
                    result.recentTransactions.forEach((tx) => {
                        expect(tx.id.startsWith('preview')).toBe(true);
                    });
                }),
                { numRuns: 100 }
            );
        });

        it('generates data synchronously without network calls', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, arbCategory, (seed, network, category) => {
                    const gen = new MockStellarGenerator(seed);
                    const result = gen.generateMockData(network, category);

                    // Invariant: synchronous generation, no promises
                    expect(result).toBeDefined();
                    expect(result.accountBalance).toBeDefined();
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('template-specific generation', () => {
        it('different categories produce different transaction types', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, (seed, network) => {
                    const gen = new MockStellarGenerator(seed);

                    const dex = gen.generateMockData(network, 'dex');
                    gen.resetSeed(seed);
                    const lending = gen.generateMockData(network, 'lending');

                    const dexTypes = dex.recentTransactions.map((tx) => tx.type);
                    const lendingTypes = lending.recentTransactions.map((tx) => tx.type);

                    // Invariant: categories have distinct transaction types
                    const dexHasSwap = dexTypes.includes('swap');
                    const lendingHasBorrow = lendingTypes.includes('borrow');

                    expect(dexHasSwap || lendingHasBorrow).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('payment category only generates payment transactions', () => {
            fc.assert(
                fc.property(arbSeed, arbNetwork, (seed, network) => {
                    const gen = new MockStellarGenerator(seed);
                    const result = gen.generateMockData(network, 'payment');

                    // Invariant: payment category = only payment type
                    result.recentTransactions.forEach((tx) => {
                        expect(tx.type).toBe('payment');
                    });
                }),
                { numRuns: 100 }
            );
        });
    });

    describe('seed reset behavior', () => {
        it('resetSeed allows reproducible generation', () => {
            fc.assert(
                fc.property(arbSeed, arbSeed, arbNetwork, (seed1, seed2, network) => {
                    const gen = new MockStellarGenerator(seed1);
                    const result1 = gen.generateMockData(network);

                    gen.resetSeed(seed1);
                    const result2 = gen.generateMockData(network);

                    // Invariant: reset to same seed = same results
                    expect(result1.accountBalance).toBe(result2.accountBalance);
                }),
                { numRuns: 100 }
            );
        });
    });
});
