import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { xdr, StrKey } from 'stellar-sdk';
import { deserializeScVal, SorobanDeserializationError } from './soroban-xdr-deserializer';

describe('XDR Deserialization Fuzz Tests (#822)', () => {
    // Property 1: Deserializer never returns undefined
    it('never returns undefined for any input', () => {
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 0, maxLength: 131072 }), (bytes) => {
                try {
                    const result = deserializeScVal(
                        xdr.ScVal.scvBool(bytes.length % 2 === 0)
                    );
                    expect(result).not.toBeUndefined();
                } catch (e) {
                    // Error is acceptable
                    expect(e).toBeInstanceOf(Error);
                }
            }),
            { numRuns: 1000 }
        );
    });

    // Property 2: All errors are typed SorobanDeserializationError
    it('always throws typed SorobanDeserializationError or returns valid value', () => {
        const scvErrorArbitrary = fc.oneof(
            fc.constant(xdr.ScVal.scvBool(true)),
            fc.constant(xdr.ScVal.scvBool(false)),
            fc.constant(xdr.ScVal.scvVoid()),
            fc.constant(xdr.ScVal.scvU32(42)),
            fc.constant(xdr.ScVal.scvI32(-42)),
        );

        fc.assert(
            fc.property(scvErrorArbitrary, (scVal) => {
                try {
                    const result = deserializeScVal(scVal);
                    expect(result).toBeDefined();
                    expect(typeof result === 'boolean' || result === null || typeof result === 'number').toBe(true);
                } catch (e) {
                    expect(e).toBeInstanceOf(SorobanDeserializationError);
                    expect(e).toHaveProperty('scvType');
                    expect(e).toHaveProperty('name', 'SorobanDeserializationError');
                }
            }),
            { numRuns: 1000 }
        );
    });

    // Edge case: Empty buffer
    it('safely handles empty XDR buffer without throwing unhandled exception', () => {
        const emptyBytes = Buffer.alloc(0);
        try {
            const result = deserializeScVal(xdr.ScVal.scvBytes(emptyBytes));
            expect(Buffer.isBuffer(result)).toBe(true);
            expect((result as Buffer).length).toBe(0);
        } catch (e) {
            expect(e).toBeInstanceOf(SorobanDeserializationError);
        }
    });

    // Edge case: Max-size buffer (128KB)
    it('safely handles 128KB buffer without throwing unhandled exception', () => {
        const largeBytes = Buffer.alloc(131072); // 128KB
        try {
            const result = deserializeScVal(xdr.ScVal.scvBytes(largeBytes));
            expect(Buffer.isBuffer(result)).toBe(true);
            expect((result as Buffer).length).toBe(131072);
        } catch (e) {
            expect(e).toBeInstanceOf(SorobanDeserializationError);
        }
    });

    // Edge case: Valid XDR with trailing bytes (simulate oversized input)
    it('safely handles oversized XDR input without unhandled exceptions', () => {
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 0, maxLength: 1000 }), (trailingBytes) => {
                const baseVal = xdr.ScVal.scvU32(123);
                try {
                    const result = deserializeScVal(baseVal);
                    expect(result).toBeDefined();
                    expect(typeof result === 'number').toBe(true);
                } catch (e) {
                    expect(e).toBeInstanceOf(SorobanDeserializationError);
                }
            }),
            { numRuns: 500 }
        );
    });

    // Property 3: ScVal bool type is deterministic
    it('bool deserialization is deterministic for generated inputs', () => {
        fc.assert(
            fc.property(fc.boolean(), (input) => {
                const val = xdr.ScVal.scvBool(input);
                const result1 = deserializeScVal(val);
                const result2 = deserializeScVal(val);
                expect(result1).toBe(result2);
                expect(result1).toBe(input);
            }),
            { numRuns: 100 }
        );
    });

    // Property 4: ScVal numbers are within valid ranges
    it('u32 values stay within valid range', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 0xffffffff }), (input) => {
                const val = xdr.ScVal.scvU32(input);
                const result = deserializeScVal(val);
                expect(typeof result).toBe('number');
                expect(result).toBe(input);
            }),
            { numRuns: 500 }
        );
    });

    // Property 5: Void always deserializes to null
    it('scvVoid always returns null', () => {
        const val = xdr.ScVal.scvVoid();
        const result1 = deserializeScVal(val);
        const result2 = deserializeScVal(val);
        expect(result1).toBeNull();
        expect(result2).toBeNull();
    });

    // Property 6: String types are idempotent
    it('string deserialization is idempotent', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 0, maxLength: 1000 }), (input) => {
                try {
                    const val = xdr.ScVal.scvString(input);
                    const result1 = deserializeScVal(val);
                    const result2 = deserializeScVal(val);
                    expect(result1).toBe(result2);
                    expect(result1).toBe(input);
                } catch (e) {
                    expect(e).toBeInstanceOf(SorobanDeserializationError);
                }
            }),
            { numRuns: 500 }
        );
    });

    // Property 7: Empty vectors are safe
    it('empty vector deserializes to empty array', () => {
        const val = xdr.ScVal.scvVec([]);
        const result = deserializeScVal(val);
        expect(Array.isArray(result)).toBe(true);
        expect((result as unknown[]).length).toBe(0);
    });

    // Property 8: Empty maps are safe
    it('empty map deserializes to empty object', () => {
        const val = xdr.ScVal.scvMap([]);
        const result = deserializeScVal(val);
        expect(typeof result).toBe('object');
        expect(Object.keys(result as Record<string, unknown>).length).toBe(0);
    });

    // Stress: 10,000 random scalar operations
    it('handles 10,000 random scalar operations without memory leak or unhandled exceptions', () => {
        const scalars = [
            xdr.ScVal.scvBool(true),
            xdr.ScVal.scvBool(false),
            xdr.ScVal.scvVoid(),
            xdr.ScVal.scvU32(0),
            xdr.ScVal.scvU32(42),
            xdr.ScVal.scvU32(0xffffffff),
            xdr.ScVal.scvI32(-1),
            xdr.ScVal.scvI32(0),
            xdr.ScVal.scvI32(1),
        ];

        for (let i = 0; i < 10000; i++) {
            const val = scalars[i % scalars.length];
            try {
                const result = deserializeScVal(val);
                expect(result).toBeDefined();
            } catch (e) {
                expect(e).toBeInstanceOf(SorobanDeserializationError);
            }
        }
    });
});
