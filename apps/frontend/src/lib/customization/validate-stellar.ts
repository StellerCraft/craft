import { z } from 'zod';
import type { StellarConfig, ValidationError } from '@craft/types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Soroban contract address: 56-character base32 (C + 55 alphanumeric). */
const CONTRACT_ADDRESS_RE = /^C[A-Z2-7]{55}$/;

/** Stellar asset code: 1–12 alphanumeric characters. */
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;

/** Stellar account ID (G…): 56-character base32. */
const ACCOUNT_ID_RE = /^G[A-Z2-7]{55}$/;

const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const MAINNET_HORIZON = 'https://horizon.stellar.org';

// ── Sub-schemas ───────────────────────────────────────────────────────────────

/**
 * Stellar asset schema.
 * - native XLM has no issuer; all other types require one.
 */
const stellarAssetSchema = z
    .object({
        code: z.string().regex(ASSET_CODE_RE, 'Asset code must be 1–12 alphanumeric characters'),
        issuer: z.string().optional(),
        type: z.enum(['native', 'credit_alphanum4', 'credit_alphanum12']),
    })
    .superRefine((asset, ctx) => {
        if (asset.type !== 'native') {
            if (!asset.issuer) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Issuer is required for non-native assets',
                    path: ['issuer'],
                });
            } else if (!ACCOUNT_ID_RE.test(asset.issuer)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'Issuer must be a valid Stellar account ID (starts with G)',
                    path: ['issuer'],
                });
            }
        }
        if (asset.type === 'credit_alphanum4' && asset.code.length > 4) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'credit_alphanum4 asset code must be 1–4 characters',
                path: ['code'],
            });
        }
    });

const assetPairSchema = z.object({
    base: stellarAssetSchema,
    counter: stellarAssetSchema,
});

/**
 * Full Stellar configuration schema.
 * Validates network, URLs, asset pairs, and contract addresses.
 */
export const stellarConfigSchema = z
    .object({
        network: z.enum(['mainnet', 'testnet'], {
            errorMap: () => ({ message: 'Network must be mainnet or testnet' }),
        }),
        horizonUrl: z.string().url('Horizon URL must be a valid URL'),
        sorobanRpcUrl: z.string().url('Soroban RPC URL must be a valid URL').optional(),
        assetPairs: z
            .array(assetPairSchema)
            .max(20, 'A maximum of 20 asset pairs is supported')
            .optional(),
        contractAddresses: z
            .record(
                z.string().min(1, 'Contract key must not be empty'),
                z.string().regex(CONTRACT_ADDRESS_RE, 'Contract address must be a valid Soroban contract ID (starts with C, 56 chars)')
            )
            .optional(),
    })
    .superRefine((cfg, ctx) => {
        // Horizon URL / network mismatch
        if (cfg.network === 'mainnet' && cfg.horizonUrl === TESTNET_HORIZON) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Horizon URL points to testnet but network is set to mainnet',
                path: ['horizonUrl'],
            });
        }
        if (cfg.network === 'testnet' && cfg.horizonUrl === MAINNET_HORIZON) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Horizon URL points to mainnet but network is set to testnet',
                path: ['horizonUrl'],
            });
        }
    });

// ── Public API ────────────────────────────────────────────────────────────────

export interface StellarConfigValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

/**
 * Validate a StellarConfig object.
 *
 * Returns field-level errors compatible with the shared ValidationError type.
 * Safe to call from both API routes and React form hooks.
 *
 * @example
 * const result = validateStellarConfig(config.stellar);
 * if (!result.valid) {
 *   result.errors.forEach(e => console.error(e.field, e.message));
 * }
 */
export function validateStellarConfig(input: unknown): StellarConfigValidationResult {
    const parsed = stellarConfigSchema.safeParse(input);

    if (!parsed.success) {
        const errors: ValidationError[] = parsed.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
            code: e.code.toUpperCase(),
        }));
        return { valid: false, errors };
    }

    return { valid: true, errors: [] };
}

/**
 * Default Stellar config values for the configuration panel.
 * Uses testnet defaults to avoid accidental mainnet deployments.
 */
export const DEFAULT_STELLAR_CONFIG: StellarConfig = {
    network: 'testnet',
    horizonUrl: TESTNET_HORIZON,
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    assetPairs: [],
    contractAddresses: {},
};
