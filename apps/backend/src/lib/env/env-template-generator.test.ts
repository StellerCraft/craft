import { describe, it, expect } from 'vitest';
import {
    buildEnvVarEntries,
    renderEnvLocal,
    renderEnvExample,
    buildVercelEnvVars,
    SECRET_PLACEHOLDER,
} from './env-template-generator';
import type { CustomizationConfig } from '@craft/types';
import type { TemplateFamilyId } from '@/services/code-generator.service';

const baseConfig: CustomizationConfig = {
    branding: {
        appName: 'Test App',
        primaryColor: '#007bff',
        secondaryColor: '#6c757d',
        fontFamily: 'Inter',
    },
    stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
        assetPairs: [
            { code: 'XLM', issuer: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12' },
        ],
        contractAddresses: {
            router: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ12',
        },
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: false,
        enableAnalytics: true,
        enableNotifications: false,
    },
};

const testSecrets = {
    SUPABASE_SERVICE_ROLE_KEY: 'resolved-secret-key',
};

describe('env-template-generator', () => {
    describe('buildEnvVarEntries', () => {
        const families: TemplateFamilyId[] = [
            'stellar-dex',
            'soroban-defi',
            'payment-gateway',
            'asset-issuance',
        ];

        for (const family of families) {
            describe(`family: ${family}`, () => {
                it('includes required branding and stellar vars for all families', () => {
                    const entries = buildEnvVarEntries(family, baseConfig);
                    const keys = entries.map((e) => e.key);

                    expect(keys).toContain('NEXT_PUBLIC_APP_NAME');
                    expect(keys).toContain('NEXT_PUBLIC_PRIMARY_COLOR');
                    expect(keys).toContain('NEXT_PUBLIC_SECONDARY_COLOR');
                    expect(keys).toContain('NEXT_PUBLIC_FONT_FAMILY');
                    expect(keys).toContain('NEXT_PUBLIC_STELLAR_NETWORK');
                    expect(keys).toContain('NEXT_PUBLIC_HORIZON_URL');
                    expect(keys).toContain('NEXT_PUBLIC_NETWORK_PASSPHRASE');
                });

                it('public vars target all environments', () => {
                    const entries = buildEnvVarEntries(family, baseConfig);
                    const publicEntries = entries.filter((e) => !e.secret);

                    for (const entry of publicEntries) {
                        expect(entry.targets).toContain('production');
                        expect(entry.targets).toContain('preview');
                        expect(entry.targets).toContain('development');
                    }
                });

                it('secret vars target production and preview only', () => {
                    const entries = buildEnvVarEntries(family, baseConfig);
                    const secretEntries = entries.filter((e) => e.secret);

                    for (const entry of secretEntries) {
                        expect(entry.targets).toContain('production');
                        expect(entry.targets).toContain('preview');
                        expect(entry.targets).not.toContain('development');
                    }
                });
            });
        }

        describe('target scoping', () => {
            it('SUPABASE_SERVICE_ROLE_KEY is scoped to production and preview', () => {
                const entries = buildEnvVarEntries('stellar-dex', baseConfig);
                const secretEntry = entries.find((e) => e.key === 'SUPABASE_SERVICE_ROLE_KEY');

                expect(secretEntry).toBeDefined();
                expect(secretEntry!.secret).toBe(true);
                expect(secretEntry!.targets).toEqual(['production', 'preview']);
            });
        });

        describe('secret vs plain classification', () => {
            it('marks SUPABASE_SERVICE_ROLE_KEY as secret', () => {
                const entries = buildEnvVarEntries('stellar-dex', baseConfig);
                const entry = entries.find((e) => e.key === 'SUPABASE_SERVICE_ROLE_KEY');

                expect(entry).toBeDefined();
                expect(entry!.secret).toBe(true);
            });

            it('marks public variables as non-secret', () => {
                const entries = buildEnvVarEntries('stellar-dex', baseConfig);
                const publicKeys = entries.filter((e) => !e.secret).map((e) => e.key);

                expect(publicKeys).toContain('NEXT_PUBLIC_APP_NAME');
                expect(publicKeys).toContain('NEXT_PUBLIC_HORIZON_URL');
                expect(publicKeys).toContain('NEXT_PUBLIC_ENABLE_CHARTS');
            });
        });

        describe('family-specific overrides', () => {
            it('soroban-defi always includes NEXT_PUBLIC_SOROBAN_RPC_URL', () => {
                const entries = buildEnvVarEntries('soroban-defi', baseConfig);
                const keys = entries.map((e) => e.key);
                expect(keys).toContain('NEXT_PUBLIC_SOROBAN_RPC_URL');
            });

            it('stellar-dex includes asset pairs when configured', () => {
                const entries = buildEnvVarEntries('stellar-dex', baseConfig);
                const keys = entries.map((e) => e.key);
                expect(keys).toContain('NEXT_PUBLIC_ASSET_PAIRS');
            });

            it('soroban-defi includes contract addresses when configured', () => {
                const entries = buildEnvVarEntries('soroban-defi', baseConfig);
                const keys = entries.map((e) => e.key);
                expect(keys).toContain('NEXT_PUBLIC_CONTRACT_ADDRESSES');
            });
        });
    });

    describe('buildVercelEnvVars', () => {
        it('maps entries to Vercel-compatible format with plain type', () => {
            const vars = buildVercelEnvVars('stellar-dex', baseConfig, testSecrets);
            const publicVar = vars.find((v) => v.key === 'NEXT_PUBLIC_APP_NAME');

            expect(publicVar).toBeDefined();
            expect(publicVar!.type).toBe('plain');
            expect(publicVar!.target).toEqual(['production', 'preview', 'development']);
        });

        it('maps secret entries to encrypted type', () => {
            const vars = buildVercelEnvVars('stellar-dex', baseConfig, testSecrets);
            const secretVar = vars.find((v) => v.key === 'SUPABASE_SERVICE_ROLE_KEY');

            expect(secretVar).toBeDefined();
            expect(secretVar!.type).toBe('encrypted');
            expect(secretVar!.value).toBe('resolved-secret-key');
        });

        it('throws when a required secret is unresolved', () => {
            expect(() => buildVercelEnvVars('stellar-dex', baseConfig)).toThrow(
                /Missing required secret value/
            );
        });

        it('uses resolved secret value when provided', () => {
            const vars = buildVercelEnvVars('stellar-dex', baseConfig, {
                SUPABASE_SERVICE_ROLE_KEY: 'my-secret',
            });

            const secretVar = vars.find((v) => v.key === 'SUPABASE_SERVICE_ROLE_KEY');
            expect(secretVar!.value).toBe('my-secret');
        });
    });

    describe('renderEnvLocal', () => {
        it('renders a non-empty env file with header comments', () => {
            const output = renderEnvLocal('stellar-dex', baseConfig);

            expect(output).toContain('# Auto-generated by CRAFT Platform');
            expect(output).toContain('# Template: stellar-dex');
            expect(output).toContain('NEXT_PUBLIC_APP_NAME=');
            expect(output).toContain('NEXT_PUBLIC_HORIZON_URL=');
        });

        it('includes resolved values without placeholders', () => {
            const output = renderEnvLocal('stellar-dex', baseConfig);

            expect(output).toContain(`NEXT_PUBLIC_APP_NAME=${baseConfig.branding.appName}`);
            expect(output).toContain(`NEXT_PUBLIC_STELLAR_NETWORK=${baseConfig.stellar.network}`);
        });

        it('marks optional variables with comments', () => {
            const output = renderEnvLocal('stellar-dex', baseConfig);

            expect(output).toContain('# Optional');
        });
    });

    describe('renderEnvExample', () => {
        it('renders a non-empty env example with header comments', () => {
            const output = renderEnvExample('stellar-dex', baseConfig);

            expect(output).toContain('# Auto-generated by CRAFT Platform');
            expect(output).toContain('# Template: stellar-dex');
        });

        it('redacts secret values with placeholder', () => {
            const output = renderEnvExample('stellar-dex', baseConfig);

            expect(output).toContain(`SUPABASE_SERVICE_ROLE_KEY=${SECRET_PLACEHOLDER}`);
            expect(output).not.toContain('resolved-secret-key');
        });

        it('shows resolved values for public variables', () => {
            const output = renderEnvExample('stellar-dex', baseConfig);

            expect(output).toContain(`NEXT_PUBLIC_APP_NAME=${baseConfig.branding.appName}`);
        });

        it('marks secrets with [SECRET] tag', () => {
            const output = renderEnvExample('stellar-dex', baseConfig);

            expect(output).toContain('[SECRET]');
        });
    });
});
