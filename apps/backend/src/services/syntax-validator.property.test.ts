/**
 * Property 49 – Generated Code Syntax Validity
 *
 * "For any valid template and customization configuration, every generated
 *  .ts and .json file MUST be syntactically valid."
 *
 * Validates: Issue #069 — TypeScript syntax validation for generated projects
 *
 * Strategy
 * ────────
 * fast-check generates random CustomizationConfig values across the full
 * input space (all template families × all branding/feature/stellar combos).
 * For each generated file we run SyntaxValidator.validate() and assert
 * valid:true with no errors.
 *
 * Minimum 100 iterations (numRuns: 100).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CodeGeneratorService, type TemplateFamilyId } from './code-generator.service';
import { SyntaxValidator } from './syntax-validator';
import type { CustomizationConfig } from '@craft/types';

// ── Arbitraries (shared with code-generator property tests) ──────────────────

const TEMPLATE_FAMILIES: readonly TemplateFamilyId[] = [
    'stellar-dex',
    'soroban-defi',
    'payment-gateway',
    'asset-issuance',
];

const arbHexColor = fc
    .stringMatching(/^[0-9a-fA-F]{6}$/)
    .map((h) => `#${h}`);

const arbSafeString = fc.string({ minLength: 1, maxLength: 40 }).filter(
    (s) => !/[\x00-\x1f\x7f]/.test(s)
);

const arbNetwork = fc.constantFrom('mainnet' as const, 'testnet' as const);

const arbCustomizationConfig: fc.Arbitrary<CustomizationConfig> = fc.record({
    branding: fc.record({
        appName: arbSafeString,
        primaryColor: arbHexColor,
        secondaryColor: arbHexColor,
        fontFamily: arbSafeString,
    }),
    features: fc.record({
        enableCharts: fc.boolean(),
        enableTransactionHistory: fc.boolean(),
        enableAnalytics: fc.boolean(),
        enableNotifications: fc.boolean(),
    }),
    stellar: arbNetwork.chain((network) =>
        fc.record({
            network: fc.constant(network),
            horizonUrl: fc.constantFrom(
                'https://horizon-testnet.stellar.org',
                'https://horizon.stellar.org'
            ),
            sorobanRpcUrl: fc.option(
                fc.constantFrom('https://soroban-testnet.stellar.org'),
                { nil: undefined }
            ),
        })
    ),
});

// ── Property 49 ───────────────────────────────────────────────────────────────

describe('Property 49 – Generated Code Syntax Validity', () => {
    const codeGen = new CodeGeneratorService();
    const validator = new SyntaxValidator();

    it(
        '49-A: for any template family and config, all generated .ts files are syntactically valid',
        () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...TEMPLATE_FAMILIES),
                    arbCustomizationConfig,
                    (family, cfg) => {
                        const result = codeGen.generate({
                            templateId: family,
                            templateFamily: family,
                            customization: cfg,
                            outputPath: '/tmp/out',
                        });

                        expect(result.success).toBe(true);

                        for (const file of result.generatedFiles) {
                            if (!file.path.endsWith('.ts')) continue;
                            const validation = validator.validate(file);
                            expect(
                                validation.valid,
                                `Syntax error in ${file.path}: ${validation.errors.map((e) => e.message).join(', ')}`
                            ).toBe(true);
                            expect(validation.errors).toHaveLength(0);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        }
    );

    it(
        '49-B: for any template family and config, all generated .json files are syntactically valid',
        () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...TEMPLATE_FAMILIES),
                    arbCustomizationConfig,
                    (family, cfg) => {
                        const result = codeGen.generate({
                            templateId: family,
                            templateFamily: family,
                            customization: cfg,
                            outputPath: '/tmp/out',
                        });

                        expect(result.success).toBe(true);

                        for (const file of result.generatedFiles) {
                            if (!file.path.endsWith('.json')) continue;
                            const validation = validator.validate(file);
                            expect(
                                validation.valid,
                                `JSON parse error in ${file.path}: ${validation.errors.map((e) => e.message).join(', ')}`
                            ).toBe(true);
                            expect(validation.errors).toHaveLength(0);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        }
    );

    it(
        '49-C: SyntaxValidator.validate returns valid:true for every file in every generated workspace',
        () => {
            fc.assert(
                fc.property(
                    fc.constantFrom(...TEMPLATE_FAMILIES),
                    arbCustomizationConfig,
                    (family, cfg) => {
                        const result = codeGen.generate({
                            templateId: family,
                            templateFamily: family,
                            customization: cfg,
                            outputPath: '/tmp/out',
                        });

                        expect(result.success).toBe(true);

                        for (const file of result.generatedFiles) {
                            const validation = validator.validate(file);
                            expect(
                                validation.valid,
                                `Validation failed for ${file.path}: ${validation.errors.map((e) => e.message).join(', ')}`
                            ).toBe(true);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        }
    );
});
