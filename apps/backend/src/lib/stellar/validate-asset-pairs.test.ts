/**
 * Stellar Asset Pair Validation Tests
 *
 * Tests for validateAssetPairs() and its integration with
 * validateCustomizationConfig().
 *
 * Issue: #51
 */

import { describe, it, expect } from 'vitest';
import { validateAssetPairs } from '@/lib/stellar/validate-asset-pairs';
import { validateCustomizationConfig } from '@/lib/customization/validate';
import type { AssetPair, StellarAsset } from '@craft/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const VALID_ISSUER_2 = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';

const xlm: StellarAsset = { type: 'native', code: 'XLM', issuer: '' };
const usdc: StellarAsset = { type: 'credit_alphanum4', code: 'USDC', issuer: VALID_ISSUER };
const btc: StellarAsset = { type: 'credit_alphanum4', code: 'BTC', issuer: VALID_ISSUER_2 };
const longCode: StellarAsset = { type: 'credit_alphanum12', code: 'LONGTOKEN12', issuer: VALID_ISSUER };

const validPair: AssetPair = { base: xlm, counter: usdc };
const validPair2: AssetPair = { base: usdc, counter: btc };

// Base valid config for integration tests
const baseConfig = {
    branding: {
        appName: 'My DEX',
        primaryColor: '#6366f1',
        secondaryColor: '#a5b4fc',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: false,
        enableAnalytics: false,
        enableNotifications: false,
    },
    stellar: {
        network: 'testnet' as const,
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

// ── validateAssetPairs unit tests ─────────────────────────────────────────────

describe('validateAssetPairs', () => {
    // ── No-op cases ────────────────────────────────────────────────────────────

    it('returns no errors for undefined (optional field)', () => {
        expect(validateAssetPairs(undefined)).toEqual([]);
    });

    it('returns no errors for null', () => {
        expect(validateAssetPairs(null)).toEqual([]);
    });

    it('returns no errors for an empty array', () => {
        expect(validateAssetPairs([])).toEqual([]);
    });

    it('returns no errors for a single valid pair', () => {
        expect(validateAssetPairs([validPair])).toEqual([]);
    });

    it('returns no errors for multiple distinct valid pairs', () => {
        expect(validateAssetPairs([validPair, validPair2])).toEqual([]);
    });

    // ── Non-array input ────────────────────────────────────────────────────────

    it('returns ASSET_PAIRS_NOT_ARRAY for a non-array value', () => {
        const errors = validateAssetPairs('not-an-array');
        expect(errors).toHaveLength(1);
        expect(errors[0].code).toBe('ASSET_PAIRS_NOT_ARRAY');
        expect(errors[0].field).toBe('stellar.assetPairs');
    });

    // ── Asset type validation ──────────────────────────────────────────────────

    it('returns ASSET_INVALID_TYPE for an unknown asset type', () => {
        const pair = { base: { type: 'unknown', code: 'FOO', issuer: VALID_ISSUER }, counter: usdc };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_INVALID_TYPE')).toBe(true);
        expect(errors[0].field).toContain('stellar.assetPairs[0].base.type');
    });

    it('returns ASSET_INVALID_TYPE for missing type', () => {
        const pair = { base: { code: 'FOO', issuer: VALID_ISSUER }, counter: usdc };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_INVALID_TYPE')).toBe(true);
    });

    // ── Native asset rules ─────────────────────────────────────────────────────

    it('accepts native asset with empty issuer string', () => {
        const pair: AssetPair = { base: { type: 'native', code: 'XLM', issuer: '' }, counter: usdc };
        expect(validateAssetPairs([pair])).toEqual([]);
    });

    it('accepts native asset with no issuer property', () => {
        const pair = { base: { type: 'native', code: 'XLM' }, counter: usdc };
        expect(validateAssetPairs([pair])).toEqual([]);
    });

    it('returns ASSET_NATIVE_HAS_ISSUER when native asset has a non-empty issuer', () => {
        const pair = { base: { type: 'native', code: 'XLM', issuer: VALID_ISSUER }, counter: usdc };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_NATIVE_HAS_ISSUER')).toBe(true);
        expect(errors[0].field).toContain('stellar.assetPairs[0].base.issuer');
    });

    // ── Asset code length constraints ──────────────────────────────────────────

    it('accepts credit_alphanum4 with a 4-char code', () => {
        const pair: AssetPair = { base: { type: 'credit_alphanum4', code: 'USDC', issuer: VALID_ISSUER }, counter: xlm };
        expect(validateAssetPairs([pair])).toEqual([]);
    });

    it('returns ASSET_CODE_TOO_LONG for credit_alphanum4 with a 5-char code', () => {
        const pair = { base: { type: 'credit_alphanum4', code: 'TOOLG', issuer: VALID_ISSUER }, counter: xlm };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_CODE_TOO_LONG')).toBe(true);
    });

    it('accepts credit_alphanum12 with a 12-char code', () => {
        const pair: AssetPair = { base: longCode, counter: xlm };
        expect(validateAssetPairs([pair])).toEqual([]);
    });

    it('returns ASSET_CODE_TOO_SHORT for credit_alphanum12 with a 4-char code', () => {
        const pair = { base: { type: 'credit_alphanum12', code: 'USDC', issuer: VALID_ISSUER }, counter: xlm };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_CODE_TOO_SHORT')).toBe(true);
    });

    it('returns ASSET_INVALID_CODE for a code with invalid characters', () => {
        const pair = { base: { type: 'credit_alphanum4', code: 'us$c', issuer: VALID_ISSUER }, counter: xlm };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_INVALID_CODE')).toBe(true);
    });

    // ── Issuer format validation ───────────────────────────────────────────────

    it('returns ASSET_INVALID_ISSUER for a non-native asset without an issuer', () => {
        const pair = { base: { type: 'credit_alphanum4', code: 'USDC' }, counter: xlm };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_INVALID_ISSUER')).toBe(true);
    });

    it('returns ASSET_INVALID_ISSUER for an issuer that does not start with G', () => {
        const pair = { base: { type: 'credit_alphanum4', code: 'USDC', issuer: 'ABCD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' }, counter: xlm };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_INVALID_ISSUER')).toBe(true);
    });

    it('returns ASSET_INVALID_ISSUER for an issuer that is too short', () => {
        const pair = { base: { type: 'credit_alphanum4', code: 'USDC', issuer: 'GBBD47IF6LWK7P7' }, counter: xlm };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_INVALID_ISSUER')).toBe(true);
    });

    it('returns ASSET_INVALID_ISSUER for an issuer with invalid base32 characters', () => {
        const pair = { base: { type: 'credit_alphanum4', code: 'USDC', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA!' }, counter: xlm };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_INVALID_ISSUER')).toBe(true);
    });

    // ── Identical asset pair ───────────────────────────────────────────────────

    it('returns ASSET_PAIR_IDENTICAL_ASSETS when base and counter are the same', () => {
        const pair: AssetPair = { base: usdc, counter: usdc };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_PAIR_IDENTICAL_ASSETS')).toBe(true);
        expect(errors[0].field).toBe('stellar.assetPairs[0]');
    });

    it('returns ASSET_PAIR_IDENTICAL_ASSETS for two native assets', () => {
        const pair = { base: xlm, counter: { type: 'native', code: 'XLM', issuer: '' } };
        const errors = validateAssetPairs([pair]);
        expect(errors.some(e => e.code === 'ASSET_PAIR_IDENTICAL_ASSETS')).toBe(true);
    });

    // ── Duplicate pair detection ───────────────────────────────────────────────

    it('returns ASSET_PAIR_DUPLICATE for two identical pairs', () => {
        const errors = validateAssetPairs([validPair, validPair]);
        expect(errors.some(e => e.code === 'ASSET_PAIR_DUPLICATE')).toBe(true);
        expect(errors[0].field).toBe('stellar.assetPairs[1]');
    });

    it('returns ASSET_PAIR_DUPLICATE for reversed duplicate (order-insensitive)', () => {
        const reversed: AssetPair = { base: usdc, counter: xlm };
        const errors = validateAssetPairs([validPair, reversed]);
        expect(errors.some(e => e.code === 'ASSET_PAIR_DUPLICATE')).toBe(true);
    });

    it('does not flag distinct pairs as duplicates', () => {
        const errors = validateAssetPairs([validPair, validPair2]);
        expect(errors.some(e => e.code === 'ASSET_PAIR_DUPLICATE')).toBe(false);
    });

    // ── Field path accuracy ────────────────────────────────────────────────────

    it('uses correct field path for errors in the second pair', () => {
        const badPair = { base: { type: 'credit_alphanum4', code: 'USDC' }, counter: xlm };
        const errors = validateAssetPairs([validPair, badPair]);
        expect(errors[0].field).toContain('stellar.assetPairs[1]');
    });

    it('reports errors for both pairs independently', () => {
        const bad1 = { base: { type: 'credit_alphanum4', code: 'USDC' }, counter: xlm };
        const bad2 = { base: { type: 'credit_alphanum4', code: 'BTC' }, counter: xlm };
        const errors = validateAssetPairs([bad1, bad2]);
        expect(errors.some(e => e.field.includes('[0]'))).toBe(true);
        expect(errors.some(e => e.field.includes('[1]'))).toBe(true);
    });
});

// ── Integration: validateCustomizationConfig ──────────────────────────────────

describe('validateCustomizationConfig — asset pair integration', () => {
    it('accepts a config with valid asset pairs', () => {
        const result = validateCustomizationConfig({
            ...baseConfig,
            stellar: { ...baseConfig.stellar, assetPairs: [validPair, validPair2] },
        });
        expect(result.valid).toBe(true);
    });

    it('accepts a config with no asset pairs', () => {
        expect(validateCustomizationConfig(baseConfig)).toEqual({ valid: true, errors: [] });
    });

    it('returns errors for invalid asset pairs via the full validation pipeline', () => {
        const result = validateCustomizationConfig({
            ...baseConfig,
            stellar: {
                ...baseConfig.stellar,
                assetPairs: [{ base: usdc, counter: usdc }],
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.code === 'ASSET_PAIR_IDENTICAL_ASSETS')).toBe(true);
    });

    it('returns errors for duplicate pairs via the full validation pipeline', () => {
        const result = validateCustomizationConfig({
            ...baseConfig,
            stellar: {
                ...baseConfig.stellar,
                assetPairs: [validPair, validPair],
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.code === 'ASSET_PAIR_DUPLICATE')).toBe(true);
    });

    it('returns errors for invalid issuer via the full validation pipeline', () => {
        const badPair = { base: { type: 'credit_alphanum4', code: 'USDC', issuer: 'bad' }, counter: xlm };
        const result = validateCustomizationConfig({
            ...baseConfig,
            stellar: { ...baseConfig.stellar, assetPairs: [badPair] },
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.code === 'ASSET_INVALID_ISSUER')).toBe(true);
    });
});

// ── checkBridgeLiquidity tests (#793) ─────────────────────────────────────────

import { describe as describe793, it as it793, expect as expect793, vi as vi793, beforeEach as beforeEach793 } from 'vitest';
import {
    checkBridgeLiquidity,
    clearLiquidityCache,
    MIN_LIQUIDITY_USD,
    LIQUIDITY_CACHE_TTL_MS,
} from '@/lib/stellar/validate-asset-pairs';
import type { HorizonOrderBookResponse } from '@/lib/stellar/validate-asset-pairs';

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const pairXlmUsdc: AssetPair = {
    base: { type: 'native', code: 'XLM', issuer: '' },
    counter: { type: 'credit_alphanum4', code: 'USDC', issuer: ISSUER },
};

function deepBook(): HorizonOrderBookResponse {
    // Each side: 10 levels × 200 amount × price ~1 → depth ≈ 2000 > MIN
    return {
        bids: Array(10).fill({ price: '1.0000', amount: '200.0000' }),
        asks: Array(10).fill({ price: '1.0100', amount: '200.0000' }),
    };
}

function shallowBook(): HorizonOrderBookResponse {
    // depth = 1 × 0.5 = 0.5 → way below MIN_LIQUIDITY_USD
    return {
        bids: [{ price: '1.0000', amount: '0.5000' }],
        asks: [{ price: '1.0100', amount: '0.5000' }],
    };
}

describe793('checkBridgeLiquidity (#793)', () => {
    beforeEach793(() => clearLiquidityCache());

    it793('returns liquidityWarning:false when depth exceeds minimum', async () => {
        const fetch = vi793.fn().mockResolvedValue(deepBook());
        const result = await checkBridgeLiquidity(pairXlmUsdc, fetch);

        expect793(result.liquidityWarning).toBe(false);
        expect793(result.valid).toBe(true);
    });

    it793('returns liquidityWarning:true with depth when below minimum', async () => {
        const fetch = vi793.fn().mockResolvedValue(shallowBook());
        const result = await checkBridgeLiquidity(pairXlmUsdc, fetch);

        expect793(result.valid).toBe(true);
        expect793(result.liquidityWarning).toBe(true);
        if (result.liquidityWarning) {
            expect793(result.depth).toBeLessThan(MIN_LIQUIDITY_USD);
        }
    });

    it793('caches results for 5 minutes — second call does not re-fetch', async () => {
        const fetch = vi793.fn().mockResolvedValue(deepBook());

        await checkBridgeLiquidity(pairXlmUsdc, fetch);
        await checkBridgeLiquidity(pairXlmUsdc, fetch);

        expect793(fetch).toHaveBeenCalledOnce();
    });

    it793('re-fetches after cache expires', async () => {
        vi793.useFakeTimers();
        const fetch = vi793.fn().mockResolvedValue(deepBook());

        await checkBridgeLiquidity(pairXlmUsdc, fetch);
        vi793.advanceTimersByTime(LIQUIDITY_CACHE_TTL_MS + 1);
        await checkBridgeLiquidity(pairXlmUsdc, fetch);

        expect793(fetch).toHaveBeenCalledTimes(2);
        vi793.useRealTimers();
    });

    it793('uses minimum of bid and ask depth for the warning threshold', async () => {
        // Bids deep, asks shallow
        const asymmetric: HorizonOrderBookResponse = {
            bids: Array(20).fill({ price: '1.0000', amount: '500.0' }),
            asks: [{ price: '1.01', amount: '1.0' }], // depth ≈ 1.01 < MIN
        };
        const fetch = vi793.fn().mockResolvedValue(asymmetric);
        const result = await checkBridgeLiquidity(pairXlmUsdc, fetch);

        expect793(result.liquidityWarning).toBe(true);
    });
});
