/**
 * Property-Based Round-Trip Tests for ScVal Integer Boundary Values (Issue #1123)
 *
 * Verifies that deserializeScVal(serializeScVal(x)) === x for exact minimum and maximum
 * representable values of u64, i64, u128, i128, u256, and i256, plus one value on either
 * side of each 64-bit segment boundary where off-by-one bit-shifting errors are most likely.
 */

import { describe, it, expect } from 'vitest';
import { xdr } from 'stellar-sdk';
import {
    deserializeScVal,
    serializeScVal,
} from './soroban-xdr-deserializer';

// ── u64 boundary tests ────────────────────────────────────────────────────────

describe('u64 round-trip at boundaries', () => {
    it('round-trips u64 minimum (0)', () => {
        const value = 0n;
        const serialized = serializeScVal(value, 'u64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips u64 maximum (2^64 - 1)', () => {
        const value = (1n << 64n) - 1n; // 18446744073709551615n
        const serialized = serializeScVal(value, 'u64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one less than u64 max', () => {
        const value = (1n << 64n) - 2n;
        const serialized = serializeScVal(value, 'u64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one more than u64 min', () => {
        const value = 1n;
        const serialized = serializeScVal(value, 'u64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 32-bit segment boundary (2^32 - 1)', () => {
        const value = (1n << 32n) - 1n;
        const serialized = serializeScVal(value, 'u64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value one above 32-bit boundary (2^32)', () => {
        const value = 1n << 32n;
        const serialized = serializeScVal(value, 'u64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });
});

// ── i64 boundary tests ────────────────────────────────────────────────────────

describe('i64 round-trip at boundaries', () => {
    it('round-trips i64 minimum (-2^63)', () => {
        const value = -(1n << 63n); // -9223372036854775808n
        const serialized = serializeScVal(value, 'i64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips i64 maximum (2^63 - 1)', () => {
        const value = (1n << 63n) - 1n; // 9223372036854775807n
        const serialized = serializeScVal(value, 'i64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one more than i64 min', () => {
        const value = -(1n << 63n) + 1n;
        const serialized = serializeScVal(value, 'i64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one less than i64 max', () => {
        const value = (1n << 63n) - 2n;
        const serialized = serializeScVal(value, 'i64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips -1 (all bits set)', () => {
        const value = -1n;
        const serialized = serializeScVal(value, 'i64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 32-bit boundary (-2^31)', () => {
        const value = -(1n << 31n);
        const serialized = serializeScVal(value, 'i64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 32-bit boundary (2^31 - 1)', () => {
        const value = (1n << 31n) - 1n;
        const serialized = serializeScVal(value, 'i64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });
});

// ── u128 boundary tests ───────────────────────────────────────────────────────

describe('u128 round-trip at boundaries', () => {
    it('round-trips u128 minimum (0)', () => {
        const value = 0n;
        const serialized = serializeScVal(value, 'u128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips u128 maximum (2^128 - 1)', () => {
        const value = (1n << 128n) - 1n;
        const serialized = serializeScVal(value, 'u128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one less than u128 max', () => {
        const value = (1n << 128n) - 2n;
        const serialized = serializeScVal(value, 'u128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one more than u128 min', () => {
        const value = 1n;
        const serialized = serializeScVal(value, 'u128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 64-bit boundary (2^64 - 1)', () => {
        const value = (1n << 64n) - 1n;
        const serialized = serializeScVal(value, 'u128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 64-bit boundary (2^64)', () => {
        const value = 1n << 64n;
        const serialized = serializeScVal(value, 'u128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value spanning hi and lo segments', () => {
        const value = (1n << 64n) - 1n; // max of low part
        const serialized = serializeScVal(value, 'u128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });
});

// ── i128 boundary tests ───────────────────────────────────────────────────────

describe('i128 round-trip at boundaries', () => {
    it('round-trips i128 minimum (-2^127)', () => {
        const value = -(1n << 127n);
        const serialized = serializeScVal(value, 'i128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips i128 maximum (2^127 - 1)', () => {
        const value = (1n << 127n) - 1n;
        const serialized = serializeScVal(value, 'i128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one more than i128 min', () => {
        const value = -(1n << 127n) + 1n;
        const serialized = serializeScVal(value, 'i128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one less than i128 max', () => {
        const value = (1n << 127n) - 2n;
        const serialized = serializeScVal(value, 'i128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips -1 (all bits set)', () => {
        const value = -1n;
        const serialized = serializeScVal(value, 'i128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 64-bit boundary (-2^63)', () => {
        const value = -(1n << 63n);
        const serialized = serializeScVal(value, 'i128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 64-bit boundary (2^63 - 1)', () => {
        const value = (1n << 63n) - 1n;
        const serialized = serializeScVal(value, 'i128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });
});

// ── u256 boundary tests ───────────────────────────────────────────────────────

describe('u256 round-trip at boundaries', () => {
    it('round-trips u256 minimum (0)', () => {
        const value = 0n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips u256 maximum (2^256 - 1)', () => {
        const value = (1n << 256n) - 1n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one less than u256 max', () => {
        const value = (1n << 256n) - 2n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one more than u256 min', () => {
        const value = 1n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 64-bit boundary (2^64 - 1)', () => {
        const value = (1n << 64n) - 1n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 64-bit boundary (2^64)', () => {
        const value = 1n << 64n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 128-bit boundary (2^128 - 1)', () => {
        const value = (1n << 128n) - 1n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 128-bit boundary (2^128)', () => {
        const value = 1n << 128n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 192-bit boundary (2^192 - 1)', () => {
        const value = (1n << 192n) - 1n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 192-bit boundary (2^192)', () => {
        const value = 1n << 192n;
        const serialized = serializeScVal(value, 'u256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });
});

// ── i256 boundary tests ───────────────────────────────────────────────────────

describe('i256 round-trip at boundaries', () => {
    it('round-trips i256 minimum (-2^255)', () => {
        const value = -(1n << 255n);
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips i256 maximum (2^255 - 1)', () => {
        const value = (1n << 255n) - 1n;
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one more than i256 min', () => {
        const value = -(1n << 255n) + 1n;
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips one less than i256 max', () => {
        const value = (1n << 255n) - 2n;
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips -1 (all bits set)', () => {
        const value = -1n;
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 64-bit boundary (-2^63)', () => {
        const value = -(1n << 63n);
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 64-bit boundary (2^63 - 1)', () => {
        const value = (1n << 63n) - 1n;
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 128-bit boundary (-2^127)', () => {
        const value = -(1n << 127n);
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 128-bit boundary (2^127 - 1)', () => {
        const value = (1n << 127n) - 1n;
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 192-bit boundary (-2^191)', () => {
        const value = -(1n << 191n);
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });

    it('round-trips value at 192-bit boundary (2^191 - 1)', () => {
        const value = (1n << 191n) - 1n;
        const serialized = serializeScVal(value, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(value);
    });
});
