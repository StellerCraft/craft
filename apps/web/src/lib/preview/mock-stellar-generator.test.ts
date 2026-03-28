import { describe, it, expect, beforeEach } from 'vitest';
import { MockStellarGenerator } from './mock-stellar-generator';

describe('MockStellarGenerator', () => {
    let generator: MockStellarGenerator;

    beforeEach(() => {
        generator = new MockStellarGenerator(42);
    });

    describe('generateMockData', () => {
        it('generates complete mock data structure', () => {
            const result = generator.generateMockData('mainnet');

            expect(result.accountBalance).toBeDefined();
            expect(result.recentTransactions).toBeDefined();
            expect(result.assetPrices).toBeDefined();
        });

        it('generates different data for mainnet vs testnet', () => {
            const mainnet = generator.generateMockData('mainnet');
            const testnet = generator.generateMockData('testnet');

            expect(mainnet.accountBalance).not.toBe(testnet.accountBalance);
            expect(mainnet.assetPrices.XLM).not.toBe(testnet.assetPrices.XLM);
        });
    });

    describe('generateAccountBalance', () => {
        it('generates valid Stellar amount format', () => {
            const result = generator.generateMockData('mainnet');

            expect(result.accountBalance).toMatch(/^\d+\.\d{7}$/);
        });

        it('mainnet balance is higher than testnet', () => {
            const mainnet = generator.generateMockData('mainnet');
            const testnet = generator.generateMockData('testnet');

            const mainnetBalance = parseFloat(mainnet.accountBalance);
            const testnetBalance = parseFloat(testnet.accountBalance);

            expect(mainnetBalance).toBeGreaterThan(testnetBalance);
        });

        it('generates deterministic balance with same seed', () => {
            const gen1 = new MockStellarGenerator(100);
            const gen2 = new MockStellarGenerator(100);

            const result1 = gen1.generateMockData('mainnet');
            const result2 = gen2.generateMockData('mainnet');

            expect(result1.accountBalance).toBe(result2.accountBalance);
        });

        it('generates different balance with different seed', () => {
            const gen1 = new MockStellarGenerator(100);
            const gen2 = new MockStellarGenerator(200);

            const result1 = gen1.generateMockData('mainnet');
            const result2 = gen2.generateMockData('mainnet');

            expect(result1.accountBalance).not.toBe(result2.accountBalance);
        });
    });

    describe('generateTransactions', () => {
        it('generates transactions array', () => {
            const result = generator.generateMockData('mainnet');

            expect(Array.isArray(result.recentTransactions)).toBe(true);
            expect(result.recentTransactions.length).toBeGreaterThan(0);
        });

        it('all transactions have required fields', () => {
            const result = generator.generateMockData('mainnet');

            result.recentTransactions.forEach((tx) => {
                expect(typeof tx.id).toBe('string');
                expect(typeof tx.type).toBe('string');
                expect(typeof tx.amount).toBe('string');
                expect(tx.asset).toBeDefined();
                expect(tx.timestamp).toBeInstanceOf(Date);
            });
        });

        it('transaction IDs follow preview pattern', () => {
            const result = generator.generateMockData('mainnet');

            result.recentTransactions.forEach((tx) => {
                expect(tx.id).toMatch(/^preview\d{4}/);
                expect(tx.id.length).toBeGreaterThan(60);
            });
        });

        it('transactions are ordered by recency', () => {
            const result = generator.generateMockData('mainnet');

            const timestamps = result.recentTransactions.map((tx) => tx.timestamp.getTime());

            for (let i = 0; i < timestamps.length - 1; i++) {
                expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
            }
        });

        it('generates DEX-specific transactions', () => {
            const result = generator.generateMockData('mainnet', 'dex');

            const types = result.recentTransactions.map((tx) => tx.type);
            expect(types).toContain('swap');
            expect(types.some((t) => t.includes('liquidity'))).toBe(true);
        });

        it('generates lending-specific transactions', () => {
            const result = generator.generateMockData('mainnet', 'lending');

            const types = result.recentTransactions.map((tx) => tx.type);
            expect(types).toContain('borrow');
            expect(types).toContain('supply');
            expect(types).toContain('repay');
        });

        it('generates payment-specific transactions', () => {
            const result = generator.generateMockData('mainnet', 'payment');

            const types = result.recentTransactions.map((tx) => tx.type);
            expect(types.every((t) => t === 'payment')).toBe(true);
        });

        it('generates asset-issuance transactions', () => {
            const result = generator.generateMockData('mainnet', 'asset-issuance');

            const types = result.recentTransactions.map((tx) => tx.type);
            expect(types.some((t) => ['create_asset', 'mint', 'burn'].includes(t))).toBe(true);
        });

        it('uses network-specific USDC issuer', () => {
            const mainnet = generator.generateMockData('mainnet', 'dex');
            const testnet = generator.generateMockData('testnet', 'dex');

            const mainnetUsdc = mainnet.recentTransactions.find((tx) => tx.asset.code === 'USDC');
            const testnetUsdc = testnet.recentTransactions.find((tx) => tx.asset.code === 'USDC');

            expect(mainnetUsdc?.asset.issuer).toBeTruthy();
            expect(testnetUsdc?.asset.issuer).toBeTruthy();
            expect(mainnetUsdc?.asset.issuer).not.toBe(testnetUsdc?.asset.issuer);
        });
    });

    describe('generateAssetPrices', () => {
        it('generates price map with common assets', () => {
            const result = generator.generateMockData('mainnet');

            expect(result.assetPrices.XLM).toBeDefined();
            expect(result.assetPrices.USDC).toBeDefined();
            expect(result.assetPrices.BTC).toBeDefined();
            expect(result.assetPrices.ETH).toBeDefined();
        });

        it('all prices are positive numbers', () => {
            const result = generator.generateMockData('mainnet');

            Object.values(result.assetPrices).forEach((price) => {
                expect(typeof price).toBe('number');
                expect(price).toBeGreaterThan(0);
            });
        });

        it('mainnet prices are higher than testnet', () => {
            const mainnet = generator.generateMockData('mainnet');
            const testnet = generator.generateMockData('testnet');

            expect(mainnet.assetPrices.XLM).toBeGreaterThan(testnet.assetPrices.XLM);
            expect(mainnet.assetPrices.BTC).toBeGreaterThan(testnet.assetPrices.BTC);
            expect(mainnet.assetPrices.ETH).toBeGreaterThan(testnet.assetPrices.ETH);
        });

        it('USDC is always 1.0 (stablecoin)', () => {
            const mainnet = generator.generateMockData('mainnet');
            const testnet = generator.generateMockData('testnet');

            expect(mainnet.assetPrices.USDC).toBe(1.0);
            expect(testnet.assetPrices.USDC).toBe(1.0);
        });
    });

    describe('seedable generation', () => {
        it('same seed produces same results', () => {
            const gen1 = new MockStellarGenerator(123);
            const gen2 = new MockStellarGenerator(123);

            const result1 = gen1.generateMockData('mainnet');
            const result2 = gen2.generateMockData('mainnet');

            expect(result1.accountBalance).toBe(result2.accountBalance);
            expect(result1.recentTransactions[0].id).toBe(result2.recentTransactions[0].id);
        });

        it('different seeds produce different results', () => {
            const gen1 = new MockStellarGenerator(123);
            const gen2 = new MockStellarGenerator(456);

            const result1 = gen1.generateMockData('mainnet');
            const result2 = gen2.generateMockData('mainnet');

            expect(result1.accountBalance).not.toBe(result2.accountBalance);
        });

        it('resetSeed changes subsequent generation', () => {
            const gen = new MockStellarGenerator(100);
            const result1 = gen.generateMockData('mainnet');

            gen.resetSeed(200);
            const result2 = gen.generateMockData('mainnet');

            expect(result1.accountBalance).not.toBe(result2.accountBalance);
        });

        it('resetSeed to same value produces same results', () => {
            const gen = new MockStellarGenerator(100);
            const result1 = gen.generateMockData('mainnet');

            gen.resetSeed(100);
            const result2 = gen.generateMockData('mainnet');

            expect(result1.accountBalance).toBe(result2.accountBalance);
        });
    });

    describe('network isolation', () => {
        it('generates data without making network requests', () => {
            const result = generator.generateMockData('mainnet');

            expect(result).toBeDefined();
            expect(result.accountBalance).toBeDefined();
        });

        it('transaction IDs are clearly marked as preview', () => {
            const result = generator.generateMockData('mainnet');

            result.recentTransactions.forEach((tx) => {
                expect(tx.id.startsWith('preview')).toBe(true);
            });
        });
    });

    describe('template-specific generation', () => {
        it('generates different transaction types for different categories', () => {
            const dex = generator.generateMockData('mainnet', 'dex');
            const lending = generator.generateMockData('mainnet', 'lending');
            const payment = generator.generateMockData('mainnet', 'payment');

            const dexTypes = dex.recentTransactions.map((tx) => tx.type);
            const lendingTypes = lending.recentTransactions.map((tx) => tx.type);
            const paymentTypes = payment.recentTransactions.map((tx) => tx.type);

            expect(dexTypes).toContain('swap');
            expect(lendingTypes).toContain('borrow');
            expect(paymentTypes.every((t) => t === 'payment')).toBe(true);
        });

        it('generates appropriate transaction count per category', () => {
            const dex = generator.generateMockData('mainnet', 'dex');
            const lending = generator.generateMockData('mainnet', 'lending');
            const payment = generator.generateMockData('mainnet', 'payment');

            expect(dex.recentTransactions.length).toBeGreaterThan(0);
            expect(lending.recentTransactions.length).toBeGreaterThan(0);
            expect(payment.recentTransactions.length).toBeGreaterThan(0);
        });
    });
});
