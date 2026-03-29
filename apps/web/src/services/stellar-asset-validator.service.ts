/**
 * StellarAssetValidator
 *
 * Validates Stellar asset codes and issuer addresses, and optionally checks
 * asset existence on the Horizon API.
 *
 * Feature: stellar-asset-validation
 * Issue: #246
 */

export interface AssetValidationResult {
    valid: boolean;
    error?: {
        field: string;
        message: string;
        code: AssetValidationErrorCode;
    };
}

export interface AssetExistenceResult {
    exists: boolean;
    assetCode: string;
    issuer: string;
    supply?: string;
    error?: string;
}

export type AssetValidationErrorCode =
    | 'ASSET_CODE_EMPTY'
    | 'ASSET_CODE_INVALID_LENGTH'
    | 'ASSET_CODE_INVALID_CHARSET'
    | 'ASSET_ISSUER_EMPTY'
    | 'ASSET_ISSUER_INVALID';

const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const STELLAR_ADDRESS_RE = /^G[A-Z2-7]{55}$/;

/**
 * Validate a Stellar asset code (1-12 alphanumeric characters).
 */
export function validateAssetCode(code: unknown): AssetValidationResult {
    if (!code || (typeof code === 'string' && code.trim() === '')) {
        return {
            valid: false,
            error: {
                field: 'stellar.asset.code',
                message: 'Asset code cannot be empty',
                code: 'ASSET_CODE_EMPTY',
            },
        };
    }

    if (typeof code !== 'string') {
        return {
            valid: false,
            error: {
                field: 'stellar.asset.code',
                message: 'Asset code must be a string',
                code: 'ASSET_CODE_INVALID_CHARSET',
            },
        };
    }

    if (code.length < 1 || code.length > 12) {
        return {
            valid: false,
            error: {
                field: 'stellar.asset.code',
                message: `Asset code must be 1-12 characters, got ${code.length}`,
                code: 'ASSET_CODE_INVALID_LENGTH',
            },
        };
    }

    if (!ASSET_CODE_RE.test(code)) {
        return {
            valid: false,
            error: {
                field: 'stellar.asset.code',
                message: 'Asset code must contain only alphanumeric characters (A-Z, a-z, 0-9)',
                code: 'ASSET_CODE_INVALID_CHARSET',
            },
        };
    }

    return { valid: true };
}

/**
 * Validate a Stellar asset issuer address format.
 */
export function validateAssetIssuer(issuer: unknown): AssetValidationResult {
    if (!issuer || (typeof issuer === 'string' && issuer.trim() === '')) {
        return {
            valid: false,
            error: {
                field: 'stellar.asset.issuer',
                message: 'Asset issuer cannot be empty',
                code: 'ASSET_ISSUER_EMPTY',
            },
        };
    }

    if (typeof issuer !== 'string' || !STELLAR_ADDRESS_RE.test(issuer)) {
        return {
            valid: false,
            error: {
                field: 'stellar.asset.issuer',
                message: 'Asset issuer must be a valid Stellar account address (56-char base32 starting with G)',
                code: 'ASSET_ISSUER_INVALID',
            },
        };
    }

    return { valid: true };
}

export interface FetchLike {
    (input: string, init?: RequestInit): Promise<Response>;
}

export class StellarAssetValidator {
    constructor(private readonly _fetch: FetchLike = fetch) {}

    validateCode(code: unknown): AssetValidationResult {
        return validateAssetCode(code);
    }

    validateIssuer(issuer: unknown): AssetValidationResult {
        return validateAssetIssuer(issuer);
    }

    /**
     * Check if an asset exists on the Stellar network via Horizon.
     */
    async checkExistence(assetCode: string, issuer: string, horizonUrl: string): Promise<AssetExistenceResult> {
        const codeResult = validateAssetCode(assetCode);
        if (!codeResult.valid) {
            return { exists: false, assetCode, issuer, error: codeResult.error?.message };
        }

        const issuerResult = validateAssetIssuer(issuer);
        if (!issuerResult.valid) {
            return { exists: false, assetCode, issuer, error: issuerResult.error?.message };
        }

        try {
            const url = `${horizonUrl.replace(/\/$/, '')}/assets?asset_code=${assetCode}&asset_issuer=${issuer}&limit=1`;
            const response = await this._fetch(url, {
                headers: { Accept: 'application/json' },
            });

            if (!response.ok) {
                return {
                    exists: false,
                    assetCode,
                    issuer,
                    error: `Horizon returned HTTP ${response.status}`,
                };
            }

            const data = await response.json() as { _embedded?: { records?: Array<{ amount: string }> } };
            const records = data._embedded?.records ?? [];

            if (records.length === 0) {
                return { exists: false, assetCode, issuer };
            }

            return {
                exists: true,
                assetCode,
                issuer,
                supply: records[0].amount,
            };
        } catch (err: unknown) {
            return {
                exists: false,
                assetCode,
                issuer,
                error: err instanceof Error ? err.message : 'Network error',
            };
        }
    }
}

export const stellarAssetValidator = new StellarAssetValidator();
