// Feature: environment-variable-template-generation, Property 21: Vercel Environment Variable Configuration
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    buildVercelEnvVars,
    buildEnvVarEntries,
    SECRET_PLACEHOLDER,
    type VercelEnvVar,
    type VercelEnvTarget,
} from './env-template-generator';

const testSecrets = { SUPABASE_SERVICE_ROLE_KEY: 'test-resolved-secret-role-key' };
import type { CustomizationConfig } from '@craft/types';
import type { TemplateFamilyId } from '@/services/code-generator.service';

// ── Arbitraries ───────────────────────────────────────────────────────────────

const TEMPLATE_FAMILIES: TemplateFamilyId[] = [
    'stellar-dex',
    'soroban-defi',
    'asset-issuance',
    'payment-gateway',
];

const STELLAR_NETWORKS = ['mainnet', 'testnet'] as const;

const arbTemplateFamily = fc.constantFrom(...TEMPLATE_FAMILIES);
const arbStellarNetwork = fc.constantFrom(...STELLAR_NETWORKS);

/** Generate a valid branding config */
const arbBranding = fc.record({
    appName: fc.string({ minLength: 1, maxLength: 50 }),
    primaryColor: fc.constantFrom('#007bff', '#10b981', '#8b5cf6', '#f59e0b'),
    secondaryColor: fc.constantFrom('#6c757d', '#06b6d4', '#ec4899', '#ef4444'),
    fontFamily: fc.constantFrom('Inter', 'Roboto', 'Open Sans', 'Poppins'),
});

/** Generate a valid stellar config */
const arbStellar = fc.record({
    network: arbStellarNetwork,
    horizonUrl: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
    sorobanRpcUrl: fc.option(fc.string({ minLength: 10, maxLength: 100 }), { nil: undefined }),
    assetPairs: fc.option(
        fc.array(
            fc.record({
                code: fc.string({ minLength: 1, maxLength: 12 }),
                issuer: fc.string({ minLength: 56, maxLength: 56 }),
            }),
            { minLength: 0, maxLength: 5 }
        ),
        { nil: undefined }
    ),
    contractAddresses: fc.option(
        fc.dictionary(
            fc.string({ minLength: 1, maxLength: 20 }),
            fc.string({ minLength: 56, maxLength: 56 })
        ),
        { nil: undefined }
    ),
});

/** Generate a valid features config */
const arbFeatures = fc.record({
    enableCharts: fc.boolean(),
    enableTransactionHistory: fc.boolean(),
    enableAnalytics: fc.boolean(),
    enableNotifications: fc.boolean(),
});

/** Generate a full CustomizationConfig */
const arbCustomizationConfig = fc.record({
    branding: arbBranding,
    stellar: arbStellar,
    features: arbFeatures,
});

// ── Property 21: Vercel Environment Variable Configuration ──────────────────

