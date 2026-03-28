/**
 * Tests for FeatureFlagGenerator
 *
 * Covers:
 *   - validateFeatureFlags
 *   - buildFeatureFlagEnvVars
 *   - generateFeatureFlagsFile
 *   - getSupportedFlags / getUnsupportedFlags
 *
 * Feature: feature-flag-configuration-generation
 * Issue branch: issue-064-implement-feature-flag-configuration-generation
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    validateFeatureFlags,
    buildFeatureFlagEnvVars,
    generateFeatureFlagsFile,
    getSupportedFlags,
    getUnsupportedFlags,
    FEATURE_FLAG_REGISTRY,
} from './feature-flag-generator';
import type { FeatureConfig } from '@craft/types';
import type { TemplateFamilyId } from '@/services/code-generator.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_ON: FeatureConfig = {
    enableCharts: true,
    enableTransactionHistory: true,
    enableAnalytics: true,
    enableNotifications: true,
};

const ALL_OFF: FeatureConfig = {
    enableCharts: false,
    enableTransactionHistory: false,
    enableAnalytics: false,
    enableNotifications: false,
};

const ALL_FAMILIES: TemplateFamilyId[] = [
    'stellar-dex',
    'soroban-defi',
    'payment-gateway',
    'asset-issuance',
];

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbFamily = fc.constantFrom<TemplateFamilyId>(
    'stellar-dex',
    'soroban-defi',
    'payment-gateway',
    'asset-issuance'
);

const arbFeatureConfig = fc.record<FeatureConfig>({
    enableCharts: fc.boolean(),
    enableTransactionHistory: fc.boolean(),
    enableAnalytics: fc.boolean(),
    enableNotifications: fc.boolean(),
});

// ── validateFeatureFlags ──────────────────────────────────────────────────────

describe('validateFeatureFlags', () => {
    it('returns valid for all-off config on any family', () => {
        for (const family of ALL_FAMILIES) {
            const result = validateFeatureFlags(family, ALL_OFF);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        }
    });

    it('returns valid for all-on config on stellar-dex (all flags supported)', () => {
        const result = validateFeatureFlags('stellar-dex', ALL_ON);
        expect(result.valid).toBe(true);
    });

    it('returns valid for all-on config on soroban-defi (all flags supported)', () => {
        const result = validateFeatureFlags('soroban-defi', ALL_ON);
        expect(result.valid).toBe(true);
    });

    it('returns invalid when enableCharts=true on payment-gateway (unsupported)', () => {
        const result = validateFeatureFlags('payment-gateway', {
            ...ALL_OFF,
            enableCharts: true,
        });
        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].flag).toBe('enableCharts');
        expect(result.errors[0].code).toBe('UNSUPPORTED_FEATURE_FLAG');
        expect(result.errors[0].family).toBe('payment-gateway');
    });

    it('error message names the flag and family', () => {
        const result = validateFeatureFlags('payment-gateway', {
            ...ALL_OFF,
            enableCharts: true,
        });
        expect(result.errors[0].message).toContain('enableCharts');
        expect(result.errors[0].message).toContain('payment-gateway');
    });

    it('collects multiple errors when multiple unsupported flags are enabled', () => {
        // payment-gateway does not support enableCharts
        const result = validateFeatureFlags('payment-gateway', {
            ...ALL_OFF,
            enableCharts: true,
        });
        // Only enableCharts is unsupported for payment-gateway
        expect(result.errors.every((e) => e.code === 'UNSUPPORTED_FEATURE_FLAG')).toBe(true);
    });

    it('does not error when unsupported flag is false', () => {
        const result = validateFeatureFlags('payment-gateway', {
            ...ALL_OFF,
            enableCharts: false, // unsupported but false — OK
        });
        expect(result.valid).toBe(true);
    });

    describe('property: all-off is always valid', () => {
        it('holds for every family', () => {
            fc.assert(
                fc.property(arbFamily, (family) => {
                    const result = validateFeatureFlags(family, ALL_OFF);
                    expect(result.valid).toBe(true);
                })
            );
        });
    });

    describe('property: supported flags enabled never produce errors', () => {
        it('holds for every family', () => {
            fc.assert(
                fc.property(arbFamily, (family) => {
                    const supported = getSupportedFlags(family);
                    const features: FeatureConfig = {
                        enableCharts: supported.includes('enableCharts'),
                        enableTransactionHistory: supported.includes('enableTransactionHistory'),
                        enableAnalytics: supported.includes('enableAnalytics'),
                        enableNotifications: supported.includes('enableNotifications'),
                    };
                    const result = validateFeatureFlags(family, features);
                    expect(result.valid).toBe(true);
                })
            );
        });
    });
});

// ── buildFeatureFlagEnvVars ───────────────────────────────────────────────────

describe('buildFeatureFlagEnvVars', () => {
    it('includes all four env var keys', () => {
        const vars = buildFeatureFlagEnvVars('stellar-dex', ALL_ON);
        expect(vars).toHaveProperty('NEXT_PUBLIC_ENABLE_CHARTS');
        expect(vars).toHaveProperty('NEXT_PUBLIC_ENABLE_TRANSACTION_HISTORY');
        expect(vars).toHaveProperty('NEXT_PUBLIC_ENABLE_ANALYTICS');
        expect(vars).toHaveProperty('NEXT_PUBLIC_ENABLE_NOTIFICATIONS');
    });

    it('reflects true flags as "true" string', () => {
        const vars = buildFeatureFlagEnvVars('stellar-dex', ALL_ON);
        expect(vars['NEXT_PUBLIC_ENABLE_CHARTS']).toBe('true');
    });

    it('reflects false flags as "false" string', () => {
        const vars = buildFeatureFlagEnvVars('stellar-dex', ALL_OFF);
        expect(vars['NEXT_PUBLIC_ENABLE_CHARTS']).toBe('false');
    });

    it('forces unsupported flags to "false" even when enabled', () => {
        // enableCharts is not supported by payment-gateway
        const vars = buildFeatureFlagEnvVars('payment-gateway', ALL_ON);
        expect(vars['NEXT_PUBLIC_ENABLE_CHARTS']).toBe('false');
    });

    it('keeps supported flags at their configured value', () => {
        const vars = buildFeatureFlagEnvVars('payment-gateway', ALL_ON);
        // These are supported by payment-gateway
        expect(vars['NEXT_PUBLIC_ENABLE_TRANSACTION_HISTORY']).toBe('true');
        expect(vars['NEXT_PUBLIC_ENABLE_ANALYTICS']).toBe('true');
        expect(vars['NEXT_PUBLIC_ENABLE_NOTIFICATIONS']).toBe('true');
    });

    describe('property: all values are "true" or "false"', () => {
        it('holds for any family and config', () => {
            fc.assert(
                fc.property(arbFamily, arbFeatureConfig, (family, features) => {
                    const vars = buildFeatureFlagEnvVars(family, features);
                    for (const val of Object.values(vars)) {
                        expect(['true', 'false']).toContain(val);
                    }
                })
            );
        });
    });

    describe('property: unsupported flags are always "false"', () => {
        it('holds for any family and config', () => {
            fc.assert(
                fc.property(arbFamily, arbFeatureConfig, (family, features) => {
                    const unsupported = getUnsupportedFlags(family);
                    const vars = buildFeatureFlagEnvVars(family, features);
                    for (const key of unsupported) {
                        const envVar = FEATURE_FLAG_REGISTRY[key].envVar;
                        expect(vars[envVar]).toBe('false');
                    }
                })
            );
        });
    });
});

// ── generateFeatureFlagsFile ──────────────────────────────────────────────────

describe('generateFeatureFlagsFile', () => {
    it('exports featureFlags const', () => {
        const output = generateFeatureFlagsFile('stellar-dex', ALL_ON);
        expect(output).toContain('export const featureFlags');
    });

    it('exports default featureFlags', () => {
        const output = generateFeatureFlagsFile('stellar-dex', ALL_ON);
        expect(output).toContain('export default featureFlags');
    });

    it('includes template family in header comment', () => {
        const output = generateFeatureFlagsFile('stellar-dex', ALL_ON);
        expect(output).toContain('// Template: stellar-dex');
    });

    it('includes all four flag keys', () => {
        const output = generateFeatureFlagsFile('stellar-dex', ALL_ON);
        expect(output).toContain('enableCharts');
        expect(output).toContain('enableTransactionHistory');
        expect(output).toContain('enableAnalytics');
        expect(output).toContain('enableNotifications');
    });

    it('reads from env vars at runtime', () => {
        const output = generateFeatureFlagsFile('stellar-dex', ALL_ON);
        expect(output).toContain('process.env.NEXT_PUBLIC_ENABLE_CHARTS');
        expect(output).toContain('process.env.NEXT_PUBLIC_ENABLE_TRANSACTION_HISTORY');
    });

    it('bakes in true for enabled supported flags', () => {
        const output = generateFeatureFlagsFile('stellar-dex', ALL_ON);
        expect(output).toContain('|| true');
    });

    it('bakes in false for disabled flags', () => {
        const output = generateFeatureFlagsFile('stellar-dex', ALL_OFF);
        expect(output).toContain('|| false');
    });

    it('forces unsupported flags to false with a comment', () => {
        const output = generateFeatureFlagsFile('payment-gateway', ALL_ON);
        // enableCharts is unsupported — should be false and commented
        expect(output).toContain('Not supported by the "payment-gateway" template');
        const chartsLine = output.split('\n').find((l) => l.includes('enableCharts:'));
        expect(chartsLine).toContain('false');
    });

    it('satisfies as const satisfies Record<string, boolean>', () => {
        const output = generateFeatureFlagsFile('stellar-dex', ALL_ON);
        expect(output).toContain('as const satisfies Record<string, boolean>');
    });

    describe('property: output is deterministic', () => {
        it('same inputs always produce identical output', () => {
            fc.assert(
                fc.property(arbFamily, arbFeatureConfig, (family, features) => {
                    const a = generateFeatureFlagsFile(family, features);
                    const b = generateFeatureFlagsFile(family, features);
                    expect(a).toBe(b);
                })
            );
        });
    });

    describe('property: output always contains all flag keys', () => {
        it('holds for any family and config', () => {
            fc.assert(
                fc.property(arbFamily, arbFeatureConfig, (family, features) => {
                    const output = generateFeatureFlagsFile(family, features);
                    expect(output).toContain('enableCharts');
                    expect(output).toContain('enableTransactionHistory');
                    expect(output).toContain('enableAnalytics');
                    expect(output).toContain('enableNotifications');
                })
            );
        });
    });
});

// ── getSupportedFlags / getUnsupportedFlags ───────────────────────────────────

describe('getSupportedFlags', () => {
    it('returns all flags for stellar-dex', () => {
        const flags = getSupportedFlags('stellar-dex');
        expect(flags).toContain('enableCharts');
        expect(flags).toContain('enableTransactionHistory');
        expect(flags).toContain('enableAnalytics');
        expect(flags).toContain('enableNotifications');
    });

    it('excludes enableCharts for payment-gateway', () => {
        const flags = getSupportedFlags('payment-gateway');
        expect(flags).not.toContain('enableCharts');
    });

    it('returns non-empty array for every family', () => {
        for (const family of ALL_FAMILIES) {
            expect(getSupportedFlags(family).length).toBeGreaterThan(0);
        }
    });
});

describe('getUnsupportedFlags', () => {
    it('returns empty array for stellar-dex (all supported)', () => {
        expect(getUnsupportedFlags('stellar-dex')).toHaveLength(0);
    });

    it('returns enableCharts for payment-gateway', () => {
        const flags = getUnsupportedFlags('payment-gateway');
        expect(flags).toContain('enableCharts');
    });

    describe('property: supported + unsupported = all flags', () => {
        it('holds for every family', () => {
            fc.assert(
                fc.property(arbFamily, (family) => {
                    const supported = getSupportedFlags(family);
                    const unsupported = getUnsupportedFlags(family);
                    const all = [...supported, ...unsupported].sort();
                    const expected = Object.keys(FEATURE_FLAG_REGISTRY).sort();
                    expect(all).toEqual(expected);
                })
            );
        });
    });
});
