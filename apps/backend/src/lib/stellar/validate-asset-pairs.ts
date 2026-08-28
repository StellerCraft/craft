/**
 * Stellar Asset Pair Validation
 *
 * Validates configured asset pairs for DEX-style templates.
 *
 * Rules enforced:
 *   - Each asset has a valid type (native | credit_alphanum4 | credit_alphanum12)
 *   - Native assets must not have an issuer; non-native assets must have one
 *   - Asset codes match their declared type length constraints
 *   - Issuers are valid Stellar public keys (G…, 56 chars, base32)
 *   - A pair's base and counter assets must differ
 *   - No duplicate pairs in the array (order-insensitive)
 *
 * Issue: #51
 */

import type { AssetPair, StellarAsset } from '@craft/types';
import type { ValidationError } from '@craft/types';

// ── Constants ─────────────────────────────────────────────────────────────────

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;
const ASSET_CODE_RE = /^[A-Z0-9]{1,12}$/;

// ── Internal helpers ──────────────────────────────────────────────────────────

function validateAsset(
    asset: unknown,
    fieldPrefix: string
): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!asset || typeof asset !== 'object') {
        errors.push({ field: fieldPrefix, message: 'Asset must be an object', code: 'ASSET_INVALID' });
        return errors;
    }

    const a = asset as Record<string, unknown>;
    const type = a['type'];
    const code = a['code'];
    const issuer = a['issuer'];

    // type
    if (type !== 'native' && type !== 'credit_alphanum4' && type !== 'credit_alphanum12') {
        errors.push({
            field: `${fieldPrefix}.type`,
            message: 'Asset type must be native, credit_alphanum4, or credit_alphanum12',
            code: 'ASSET_INVALID_TYPE',
        });
        return errors; // can't validate further without a valid type
    }

    if (type === 'native') {
        // Native assets must not carry an issuer
        if (issuer !== undefined && issuer !== '' && issuer !== null) {
            errors.push({
                field: `${fieldPrefix}.issuer`,
                message: 'Native asset must not have an issuer',
                code: 'ASSET_NATIVE_HAS_ISSUER',
            });
        }
        return errors;
    }

    // Non-native: validate code
    if (typeof code !== 'string' || !ASSET_CODE_RE.test(code)) {
        errors.push({
            field: `${fieldPrefix}.code`,
            message: 'Asset code must be 1–12 uppercase alphanumeric characters',
            code: 'ASSET_INVALID_CODE',
        });
    } else {
        if (type === 'credit_alphanum4' && code.length > 4) {
            errors.push({
                field: `${fieldPrefix}.code`,
                message: 'credit_alphanum4 asset code must be 1–4 characters',
                code: 'ASSET_CODE_TOO_LONG',
            });
        }
        if (type === 'credit_alphanum12' && code.length <= 4) {
            errors.push({
                field: `${fieldPrefix}.code`,
                message: 'credit_alphanum12 asset code must be 5–12 characters',
                code: 'ASSET_CODE_TOO_SHORT',
            });
        }
    }

    // Non-native: validate issuer
    if (typeof issuer !== 'string' || !STELLAR_PUBLIC_KEY_RE.test(issuer)) {
        errors.push({
            field: `${fieldPrefix}.issuer`,
            message: 'Non-native asset must have a valid Stellar public key issuer (G…, 56 chars)',
            code: 'ASSET_INVALID_ISSUER',
        });
    }

    return errors;
}

/** Stable string key for an asset, used for duplicate detection. */
function assetKey(asset: StellarAsset): string {
    return asset.type === 'native' ? 'native' : `${asset.code}:${asset.issuer}`;
}

