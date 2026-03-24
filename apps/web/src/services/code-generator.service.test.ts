/**
 * Unit tests for CodeGeneratorService
 *
 * Covers each template family with representative generation inputs and
 * asserts that generated output includes required config, branding, and
 * dependency changes.
 *
 * Issue: #068 — write code generation tests and completeness proof
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    CodeGeneratorService,
    NETWORK_PASSPHRASE,
    DEFAULT_HORIZON_URL,
    type TemplateFamilyId,
} from './code-generator.service';
import type { CustomizationConfig } from '@craft/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<CustomizationConfig> = {}): CustomizationConfig {
    return {
        branding: {
            appName: 'Test App',
            primaryColor: '#ff0000',
            secondaryColor: '#00ff00',
            fontFamily: 'Roboto',
            ...overrides.branding,
        },
        features: {
            enableCharts: true,
            enableTransactionHistory: false,
            enableAnalytics: true,
            enableNotifications: false,
            ...overrides.features,
        },
        stellar: {
            network: 'testnet',
            horizonUrl: 'https://horizon-testnet.stellar.org',
            ...overrides.stellar,
        },
    };
}

function makeRequest(family: TemplateFamilyId, cfg: CustomizationConfig) {
    return { templateId: family, templateFamily: family, customization: cfg, outputPath: '/tmp/out' };
}

function getFile(files: { path: string; content: string }[], path: string) {
    const f = files.find((f) => f.path === path);
    if (!f) throw new Error(`File not found: ${path}`);
    return f.content;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CodeGeneratorService', () => {
    let svc: CodeGeneratorService;

    beforeEach(() => {
        svc = new CodeGeneratorService();
    });

    // ── generate() top-level ──────────────────────────────────────────────────

    describe('generate()', () => {
        it('returns success=true for a valid request', () => {
            const result = svc.generate(makeRequest('stellar-dex', makeConfig()));
            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('always produces at least config.ts, .env.local, and package.json', () => {
            const families: TemplateFamilyId[] = [
                'stellar-dex',
                'soroban-defi',
                'payment-gateway',
                'asset-issuance',
            ];
            for (const family of families) {
                const { generatedFiles } = svc.generate(makeRequest(family, makeConfig()));
                const paths = generatedFiles.map((f) => f.path);
                expect(paths).toContain('src/lib/config.ts');
                expect(paths).toContain('.env.local');
                expect(paths).toContain('package.json');
            }
        });

        it('all generated files have non-empty content', () => {
            const { generatedFiles } = svc.generate(makeRequest('stellar-dex', makeConfig()));
            for (const f of generatedFiles) {
                expect(f.content.trim().length).toBeGreaterThan(0);
            }
        });

        it('all generated files have a valid type field', () => {
            const { generatedFiles } = svc.generate(makeRequest('soroban-defi', makeConfig()));
            for (const f of generatedFiles) {
                expect(['code', 'config', 'asset']).toContain(f.type);
            }
        });
    });

    // ── Branding in config.ts ─────────────────────────────────────────────────

    describe('branding values in config.ts', () => {
        it('embeds appName', () => {
            const cfg = makeConfig({ branding: { appName: 'My DEX', primaryColor: '#abc', secondaryColor: '#def', fontFamily: 'Inter' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain("'My DEX'");
        });

        it('embeds primaryColor', () => {
            const cfg = makeConfig({ branding: { appName: 'X', primaryColor: '#123456', secondaryColor: '#fff', fontFamily: 'Inter' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('#123456');
        });

        it('embeds secondaryColor', () => {
            const cfg = makeConfig({ branding: { appName: 'X', primaryColor: '#fff', secondaryColor: '#abcdef', fontFamily: 'Inter' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('#abcdef');
        });

        it('embeds fontFamily', () => {
            const cfg = makeConfig({ branding: { appName: 'X', primaryColor: '#fff', secondaryColor: '#fff', fontFamily: 'Poppins' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('Poppins');
        });

        it('uses NEXT_PUBLIC_APP_NAME env var fallback pattern', () => {
            const cfg = makeConfig();
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('NEXT_PUBLIC_APP_NAME');
        });
    });

    // ── Stellar config in config.ts ───────────────────────────────────────────

    describe('Stellar network values in config.ts', () => {
        it('embeds testnet network', () => {
            const cfg = makeConfig({ stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain("'testnet'");
        });

        it('embeds mainnet network', () => {
            const cfg = makeConfig({ stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain("'mainnet'");
        });

        it('embeds horizonUrl', () => {
            const cfg = makeConfig({ stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('https://horizon.stellar.org');
        });

        it('embeds correct testnet network passphrase', () => {
            const cfg = makeConfig({ stellar: { network: 'testnet', horizonUrl: DEFAULT_HORIZON_URL.testnet } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain(NETWORK_PASSPHRASE.testnet);
        });

        it('embeds correct mainnet network passphrase', () => {
            const cfg = makeConfig({ stellar: { network: 'mainnet', horizonUrl: DEFAULT_HORIZON_URL.mainnet } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain(NETWORK_PASSPHRASE.mainnet);
        });

        it('includes NEXT_PUBLIC_STELLAR_NETWORK env var', () => {
            const cfg = makeConfig();
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('NEXT_PUBLIC_STELLAR_NETWORK');
        });

        it('includes NEXT_PUBLIC_HORIZON_URL env var', () => {
            const cfg = makeConfig();
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('NEXT_PUBLIC_HORIZON_URL');
        });
    });

    // ── Feature flags in config.ts ────────────────────────────────────────────

    describe('feature flags in config.ts', () => {
        it('reflects enableCharts=true', () => {
            const cfg = makeConfig({ features: { enableCharts: true, enableTransactionHistory: false, enableAnalytics: false, enableNotifications: false } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('enableCharts');
            expect(content).toContain('true');
        });

        it('reflects enableCharts=false', () => {
            const cfg = makeConfig({ features: { enableCharts: false, enableTransactionHistory: false, enableAnalytics: false, enableNotifications: false } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('enableCharts');
            expect(content).toContain('false');
        });

        it('includes all four feature flags', () => {
            const cfg = makeConfig();
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('enableCharts');
            expect(content).toContain('enableTransactionHistory');
            expect(content).toContain('enableAnalytics');
            expect(content).toContain('enableNotifications');
        });
    });

    // ── .env.local ────────────────────────────────────────────────────────────

    describe('.env.local', () => {
        it('contains all required NEXT_PUBLIC_ keys', () => {
            const cfg = makeConfig();
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, '.env.local');
            const required = [
                'NEXT_PUBLIC_APP_NAME',
                'NEXT_PUBLIC_PRIMARY_COLOR',
                'NEXT_PUBLIC_SECONDARY_COLOR',
                'NEXT_PUBLIC_FONT_FAMILY',
                'NEXT_PUBLIC_STELLAR_NETWORK',
                'NEXT_PUBLIC_HORIZON_URL',
                'NEXT_PUBLIC_NETWORK_PASSPHRASE',
                'NEXT_PUBLIC_ENABLE_CHARTS',
                'NEXT_PUBLIC_ENABLE_TRANSACTION_HISTORY',
                'NEXT_PUBLIC_ENABLE_ANALYTICS',
                'NEXT_PUBLIC_ENABLE_NOTIFICATIONS',
            ];
            for (const key of required) {
                expect(content, `Missing env key: ${key}`).toContain(key);
            }
        });

        it('includes NEXT_PUBLIC_SOROBAN_RPC_URL when sorobanRpcUrl is set', () => {
            const cfg = makeConfig({ stellar: { network: 'testnet', horizonUrl: DEFAULT_HORIZON_URL.testnet, sorobanRpcUrl: 'https://soroban-testnet.stellar.org' } });
            const content = getFile(svc.generate(makeRequest('soroban-defi', cfg)).generatedFiles, '.env.local');
            expect(content).toContain('NEXT_PUBLIC_SOROBAN_RPC_URL');
        });

        it('does not include NEXT_PUBLIC_SOROBAN_RPC_URL when sorobanRpcUrl is absent', () => {
            const cfg = makeConfig();
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, '.env.local');
            expect(content).not.toContain('NEXT_PUBLIC_SOROBAN_RPC_URL');
        });

        it('embeds actual branding values', () => {
            const cfg = makeConfig({ branding: { appName: 'PayApp', primaryColor: '#111', secondaryColor: '#222', fontFamily: 'Mono' } });
            const content = getFile(svc.generate(makeRequest('payment-gateway', cfg)).generatedFiles, '.env.local');
            expect(content).toContain('PayApp');
            expect(content).toContain('#111');
        });
    });

    // ── package.json ──────────────────────────────────────────────────────────

    describe('package.json', () => {
        it('includes stellar-sdk in dependencies', () => {
            const families: TemplateFamilyId[] = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'];
            for (const family of families) {
                const content = getFile(svc.generate(makeRequest(family, makeConfig())).generatedFiles, 'package.json');
                const pkg = JSON.parse(content);
                expect(pkg.dependencies['stellar-sdk'], `${family} missing stellar-sdk`).toBeDefined();
            }
        });

        it('is valid JSON', () => {
            const families: TemplateFamilyId[] = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'];
            for (const family of families) {
                const content = getFile(svc.generate(makeRequest(family, makeConfig())).generatedFiles, 'package.json');
                expect(() => JSON.parse(content)).not.toThrow();
            }
        });

        it('has required script fields', () => {
            const content = getFile(svc.generate(makeRequest('stellar-dex', makeConfig())).generatedFiles, 'package.json');
            const pkg = JSON.parse(content);
            expect(pkg.scripts.dev).toBeDefined();
            expect(pkg.scripts.build).toBeDefined();
            expect(pkg.scripts.start).toBeDefined();
        });

        it('soroban-defi includes @stellar/stellar-sdk', () => {
            const content = getFile(svc.generate(makeRequest('soroban-defi', makeConfig())).generatedFiles, 'package.json');
            const pkg = JSON.parse(content);
            expect(pkg.dependencies['@stellar/stellar-sdk']).toBeDefined();
        });
    });

    // ── Template family: stellar-dex ──────────────────────────────────────────

    describe('stellar-dex template family', () => {
        it('generates src/lib/stellar.ts', () => {
            const { generatedFiles } = svc.generate(makeRequest('stellar-dex', makeConfig()));
            expect(generatedFiles.map((f) => f.path)).toContain('src/lib/stellar.ts');
        });

        it('stellar.ts imports stellar-sdk', () => {
            const content = getFile(svc.generate(makeRequest('stellar-dex', makeConfig())).generatedFiles, 'src/lib/stellar.ts');
            expect(content).toContain("from 'stellar-sdk'");
        });

        it('stellar.ts exports loadAccount', () => {
            const content = getFile(svc.generate(makeRequest('stellar-dex', makeConfig())).generatedFiles, 'src/lib/stellar.ts');
            expect(content).toContain('loadAccount');
        });

        it('stellar.ts exports submitTransaction', () => {
            const content = getFile(svc.generate(makeRequest('stellar-dex', makeConfig())).generatedFiles, 'src/lib/stellar.ts');
            expect(content).toContain('submitTransaction');
        });

        it('stellar.ts includes error handling', () => {
            const content = getFile(svc.generate(makeRequest('stellar-dex', makeConfig())).generatedFiles, 'src/lib/stellar.ts');
            expect(content).toContain('throw new Error');
        });

        it('does NOT generate soroban.ts', () => {
            const { generatedFiles } = svc.generate(makeRequest('stellar-dex', makeConfig()));
            expect(generatedFiles.map((f) => f.path)).not.toContain('src/lib/soroban.ts');
        });
    });

    // ── Template family: soroban-defi ─────────────────────────────────────────

    describe('soroban-defi template family', () => {
        it('generates src/lib/soroban.ts', () => {
            const { generatedFiles } = svc.generate(makeRequest('soroban-defi', makeConfig()));
            expect(generatedFiles.map((f) => f.path)).toContain('src/lib/soroban.ts');
        });

        it('soroban.ts imports SorobanRpc', () => {
            const content = getFile(svc.generate(makeRequest('soroban-defi', makeConfig())).generatedFiles, 'src/lib/soroban.ts');
            expect(content).toContain('SorobanRpc');
        });

        it('soroban.ts exports invokeContract', () => {
            const content = getFile(svc.generate(makeRequest('soroban-defi', makeConfig())).generatedFiles, 'src/lib/soroban.ts');
            expect(content).toContain('invokeContract');
        });

        it('config.ts includes sorobanRpcUrl when provided', () => {
            const cfg = makeConfig({ stellar: { network: 'testnet', horizonUrl: DEFAULT_HORIZON_URL.testnet, sorobanRpcUrl: 'https://soroban-testnet.stellar.org' } });
            const content = getFile(svc.generate(makeRequest('soroban-defi', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('sorobanRpcUrl');
            expect(content).toContain('NEXT_PUBLIC_SOROBAN_RPC_URL');
        });

        it('config.ts includes default sorobanRpcUrl for soroban-defi even without explicit config', () => {
            const cfg = makeConfig(); // no sorobanRpcUrl
            const content = getFile(svc.generate(makeRequest('soroban-defi', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('sorobanRpcUrl');
        });
    });

    // ── Template family: payment-gateway ─────────────────────────────────────

    describe('payment-gateway template family', () => {
        it('generates src/lib/payment.ts', () => {
            const { generatedFiles } = svc.generate(makeRequest('payment-gateway', makeConfig()));
            expect(generatedFiles.map((f) => f.path)).toContain('src/lib/payment.ts');
        });

        it('payment.ts exports sendPayment', () => {
            const content = getFile(svc.generate(makeRequest('payment-gateway', makeConfig())).generatedFiles, 'src/lib/payment.ts');
            expect(content).toContain('sendPayment');
        });

        it('payment.ts uses stellar-sdk Operation.payment', () => {
            const content = getFile(svc.generate(makeRequest('payment-gateway', makeConfig())).generatedFiles, 'src/lib/payment.ts');
            expect(content).toContain('Operation.payment');
        });

        it('payment.ts imports stellar-sdk', () => {
            const content = getFile(svc.generate(makeRequest('payment-gateway', makeConfig())).generatedFiles, 'src/lib/payment.ts');
            expect(content).toContain("from 'stellar-sdk'");
        });
    });

    // ── Template family: asset-issuance ───────────────────────────────────────

    describe('asset-issuance template family', () => {
        it('generates src/lib/asset.ts', () => {
            const { generatedFiles } = svc.generate(makeRequest('asset-issuance', makeConfig()));
            expect(generatedFiles.map((f) => f.path)).toContain('src/lib/asset.ts');
        });

        it('asset.ts exports issueAsset', () => {
            const content = getFile(svc.generate(makeRequest('asset-issuance', makeConfig())).generatedFiles, 'src/lib/asset.ts');
            expect(content).toContain('issueAsset');
        });

        it('asset.ts uses StellarSdk.Asset', () => {
            const content = getFile(svc.generate(makeRequest('asset-issuance', makeConfig())).generatedFiles, 'src/lib/asset.ts');
            expect(content).toContain('StellarSdk.Asset');
        });

        it('asset.ts imports stellar-sdk', () => {
            const content = getFile(svc.generate(makeRequest('asset-issuance', makeConfig())).generatedFiles, 'src/lib/asset.ts');
            expect(content).toContain("from 'stellar-sdk'");
        });
    });

    // ── Edge cases ────────────────────────────────────────────────────────────

    describe('edge cases', () => {
        it('handles appName with single quotes without breaking config.ts syntax', () => {
            const cfg = makeConfig({ branding: { appName: "O'Brien's DEX", primaryColor: '#fff', secondaryColor: '#000', fontFamily: 'Inter' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            // Should not contain unescaped single quote that would break JS string
            const appNameLine = content.split('\n').find((l) => l.includes('appName'));
            expect(appNameLine).toBeDefined();
            // The line should be parseable — no raw unescaped ' inside the string literal
            expect(appNameLine).toContain("\\'");
        });

        it('handles empty appName gracefully', () => {
            const cfg = makeConfig({ branding: { appName: '', primaryColor: '#fff', secondaryColor: '#000', fontFamily: 'Inter' } });
            const result = svc.generate(makeRequest('stellar-dex', cfg));
            expect(result.success).toBe(true);
        });

        it('mainnet config uses correct horizon URL and passphrase', () => {
            const cfg = makeConfig({ stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' } });
            const content = getFile(svc.generate(makeRequest('stellar-dex', cfg)).generatedFiles, 'src/lib/config.ts');
            expect(content).toContain('https://horizon.stellar.org');
            expect(content).toContain(NETWORK_PASSPHRASE.mainnet);
            // The network value itself should be 'mainnet', not 'testnet'
            expect(content).toContain("|| 'mainnet'");
        });
    });
});
