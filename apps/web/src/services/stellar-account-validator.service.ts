/**
 * StellarAccountValidator
 *
 * Validates Stellar account addresses (format) and optionally checks account
 * existence on the Horizon API. Stellar account addresses are 56-character
 * base32 strings starting with 'G'.
 *
 * Feature: stellar-account-validation
 * Issue: #247
 */

export interface AccountValidationResult {
    valid: boolean;
    address?: string;
    error?: {
        field: string;
        message: string;
        code: AccountValidationErrorCode;
    };
}

export interface AccountExistenceResult {
    exists: boolean;
    address: string;
    funded: boolean;
    error?: string;
}

export type AccountValidationErrorCode =
    | 'ACCOUNT_ADDRESS_EMPTY'
    | 'ACCOUNT_ADDRESS_NOT_STRING'
    | 'ACCOUNT_ADDRESS_INVALID_LENGTH'
    | 'ACCOUNT_ADDRESS_INVALID_PREFIX'
    | 'ACCOUNT_ADDRESS_INVALID_CHARSET';

const STELLAR_ADDRESS_RE = /^[A-Z2-7]{56}$/;

/**
 * Validate a Stellar account address format.
 * Stellar account addresses are 56-character base32 strings starting with 'G'.
 */
export function validateAccountAddress(address: unknown): AccountValidationResult {
    if (!address) {
        return {
            valid: false,
            error: {
                field: 'stellar.account',
                message: 'Account address cannot be empty',
                code: 'ACCOUNT_ADDRESS_EMPTY',
            },
        };
    }

    if (typeof address !== 'string') {
        return {
            valid: false,
            error: {
                field: 'stellar.account',
                message: 'Account address must be a string',
                code: 'ACCOUNT_ADDRESS_NOT_STRING',
            },
        };
    }

    if (address.length !== 56) {
        return {
            valid: false,
            error: {
                field: 'stellar.account',
                message: `Account address must be 56 characters long, got ${address.length}`,
                code: 'ACCOUNT_ADDRESS_INVALID_LENGTH',
            },
        };
    }

    if (address[0] !== 'G') {
        return {
            valid: false,
            error: {
                field: 'stellar.account',
                message: 'Account address must start with "G"',
                code: 'ACCOUNT_ADDRESS_INVALID_PREFIX',
            },
        };
    }

    if (!STELLAR_ADDRESS_RE.test(address)) {
        return {
            valid: false,
            error: {
                field: 'stellar.account',
                message: 'Account address contains invalid characters (must be base32: A-Z, 2-7)',
                code: 'ACCOUNT_ADDRESS_INVALID_CHARSET',
            },
        };
    }

    return { valid: true, address };
}

export interface FetchLike {
    (input: string, init?: RequestInit): Promise<Response>;
}

export class StellarAccountValidator {
    constructor(private readonly _fetch: FetchLike = fetch) {}

    /**
     * Validate account address format only (no network call).
     */
    validateFormat(address: unknown): AccountValidationResult {
        return validateAccountAddress(address);
    }

    /**
     * Check if an account exists on the Stellar network via Horizon.
     * Returns funded: true if the account has a non-zero XLM balance.
     */
    async checkExistence(address: string, horizonUrl: string): Promise<AccountExistenceResult> {
        const formatResult = validateAccountAddress(address);
        if (!formatResult.valid) {
            return { exists: false, address, funded: false, error: formatResult.error?.message };
        }

        try {
            const url = `${horizonUrl.replace(/\/$/, '')}/accounts/${address}`;
            const response = await this._fetch(url, {
                headers: { Accept: 'application/json' },
            });

            if (response.status === 404) {
                return { exists: false, address, funded: false };
            }

            if (!response.ok) {
                return {
                    exists: false,
                    address,
                    funded: false,
                    error: `Horizon returned HTTP ${response.status}`,
                };
            }

            const data = await response.json() as { balances?: Array<{ asset_type: string; balance: string }> };
            const xlmBalance = data.balances?.find((b) => b.asset_type === 'native');
            const funded = xlmBalance ? parseFloat(xlmBalance.balance) > 0 : false;

            return { exists: true, address, funded };
        } catch (err: unknown) {
            return {
                exists: false,
                address,
                funded: false,
                error: err instanceof Error ? err.message : 'Network error',
            };
        }
    }
}

export const stellarAccountValidator = new StellarAccountValidator();
