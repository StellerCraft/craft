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