/** Stable string key for a pair (order-insensitive). */
function pairKey(pair: AssetPair): string {
    const keys = [assetKey(pair.base), assetKey(pair.counter)].sort();
    return keys.join('|');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Validate an array of asset pairs.
 *
 * Returns field-scoped ValidationErrors using the path
 * `stellar.assetPairs[i].{base|counter}.{field}`.
 *
 * @param pairs - The assetPairs array from a CustomizationConfig
 * @returns Array of ValidationErrors (empty when all pairs are valid)
 */
export function validateAssetPairs(pairs: unknown): ValidationError[] {
    if (pairs === undefined || pairs === null) return [];

    if (!Array.isArray(pairs)) {
        return [{
            field: 'stellar.assetPairs',
            message: 'assetPairs must be an array',
            code: 'ASSET_PAIRS_NOT_ARRAY',
        }];
    }

    const errors: ValidationError[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        const pairPrefix = `stellar.assetPairs[${i}]`;

        if (!pair || typeof pair !== 'object') {
            errors.push({ field: pairPrefix, message: 'Asset pair must be an object', code: 'ASSET_PAIR_INVALID' });
            continue;
        }

        const p = pair as Record<string, unknown>;

        // Validate base and counter assets
        errors.push(...validateAsset(p['base'], `${pairPrefix}.base`));
        errors.push(...validateAsset(p['counter'], `${pairPrefix}.counter`));

        // Skip pair-level checks if individual assets are already invalid
        const pairHasAssetErrors = errors.some(e => e.field.startsWith(pairPrefix));
        if (pairHasAssetErrors) continue;

        const typedPair = pair as AssetPair;

        // Base and counter must differ
        if (assetKey(typedPair.base) === assetKey(typedPair.counter)) {
            errors.push({
                field: pairPrefix,
                message: 'Asset pair base and counter must be different assets',
                code: 'ASSET_PAIR_IDENTICAL_ASSETS',
            });
            continue;
        }

        // Duplicate pair detection
        const key = pairKey(typedPair);
        if (seen.has(key)) {
            errors.push({
                field: pairPrefix,
                message: 'Duplicate asset pair detected',
                code: 'ASSET_PAIR_DUPLICATE',
            });
        } else {
            seen.add(key);
        }
    }

    return errors;
}

// ── Bridge Liquidity Check (#793) ─────────────────────────────────────────────

/** Minimum USD-equivalent depth required on each side of the order book. */
export const MIN_LIQUIDITY_USD = 1_000;

/** Cache TTL: 5 minutes in milliseconds. */
export const LIQUIDITY_CACHE_TTL_MS = 5 * 60 * 1_000;

export type LiquidityCheckResult =
    | { valid: true; liquidityWarning: false }
    | { valid: true; liquidityWarning: true; depth: number };

interface CacheEntry {
    result: LiquidityCheckResult;
    storedAt: number;
}

const liquidityCache = new Map<string, CacheEntry>();

/** Flush all cached liquidity results (for testing). */
export function clearLiquidityCache(): void {
    liquidityCache.clear();
}

function liquidityCacheKey(pair: AssetPair): string {
    return `${assetKey(pair.base)}|${assetKey(pair.counter)}`;
}

/**
 * Horizon order book response subset used for depth calculation.
 * Mirrors the shape returned by `GET /order_book?selling=…&buying=…`.
 */
export interface HorizonOrderBookResponse {
    bids: Array<{ price: string; amount: string }>;
    asks: Array<{ price: string; amount: string }>;
}

export type OrderBookFetchFn = (pair: AssetPair) => Promise<HorizonOrderBookResponse>;

/**
 * Sum the USD-equivalent volume on one side of the order book.
 * Each level contributes `price × amount`.
 */
function sumSideDepth(levels: Array<{ price: string; amount: string }>): number {
    return levels.reduce((sum, lvl) => {
        const p = parseFloat(lvl.price);
        const a = parseFloat(lvl.amount);
        return sum + (isFinite(p) && isFinite(a) ? p * a : 0);
    }, 0);
}

/**
 * Check whether sufficient bridge liquidity exists for the given asset pair
 * on the Stellar DEX.
 *
 * Results are cached for 5 minutes per pair. Pass `fetchOrderBook` to
 * inject a custom fetcher (required for testing; defaults to Horizon fetch).
 *
 * @param pair            - Asset pair to check
 * @param fetchOrderBook  - Async function that returns a Horizon order book
 * @returns `LiquidityCheckResult` indicating whether liquidity is sufficient
 */
export async function checkBridgeLiquidity(
    pair: AssetPair,
    fetchOrderBook: OrderBookFetchFn,
): Promise<LiquidityCheckResult> {
    const cacheKey = liquidityCacheKey(pair);
    const cached = liquidityCache.get(cacheKey);
    if (cached && Date.now() - cached.storedAt < LIQUIDITY_CACHE_TTL_MS) {
        return cached.result;
    }

    const book = await fetchOrderBook(pair);
    const bidDepth = sumSideDepth(book.bids);
    const askDepth = sumSideDepth(book.asks);
    const minDepth = Math.min(bidDepth, askDepth);

    const result: LiquidityCheckResult =
        minDepth >= MIN_LIQUIDITY_USD
            ? { valid: true, liquidityWarning: false }
            : { valid: true, liquidityWarning: true, depth: minDepth };

    liquidityCache.set(cacheKey, { result, storedAt: Date.now() });
    return result;
}
