/**
 * FeatureFlagGenerator
 *
 * Maps a validated FeatureConfig into template-ready configuration artifacts:
 *   - A typed feature-flags.ts file for the generated app
 *   - A flat env-var record for feature flags (for .env.local / Vercel)
 *   - Validation that unsupported flags for a given template family fail clearly
 *
 * Feature flags are deterministic: the same FeatureConfig always produces
 * the same output regardless of call order or environment.
 *
 * Design doc properties satisfied:
 *   Property 16 — Code Generation Completeness
 *   Property 42 — Configuration-Driven Blockchain Settings
 *
 * Feature: feature-flag-configuration-generation
 * Issue branch: issue-064-implement-feature-flag-configuration-generation
 */

import type { FeatureConfig } from '@craft/types';
import type { TemplateFamilyId } from '@/services/code-generator.service';

// ── Types ─────────────────────────────────────────────────────────────────────

/** All known feature flag keys. */
export type FeatureFlagKey =
    | 'enableCharts'
    | 'enableTransactionHistory'
    | 'enableAnalytics'
    | 'enableNotifications';

/** Metadata for a single feature flag. */
export interface FeatureFlagMeta {
    key: FeatureFlagKey;
    envVar: string;
    description: string;
    /** Template families that support this flag. All others must treat it as unsupported. */
    supportedFamilies: TemplateFamilyId[];
}

/** Result of validating a FeatureConfig against a template family. */
export interface FeatureFlagValidationResult {
    valid: boolean;
    errors: FeatureFlagValidationError[];
}

export interface FeatureFlagValidationError {
    flag: FeatureFlagKey;
    family: TemplateFamilyId;
    message: string;
    code: string;
}

// ── Flag registry ─────────────────────────────────────────────────────────────

/**
 * Canonical registry of all feature flags and their supported template families.
 * This is the single source of truth for flag metadata.
 */
export const FEATURE_FLAG_REGISTRY: Record<FeatureFlagKey, FeatureFlagMeta> = {
    enableCharts: {
        key: 'enableCharts',
        envVar: 'NEXT_PUBLIC_ENABLE_CHARTS',
        description: 'Render chart components (price history, volume, etc.)',
        supportedFamilies: ['stellar-dex', 'soroban-defi', 'asset-issuance'],
    },
    enableTransactionHistory: {
        key: 'enableTransactionHistory',
        envVar: 'NEXT_PUBLIC_ENABLE_TRANSACTION_HISTORY',
        description: 'Show transaction history table',
        supportedFamilies: ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'],
    },
    enableAnalytics: {
        key: 'enableAnalytics',
        envVar: 'NEXT_PUBLIC_ENABLE_ANALYTICS',
        description: 'Enable analytics event tracking',
        supportedFamilies: ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'],
    },
    enableNotifications: {
        key: 'enableNotifications',
        envVar: 'NEXT_PUBLIC_ENABLE_NOTIFICATIONS',
        description: 'Show in-app notification toasts',
        supportedFamilies: ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'],
    },
};

const ALL_FLAG_KEYS = Object.keys(FEATURE_FLAG_REGISTRY) as FeatureFlagKey[];

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate that no enabled flag is unsupported by the given template family.
 * An unsupported flag that is set to `true` is a configuration error.
 * Flags set to `false` are always safe regardless of family support.
 */
export function validateFeatureFlags(
    family: TemplateFamilyId,
    features: FeatureConfig
): FeatureFlagValidationResult {
    const errors: FeatureFlagValidationError[] = [];

    for (const key of ALL_FLAG_KEYS) {
        const meta = FEATURE_FLAG_REGISTRY[key];
        const enabled = features[key];

        if (enabled && !meta.supportedFamilies.includes(family)) {
            errors.push({
                flag: key,
                family,
                message: `Feature "${key}" is not supported by the "${family}" template family`,
                code: 'UNSUPPORTED_FEATURE_FLAG',
            });
        }
    }

    return { valid: errors.length === 0, errors };
}

// ── Env var record ────────────────────────────────────────────────────────────

/**
 * Build a flat env-var record for all feature flags.
 * Values are the string representations of the boolean flags.
 * Unsupported flags for the given family are forced to 'false'.
 */
export function buildFeatureFlagEnvVars(
    family: TemplateFamilyId,
    features: FeatureConfig
): Record<string, string> {
    const vars: Record<string, string> = {};

    for (const key of ALL_FLAG_KEYS) {
        const meta = FEATURE_FLAG_REGISTRY[key];
        const supported = meta.supportedFamilies.includes(family);
        // Unsupported flags are always false regardless of user choice
        vars[meta.envVar] = supported ? String(features[key]) : 'false';
    }

    return vars;
}

// ── File generator ────────────────────────────────────────────────────────────

/**
 * Generate the content of `src/lib/feature-flags.ts` for a given template
 * family and feature config. Only flags supported by the family are included
 * as active entries; unsupported flags are commented out with an explanation.
 *
 * Output is deterministic: same inputs always produce identical output.
 */
export function generateFeatureFlagsFile(
    family: TemplateFamilyId,
    features: FeatureConfig
): string {
    const lines: string[] = [
        `// Auto-generated by CRAFT Platform`,
        `// Template: ${family}`,
        `// Feature: feature-flag-configuration-generation`,
        ``,
        `export const featureFlags = {`,
    ];

    for (const key of ALL_FLAG_KEYS) {
        const meta = FEATURE_FLAG_REGISTRY[key];
        const supported = meta.supportedFamilies.includes(family);
        const value = supported ? features[key] : false;
        const envVar = meta.envVar;

        lines.push(`    // ${meta.description}`);

        if (!supported) {
            lines.push(`    // Not supported by the "${family}" template — always false`);
        }

        lines.push(
            `    ${key}: process.env.${envVar} === 'true' || ${value},`
        );
    }

    lines.push(
        `} as const satisfies Record<string, boolean>;`,
        ``,
        `export default featureFlags;`,
        ``
    );

    return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the list of feature flags supported by a given template family.
 */
export function getSupportedFlags(family: TemplateFamilyId): FeatureFlagKey[] {
    return ALL_FLAG_KEYS.filter((key) =>
        FEATURE_FLAG_REGISTRY[key].supportedFamilies.includes(family)
    );
}

/**
 * Return the list of feature flags NOT supported by a given template family.
 */
export function getUnsupportedFlags(family: TemplateFamilyId): FeatureFlagKey[] {
    return ALL_FLAG_KEYS.filter(
        (key) => !FEATURE_FLAG_REGISTRY[key].supportedFamilies.includes(family)
    );
}
