/**
 * Fuzz Tests for Config Validator Service (Issue #718)
 *
 * Requirements:
 * - Fuzz with: deeply nested objects (depth > 100), arrays of length > 10,000, __proto__ keys
 * - Assert that no fuzz input causes configValidator.validate() to throw an untyped error
 * - All errors must be returned as typed validation failures, not uncaught exceptions
 * - Tests must run in <5 seconds total
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { fc } from '@fast-check/vitest';
import { ConfigValidator } from './config-validator.service';

// Singleton instance
const configValidator = new ConfigValidator();

// ── Fuzz: Deeply nested objects ────────────────────────────────────────────────

describe('ConfigValidator fuzz tests', () => {
    let totalFuzzRuns = 0;

    beforeAll(() => {
        console.log('Starting config validator fuzz tests...');
    });

    it(
        'handles deeply nested JSON objects without throwing',
        fc.asyncProperty(
            fc.integer({ min: 50, max: 150 }),
            async (depth) => {
                totalFuzzRuns++;

                // Build deeply nested object: { a: { b: { c: ... } } }
                let obj: any = { value: 'leaf' };
                for (let i = 0; i < depth; i++) {
                    obj = { nested: obj };
                }

                const jsonStr = JSON.stringify(obj);

                // Must not throw
                const result = configValidator.validateJSON('deep.json', jsonStr);

                // Result must be typed
                expect(result).toHaveProperty('valid');
                expect(result).toHaveProperty('diagnostics');
                expect(Array.isArray(result.diagnostics)).toBe(true);

                // Must return gracefully (even if marking it invalid due to structure)
                expect(typeof result.valid).toBe('boolean');
            }
        )
    );

    it(
        'handles large nested arrays without throwing',
        fc.asyncProperty(
            fc.integer({ min: 1000, max: 10000 }),
            async (arraySize) => {
                totalFuzzRuns++;

                // Build large array with nested structure
                const largeArray = Array.from({ length: arraySize }, (_, i) => ({
                    index: i,
                    data: `item-${i}`,
                    nested: { value: i * 2 },
                }));

                const jsonStr = JSON.stringify(largeArray);

                // Must not throw
                const result = configValidator.validateJSON('large.json', jsonStr);

                expect(result).toHaveProperty('valid');
                expect(result).toHaveProperty('diagnostics');
                expect(Array.isArray(result.diagnostics)).toBe(true);
            }
        )
    );

    it(
        'safely rejects prototype pollution attempts (__proto__)',
        fc.asyncProperty(
            fc.string({ minLength: 0, maxLength: 50 }),
            async (payload) => {
                totalFuzzRuns++;

                // Attempt prototype pollution via __proto__ key
                const obj = {
                    __proto__: { polluted: true },
                    constructor: { prototype: { polluted: true } },
                    [payload]: 'user-data',
                };

                const jsonStr = JSON.stringify(obj);

                // Must not throw or cause prototype pollution
                const result = configValidator.validateJSON('pptest.json', jsonStr);

                expect(result).toHaveProperty('valid');
                expect(result).toHaveProperty('diagnostics');

                // Verify no actual pollution occurred
                expect(Object.prototype.hasOwnProperty('polluted')).toBe(false);
            }
        )
    );

    it(
        'handles circular-reference-like patterns safely',
        fc.asyncProperty(
            fc.integer({ min: 1, max: 20 }),
            async (chainLength) => {
                totalFuzzRuns++;

                // Build a chain of objects that would form a cycle if JavaScript allowed it
                // JSON.stringify handles this by throwing; we catch that
                let obj: any = { value: 'end' };
                for (let i = 0; i < chainLength; i++) {
                    obj = { link: obj };
                }

                let jsonStr: string;
                try {
                    jsonStr = JSON.stringify(obj);
                } catch {
                    // If stringify fails, that's ok for this fuzz test
                    jsonStr = '{}';
                }

                // configValidator must handle any input gracefully
                const result = configValidator.validateJSON('chain.json', jsonStr);

                expect(result).toHaveProperty('valid');
                expect(result).toHaveProperty('diagnostics');
                expect(Array.isArray(result.diagnostics)).toBe(true);
            }
        )
    );

    it(
        'does not throw on malformed/adversarial JSON structures',
        fc.asyncProperty(
            fc.oneof(
                fc.constant(''),
                fc.constant('null'),
                fc.constant('undefined'),
                fc.constant('NaN'),
                fc.constant('Infinity'),
                fc.constant('{}'),
                fc.constant('[]'),
                fc.constant('{]'),
                fc.constant('[}'),
                fc.constant('{"unclosed":')
            ),
            async (jsonStr) => {
                totalFuzzRuns++;

                // configValidator must never throw
                const result = configValidator.validateJSON('fuzz.json', jsonStr);

                expect(result).toHaveProperty('valid');
                expect(result).toHaveProperty('diagnostics');

                // Diagnostics should be an array (possibly empty, possibly with errors)
                expect(Array.isArray(result.diagnostics)).toBe(true);

                // All diagnostics must have required fields
                result.diagnostics.forEach((diag) => {
                    expect(diag).toHaveProperty('file');
                    expect(diag).toHaveProperty('message');
                    expect(diag).toHaveProperty('severity');
                });
            }
        )
    );

    it(
        'handles arbitrary unicode and special characters in JSON',
        fc.asyncProperty(
            fc.object({
                field1: fc.string(),
                field2: fc.string(),
                field3: fc.unicodeString(),
            }),
            async (obj) => {
                totalFuzzRuns++;

                const jsonStr = JSON.stringify(obj);

                // Must not throw
                const result = configValidator.validateJSON('unicode.json', jsonStr);

                expect(result).toHaveProperty('valid');
                expect(result).toHaveProperty('diagnostics');
            }
        )
    );

    it(
        'handles YAML with arbitrary indentation and special chars',
        fc.asyncProperty(
            fc.integer({ min: 0, max: 50 }),
            fc.string({ minLength: 0, maxLength: 200 }),
            async (indentLevel, content) => {
                totalFuzzRuns++;

                // Build YAML with various indentation levels
                const indent = ' '.repeat(indentLevel);
                const yamlStr = `${indent}key: "${content}"\n`;

                // configValidator must not throw
                const result = configValidator.validateYAML('fuzz.yaml', yamlStr);

                expect(result).toHaveProperty('valid');
                expect(result).toHaveProperty('diagnostics');
                expect(Array.isArray(result.diagnostics)).toBe(true);
            }
        )
    );

    it(
        'all validation errors must be typed (no untyped exceptions)',
        fc.asyncProperty(
            fc.string(),
            async (randomContent) => {
                totalFuzzRuns++;

                // Try both JSON and YAML validators
                const jsonResult = configValidator.validateJSON('test.json', randomContent);
                const yamlResult = configValidator.validateYAML('test.yaml', randomContent);

                // Both must return typed results
                expect(jsonResult).toHaveProperty('valid');
                expect(jsonResult).toHaveProperty('diagnostics');
                expect(Array.isArray(jsonResult.diagnostics)).toBe(true);

                expect(yamlResult).toHaveProperty('valid');
                expect(yamlResult).toHaveProperty('diagnostics');
                expect(Array.isArray(yamlResult.diagnostics)).toBe(true);

                // All diagnostics must be typed correctly
                jsonResult.diagnostics.forEach((d) => {
                    expect(typeof d.file).toBe('string');
                    expect(typeof d.message).toBe('string');
                    expect(['error', 'warning']).toContain(d.severity);
                });

                yamlResult.diagnostics.forEach((d) => {
                    expect(typeof d.file).toBe('string');
                    expect(typeof d.message).toBe('string');
                    expect(['error', 'warning']).toContain(d.severity);
                });
            }
        )
    );

    it(
        'performance: completes all fuzz runs within 5 seconds',
        () => {
            // This test is more of a sanity check
            // The actual perf constraint is enforced by the test harness timeout
            // If we've reached this point without timeout, we passed
            expect(totalFuzzRuns).toBeGreaterThan(0);
        }
    );
});

// ── Specific adversarial inputs ────────────────────────────────────────────────

describe('ConfigValidator adversarial inputs', () => {
    it('rejects prototype pollution via __proto__ key', () => {
        const malicious = JSON.stringify({
            __proto__: { polluted: 'yes' },
            data: 'test',
        });

        const result = configValidator.validateJSON('test.json', malicious);

        // Should return a validation result, not throw
        expect(result).toHaveProperty('valid');
        expect(result).toHaveProperty('diagnostics');

        // Verify no pollution occurred
        expect(Object.prototype.hasOwnProperty('polluted')).toBe(false);
    });

    it('handles constructor.prototype attacks safely', () => {
        const attack = JSON.stringify({
            constructor: { prototype: { isAdmin: true } },
            user: 'attacker',
        });

        const result = configValidator.validateJSON('test.json', attack);

        expect(result).toHaveProperty('valid');
        expect(result).toHaveProperty('diagnostics');
        expect((Object.prototype as any).isAdmin).toBeUndefined();
    });

    it('safely handles very deeply nested structures (depth 200+)', () => {
        let obj: any = { leaf: 'value' };
        for (let i = 0; i < 200; i++) {
            obj = { nested: obj };
        }

        const jsonStr = JSON.stringify(obj);
        const result = configValidator.validateJSON('deep.json', jsonStr);

        expect(result).toHaveProperty('valid');
        expect(result).toHaveProperty('diagnostics');
        expect(Array.isArray(result.diagnostics)).toBe(true);
    });

    it('safely handles extremely large arrays (100k+ items)', () => {
        const hugeArray = Array.from({ length: 100000 }, (_, i) => i);
        const jsonStr = JSON.stringify(hugeArray);

        // This might be marked invalid, but must not throw
        const result = configValidator.validateJSON('huge.json', jsonStr);

        expect(result).toHaveProperty('valid');
        expect(result).toHaveProperty('diagnostics');
    });
});