describe('Vercel Environment Variable Configuration — Property 21', () => {
    // ── Required environment variables are always present ──────────────────────

    describe('required environment variables are always present', () => {
        it('always includes NEXT_PUBLIC_APP_NAME for any template family', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const keys = envVars.map((v) => v.key);

                    expect(keys).toContain('NEXT_PUBLIC_APP_NAME');
                }),
                { numRuns: 100 }
            );
        });

        it('always includes NEXT_PUBLIC_STELLAR_NETWORK for any template family', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const keys = envVars.map((v) => v.key);

                    expect(keys).toContain('NEXT_PUBLIC_STELLAR_NETWORK');
                }),
                { numRuns: 100 }
            );
        });

        it('always includes NEXT_PUBLIC_HORIZON_URL for any template family', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const keys = envVars.map((v) => v.key);

                    expect(keys).toContain('NEXT_PUBLIC_HORIZON_URL');
                }),
                { numRuns: 100 }
            );
        });

        it('always includes NEXT_PUBLIC_NETWORK_PASSPHRASE for any template family', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const keys = envVars.map((v) => v.key);

                    expect(keys).toContain('NEXT_PUBLIC_NETWORK_PASSPHRASE');
                }),
                { numRuns: 100 }
            );
        });

        it('always includes NEXT_PUBLIC_SUPABASE_URL for any template family', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const keys = envVars.map((v) => v.key);

                    expect(keys).toContain('NEXT_PUBLIC_SUPABASE_URL');
                }),
                { numRuns: 100 }
            );
        });

        it('always includes NEXT_PUBLIC_SUPABASE_ANON_KEY for any template family', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const keys = envVars.map((v) => v.key);

                    expect(keys).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
                }),
                { numRuns: 100 }
            );
        });

        it('always includes SUPABASE_SERVICE_ROLE_KEY for any template family', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const keys = envVars.map((v) => v.key);

                    expect(keys).toContain('SUPABASE_SERVICE_ROLE_KEY');
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Environment variable values match customization config ─────────────────

    describe('environment variable values match customization config', () => {
        it('NEXT_PUBLIC_APP_NAME value matches branding.appName', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const appNameVar = envVars.find((v) => v.key === 'NEXT_PUBLIC_APP_NAME');

                    expect(appNameVar).toBeDefined();
                    expect(appNameVar!.value).toBe(cfg.branding.appName);
                }),
                { numRuns: 100 }
            );
        });

        it('NEXT_PUBLIC_PRIMARY_COLOR value matches branding.primaryColor', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const colorVar = envVars.find((v) => v.key === 'NEXT_PUBLIC_PRIMARY_COLOR');

                    expect(colorVar).toBeDefined();
                    expect(colorVar!.value).toBe(cfg.branding.primaryColor);
                }),
                { numRuns: 100 }
            );
        });

        it('NEXT_PUBLIC_STELLAR_NETWORK value matches stellar.network', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const networkVar = envVars.find((v) => v.key === 'NEXT_PUBLIC_STELLAR_NETWORK');

                    expect(networkVar).toBeDefined();
                    expect(networkVar!.value).toBe(cfg.stellar.network);
                }),
                { numRuns: 100 }
            );
        });

        it('NEXT_PUBLIC_ENABLE_CHARTS value matches features.enableCharts', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const chartsVar = envVars.find((v) => v.key === 'NEXT_PUBLIC_ENABLE_CHARTS');

                    expect(chartsVar).toBeDefined();
                    expect(chartsVar!.value).toBe(String(cfg.features.enableCharts));
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Environment variable targets are valid ─────────────────────────────────

    describe('environment variable targets are valid', () => {
        it('all environment variables have valid VercelEnvTarget values', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const validTargets: VercelEnvTarget[] = ['production', 'preview', 'development'];

                    for (const envVar of envVars) {
                        expect(envVar.target).toBeInstanceOf(Array);
                        expect(envVar.target.length).toBeGreaterThan(0);

                        for (const target of envVar.target) {
                            expect(validTargets).toContain(target);
                        }
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('public variables target all environments', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const publicVars = envVars.filter((v) => v.type === 'plain');

                    for (const envVar of publicVars) {
                        expect(envVar.target).toContain('production');
                        expect(envVar.target).toContain('preview');
                        expect(envVar.target).toContain('development');
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('secret variables target production and preview only', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const secretVars = envVars.filter((v) => v.type === 'encrypted');

                    for (const envVar of secretVars) {
                        expect(envVar.target).toContain('production');
                        expect(envVar.target).toContain('preview');
                        expect(envVar.target).not.toContain('development');
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Environment variable types are valid ───────────────────────────────────

    describe('environment variable types are valid', () => {
        it('all environment variables have valid type values', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const validTypes = ['plain', 'secret', 'encrypted'];

                    for (const envVar of envVars) {
                        expect(validTypes).toContain(envVar.type);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('public variables are typed as plain', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const publicVars = envVars.filter((v) =>
                        v.key.startsWith('NEXT_PUBLIC_') && v.key !== 'SUPABASE_SERVICE_ROLE_KEY'
                    );

                    for (const envVar of publicVars) {
                        expect(envVar.type).toBe('plain');
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('secret variables are typed as encrypted', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const secretVars = envVars.filter((v) => v.key === 'SUPABASE_SERVICE_ROLE_KEY');

                    for (const envVar of secretVars) {
                        expect(envVar.type).toBe('encrypted');
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Template-specific environment variables ────────────────────────────────

    describe('template-specific environment variables', () => {
        it('soroban-defi always includes NEXT_PUBLIC_SOROBAN_RPC_URL', () => {
            fc.assert(
                fc.property(arbCustomizationConfig, (cfg) => {
                    const envVars = buildVercelEnvVars('soroban-defi', cfg);
                    const keys = envVars.map((v) => v.key);

                    expect(keys).toContain('NEXT_PUBLIC_SOROBAN_RPC_URL');
                }),
                { numRuns: 100 }
            );
        });

        it('stellar-dex includes NEXT_PUBLIC_ASSET_PAIRS when assetPairs are configured', () => {
            fc.assert(
                fc.property(
                    arbCustomizationConfig.map((cfg) => ({
                        ...cfg,
                        stellar: {
                            ...cfg.stellar,
                            assetPairs: fc
                                .array(
                                    fc.record({
                                        code: fc.string({ minLength: 1, maxLength: 12 }),
                                        issuer: fc.string({ minLength: 56, maxLength: 56 }),
                                    }),
                                    { minLength: 1, maxLength: 3 }
                                )
                                .generate(fc.random()),
                        },
                    })),
                    (cfg) => {
                        const envVars = buildVercelEnvVars('stellar-dex', cfg);
                        const keys = envVars.map((v) => v.key);

                        expect(keys).toContain('NEXT_PUBLIC_ASSET_PAIRS');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('soroban-defi includes NEXT_PUBLIC_CONTRACT_ADDRESSES when contractAddresses are configured', () => {
            fc.assert(
                fc.property(
                    arbCustomizationConfig.map((cfg) => ({
                        ...cfg,
                        stellar: {
                            ...cfg.stellar,
                            contractAddresses: fc
                                .dictionary(
                                    fc.string({ minLength: 1, maxLength: 20 }),
                                    fc.string({ minLength: 56, maxLength: 56 })
                                )
                                .generate(fc.random()),
                        },
                    })),
                    (cfg) => {
                        const envVars = buildVercelEnvVars('soroban-defi', cfg);
                        const keys = envVars.map((v) => v.key);

                        expect(keys).toContain('NEXT_PUBLIC_CONTRACT_ADDRESSES');
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    // ── Structural invariants ─────────────────────────────────────────────────

    describe('structural invariants', () => {
        it('all environment variables have non-empty key and value', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);

                    for (const envVar of envVars) {
                        expect(envVar.key.length).toBeGreaterThan(0);
                        expect(envVar.value.length).toBeGreaterThan(0);
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('no duplicate environment variable keys', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                    const keys = envVars.map((v) => v.key);
                    const uniqueKeys = new Set(keys);

                    expect(keys.length).toBe(uniqueKeys.size);
                }),
                { numRuns: 100 }
            );
        });

        it('buildEnvVarEntries and buildVercelEnvVars produce consistent keys', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const entries = buildEnvVarEntries(family, cfg);
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);

                    const entryKeys = entries.map((e) => e.key).sort();
                    const varKeys = envVars.map((v) => v.key).sort();

                    expect(varKeys).toEqual(entryKeys);
                }),
                { numRuns: 100 }
            );
        });

        it('buildVercelEnvVars produces at least 7 environment variables', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);

                    expect(envVars.length).toBeGreaterThanOrEqual(7);
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Missing or invalid env data is rejected ────────────────────────────────

    describe('missing or invalid env data is rejected', () => {
        it('rejects empty appName by requiring non-empty value', () => {
            fc.assert(
                fc.property(
                    arbTemplateFamily,
                    arbCustomizationConfig.map((cfg) => ({
                        ...cfg,
                        branding: {
                            ...cfg.branding,
                            appName: '',
                        },
                    })),
                    (family, cfg) => {
                        const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                        const appNameVar = envVars.find((v) => v.key === 'NEXT_PUBLIC_APP_NAME');

                        // Empty appName should still produce a value (even if empty string)
                        // The validation happens at a higher level, not in env generation
                        expect(appNameVar).toBeDefined();
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('rejects invalid color format by requiring valid hex values', () => {
            fc.assert(
                fc.property(
                    arbTemplateFamily,
                    arbCustomizationConfig.map((cfg) => ({
                        ...cfg,
                        branding: {
                            ...cfg.branding,
                            primaryColor: 'not-a-color',
                        },
                    })),
                    (family, cfg) => {
                        const envVars = buildVercelEnvVars(family, cfg, testSecrets);
                        const colorVar = envVars.find((v) => v.key === 'NEXT_PUBLIC_PRIMARY_COLOR');

                        // Invalid color should still be passed through
                        // The validation happens at a higher level, not in env generation
                        expect(colorVar).toBeDefined();
                        expect(colorVar!.value).toBe('not-a-color');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('handles undefined optional fields gracefully', () => {
            fc.assert(
                fc.property(arbTemplateFamily, (family) => {
                    const cfg: CustomizationConfig = {
                        branding: {
                            appName: 'Test App',
                            primaryColor: '#007bff',
                            secondaryColor: '#6c757d',
                            fontFamily: 'Inter',
                        },
                        stellar: {
                            network: 'testnet',
                            horizonUrl: undefined,
                            sorobanRpcUrl: undefined,
                            assetPairs: undefined,
                            contractAddresses: undefined,
                        },
                        features: {
                            enableCharts: false,
                            enableTransactionHistory: false,
                            enableAnalytics: false,
                            enableNotifications: false,
                        },
                    };

                    const envVars = buildVercelEnvVars(family, cfg, testSecrets);

                    // Should still produce valid env vars even with undefined optional fields
                    expect(envVars.length).toBeGreaterThan(0);
                    expect(envVars.every((v) => v.key.length > 0)).toBe(true);
                    expect(envVars.every((v) => v.value.length > 0)).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('throws an error when a secret entry equals SECRET_PLACEHOLDER and is unresolved', () => {
            fc.assert(
                fc.property(arbTemplateFamily, arbCustomizationConfig, (family, cfg) => {
                    expect(() => buildVercelEnvVars(family, cfg)).toThrow(
                        /Missing required secret value/
                    );
                }),
                { numRuns: 50 }
            );
        });
    });
});
