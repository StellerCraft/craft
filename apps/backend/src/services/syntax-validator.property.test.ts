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
import type { GeneratedFile } from '@craft/types';

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

// ── Direct SyntaxValidator property tests (Issue #735) ───────────────────────

const safeIdentifier = fc
    .stringOf(
        fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
        { minLength: 1, maxLength: 12 }
    )
    .filter(s => !['if', 'else', 'for', 'let', 'const', 'var', 'return', 'function', 'class'].includes(s));

const arbLiteral = fc.oneof(
    fc.integer({ min: 0, max: 9999 }).map(n => String(n)),
    fc.constantFrom('"hello"', '"world"', 'true', 'false', 'null'),
);

function makeFile(path: string, content: string): GeneratedFile {
    return { path, content };
}

describe('SyntaxValidator – direct property-based classification (Issue #735)', () => {
    const validator = new SyntaxValidator();

    // Property A: valid TypeScript snippets always classify as valid
    describe('Property A — valid TS snippets return { valid: true }', () => {
        it('A1: const declarations with safe identifiers are always valid', () => {
            fc.assert(
                fc.property(safeIdentifier, arbLiteral, (name, value) => {
                    const content = `const ${name} = ${value};\n`;
                    const result = validator.validate(makeFile('test.ts', content));
                    expect(result.valid).toBe(true);
                    expect(result.errors).toHaveLength(0);
                }),
                { numRuns: 500 }
            );
        });

        it('A2: function declarations with a body are always valid', () => {
            fc.assert(
                fc.property(safeIdentifier, arbLiteral, (name, value) => {
                    const content = `function ${name}(): number { return ${value}; }\n`;
                    const result = validator.validate(makeFile('fn.ts', content));
                    expect(result.valid).toBe(true);
                    expect(result.errors).toHaveLength(0);
                }),
                { numRuns: 500 }
            );
        });

        it('A3: arrow functions assigned to const are always valid', () => {
            fc.assert(
                fc.property(safeIdentifier, arbLiteral, (fn, value) => {
                    const content = `const ${fn} = (): number => ${value};\n`;
                    const result = validator.validate(makeFile('arrow.ts', content));
                    expect(result.valid).toBe(true);
                    expect(result.errors).toHaveLength(0);
                }),
                { numRuns: 500 }
            );
        });

        it('A4: interface declarations with one typed field are always valid', () => {
            fc.assert(
                fc.property(safeIdentifier, safeIdentifier, (iface, field) => {
                    const content = `interface ${iface} { ${field}: string; }\n`;
                    const result = validator.validate(makeFile('iface.ts', content));
                    expect(result.valid).toBe(true);
                    expect(result.errors).toHaveLength(0);
                }),
                { numRuns: 500 }
            );
        });
    });

    // Property B: snippets with mismatched braces always classify as invalid
    describe('Property B — mismatched braces return { valid: false }', () => {
        it('B1: unclosed function body (missing closing brace) is always invalid', () => {
            fc.assert(
                fc.property(safeIdentifier, arbLiteral, (name, value) => {
                    const content = `function ${name}() { return ${value};\n`;
                    const result = validator.validate(makeFile('bad.ts', content));
                    expect(result.valid).toBe(false);
                    expect(result.errors.length).toBeGreaterThan(0);
                }),
                { numRuns: 500 }
            );
        });

        it('B2: stray closing brace with no matching open is always invalid', () => {
            fc.assert(
                fc.property(safeIdentifier, arbLiteral, (name, value) => {
                    const content = `const ${name} = ${value}; }`;
                    const result = validator.validate(makeFile('extra.ts', content));
                    expect(result.valid).toBe(false);
                    expect(result.errors.length).toBeGreaterThan(0);
                }),
                { numRuns: 500 }
            );
        });

        it('B3: unclosed object literal assigned to const is always invalid', () => {
            fc.assert(
                fc.property(safeIdentifier, (name) => {
                    const content = `const ${name} = {`;
                    const result = validator.validate(makeFile('obj.ts', content));
                    expect(result.valid).toBe(false);
                }),
                { numRuns: 500 }
            );
        });
    });

    // Property C: JSON validation – valid vs invalid
    describe('Property C — JSON validation classification', () => {
        it('C1: well-formed JSON objects always validate as valid', () => {
            fc.assert(
                fc.property(
                    fc.dictionary(
                        fc.string({ minLength: 1, maxLength: 10 }),
                        fc.oneof(fc.string(), fc.integer(), fc.boolean()),
                    ),
                    (obj) => {
                        const content = JSON.stringify(obj);
                        const result = validator.validate(makeFile('data.json', content));
                        expect(result.valid).toBe(true);
                        expect(result.errors).toHaveLength(0);
                    }
                ),
                { numRuns: 500 }
            );
        });

        it('C2: truncated JSON always fails validation', () => {
            fc.assert(
                fc.property(
                    fc.dictionary(
                        fc.string({ minLength: 1, maxLength: 10 }),
                        fc.string({ minLength: 1, maxLength: 10 }),
                        { minKeys: 1 }
                    ),
                    fc.integer({ min: 1, max: 5 }),
                    (obj, cutFrom) => {
                        const full = JSON.stringify(obj);
                        const truncated = full.slice(0, full.length - cutFrom);
                        const result = validator.validate(makeFile('data.json', truncated));
                        expect(result.valid).toBe(false);
                        expect(result.errors.length).toBeGreaterThan(0);
                    }
                ),
                { numRuns: 500 }
            );
        });
    });

    // Performance: 1MB TypeScript file must validate in < 500ms
    describe('Performance — 1MB TypeScript file validates in under 500ms', () => {
        it('validates a 1MB TypeScript file in < 500ms', () => {
            const lineTemplate = (i: number) =>
                `const variable_${i.toString().padStart(8, '0')} = ${i}; // auto-generated line\n`;
            let code = '';
            let i = 0;
            while (code.length < 1024 * 1024) {
                code += lineTemplate(i++);
            }

            const file = makeFile('large.ts', code);
            const start = Date.now();
            const result = validator.validate(file);
            const elapsed = Date.now() - start;

            expect(result.valid).toBe(true);
            expect(elapsed).toBeLessThan(500);
        });
    });
});
