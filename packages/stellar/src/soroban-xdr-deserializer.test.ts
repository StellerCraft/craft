import { describe, it, expect } from 'vitest';
import { xdr, StrKey } from 'stellar-sdk';
import {
    deserializeScVal,
    deserializeScValAs,
    serializeScVal,
    SorobanDeserializationError,
    SorobanSerializationError,
    type SorobanValue,
    type ScValTypeHint,
} from './soroban-xdr-deserializer';

// ── Scalar types ──────────────────────────────────────────────────────────────

describe('scvBool', () => {
    it('deserializes true', () => {
        expect(deserializeScVal(xdr.ScVal.scvBool(true))).toBe(true);
    });

    it('deserializes false', () => {
        expect(deserializeScVal(xdr.ScVal.scvBool(false))).toBe(false);
    });
});

describe('scvVoid', () => {
    it('deserializes to null', () => {
        expect(deserializeScVal(xdr.ScVal.scvVoid())).toBeNull();
    });
});

describe('scvU32 / scvI32', () => {
    it('deserializes u32', () => {
        expect(deserializeScVal(xdr.ScVal.scvU32(42))).toBe(42);
    });

    it('deserializes i32 (positive)', () => {
        expect(deserializeScVal(xdr.ScVal.scvI32(100))).toBe(100);
    });

    it('deserializes i32 (negative)', () => {
        expect(deserializeScVal(xdr.ScVal.scvI32(-7))).toBe(-7);
    });
});

describe('scvU64 / scvI64', () => {
    it('deserializes u64 to bigint', () => {
        const val = xdr.ScVal.scvU64(new xdr.Uint64(9_007_199_254_740_993n));
        expect(deserializeScVal(val)).toBe(9_007_199_254_740_993n);
    });

    it('deserializes i64 (positive) to bigint', () => {
        const val = xdr.ScVal.scvI64(new xdr.Int64(1_000_000_000n));
        expect(deserializeScVal(val)).toBe(1_000_000_000n);
    });

    it('deserializes i64 (negative) to bigint', () => {
        const val = xdr.ScVal.scvI64(new xdr.Int64(-1n));
        expect(deserializeScVal(val)).toBe(-1n);
    });

    it('deserializes i64 MIN_INT64', () => {
        const MIN = -9_223_372_036_854_775_808n;
        const val = xdr.ScVal.scvI64(new xdr.Int64(MIN));
        expect(deserializeScVal(val)).toBe(MIN);
    });
});

describe('scvTimepoint / scvDuration', () => {
    it('deserializes timepoint as bigint', () => {
        const val = xdr.ScVal.scvTimepoint(new xdr.TimePoint(12345n));
        expect(deserializeScVal(val)).toBe(12345n);
    });

    it('deserializes duration as bigint', () => {
        const val = xdr.ScVal.scvDuration(new xdr.Duration(99n));
        expect(deserializeScVal(val)).toBe(99n);
    });
});

describe('scvU128 / scvI128', () => {
    it('deserializes u128 (small value)', () => {
        const val = xdr.ScVal.scvU128(
            new xdr.UInt128Parts({ hi: new xdr.Uint64(0n), lo: new xdr.Uint64(255n) }),
        );
        expect(deserializeScVal(val)).toBe(255n);
    });

    it('deserializes u128 (value spanning hi and lo)', () => {
        // hi=1, lo=0 → 1 * 2^64
        const val = xdr.ScVal.scvU128(
            new xdr.UInt128Parts({ hi: new xdr.Uint64(1n), lo: new xdr.Uint64(0n) }),
        );
        expect(deserializeScVal(val)).toBe(1n << 64n);
    });

    it('deserializes i128 (positive)', () => {
        const val = xdr.ScVal.scvI128(
            new xdr.Int128Parts({ hi: new xdr.Int64(0n), lo: new xdr.Uint64(1000n) }),
        );
        expect(deserializeScVal(val)).toBe(1000n);
    });

    it('deserializes i128 (negative with sign in hi)', () => {
        // -1 in i128: hi = -1 (all ones in signed 64-bit), lo = 2^64 - 1
        const val = xdr.ScVal.scvI128(
            new xdr.Int128Parts({ hi: new xdr.Int64(-1n), lo: new xdr.Uint64(0xFFFFFFFFFFFFFFFFn) }),
        );
        expect(deserializeScVal(val)).toBe(-1n);
    });
});

describe('scvU256 / scvI256', () => {
    it('deserializes u256 (small value in loLo)', () => {
        const val = xdr.ScVal.scvU256(
            new xdr.UInt256Parts({
                hiHi: new xdr.Uint64(0n),
                hiLo: new xdr.Uint64(0n),
                loHi: new xdr.Uint64(0n),
                loLo: new xdr.Uint64(7n),
            }),
        );
        expect(deserializeScVal(val)).toBe(7n);
    });

    it('deserializes i256 (positive)', () => {
        const val = xdr.ScVal.scvI256(
            new xdr.Int256Parts({
                hiHi: new xdr.Int64(0n),
                hiLo: new xdr.Uint64(0n),
                loHi: new xdr.Uint64(0n),
                loLo: new xdr.Uint64(42n),
            }),
        );
        expect(deserializeScVal(val)).toBe(42n);
    });
});

// ── String-like types ─────────────────────────────────────────────────────────

describe('scvBytes', () => {
    it('deserializes bytes to Buffer', () => {
        const buf = Buffer.from([1, 2, 3]);
        const val = xdr.ScVal.scvBytes(buf);
        const result = deserializeScVal(val);
        expect(Buffer.isBuffer(result)).toBe(true);
        expect(result).toEqual(buf);
    });
});

describe('scvString', () => {
    it('deserializes to string', () => {
        expect(deserializeScVal(xdr.ScVal.scvString('hello'))).toBe('hello');
    });

    it('deserializes empty string', () => {
        expect(deserializeScVal(xdr.ScVal.scvString(''))).toBe('');
    });
});

describe('scvSymbol', () => {
    it('deserializes to string', () => {
        expect(deserializeScVal(xdr.ScVal.scvSymbol('transfer'))).toBe('transfer');
    });
});

// ── Collection types ──────────────────────────────────────────────────────────

describe('scvVec', () => {
    it('deserializes an empty vector', () => {
        expect(deserializeScVal(xdr.ScVal.scvVec([]))).toEqual([]);
    });

    it('deserializes a vector of scalars', () => {
        const val = xdr.ScVal.scvVec([xdr.ScVal.scvU32(1), xdr.ScVal.scvU32(2), xdr.ScVal.scvU32(3)]);
        expect(deserializeScVal(val)).toEqual([1, 2, 3]);
    });

    it('deserializes a nested vector', () => {
        const inner = xdr.ScVal.scvVec([xdr.ScVal.scvBool(true)]);
        const outer = xdr.ScVal.scvVec([inner, xdr.ScVal.scvVoid()]);
        expect(deserializeScVal(outer)).toEqual([[true], null]);
    });
});

describe('scvMap', () => {
    it('deserializes an empty map', () => {
        expect(deserializeScVal(xdr.ScVal.scvMap([]))).toEqual({});
    });

    it('deserializes a map with symbol keys', () => {
        const entry = new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('balance'),
            val: xdr.ScVal.scvU32(500),
        });
        expect(deserializeScVal(xdr.ScVal.scvMap([entry]))).toEqual({ balance: 500 });
    });

    it('deserializes a map with string keys', () => {
        const entry = new xdr.ScMapEntry({
            key: xdr.ScVal.scvString('name'),
            val: xdr.ScVal.scvString('Alice'),
        });
        expect(deserializeScVal(xdr.ScVal.scvMap([entry]))).toEqual({ name: 'Alice' });
    });

    it('deserializes a map with mixed value types', () => {
        const entries = [
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('count'), val: xdr.ScVal.scvU32(3) }),
            new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('active'), val: xdr.ScVal.scvBool(true) }),
        ];
        const result = deserializeScVal(xdr.ScVal.scvMap(entries)) as Record<string, unknown>;
        expect(result.count).toBe(3);
        expect(result.active).toBe(true);
    });
});

// ── Address type ──────────────────────────────────────────────────────────────

describe('scvAddress', () => {
    it('deserializes an account address to G... string', () => {
        const pubKey = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
        const keyBytes = StrKey.decodeEd25519PublicKey(pubKey);
        const addr = xdr.ScAddress.scAddressTypeAccount(
            xdr.AccountId.publicKeyTypeEd25519(keyBytes),
        );
        const val = xdr.ScVal.scvAddress(addr);
        expect(deserializeScVal(val)).toBe(pubKey);
    });

    it('deserializes a contract address to C... string', () => {
        const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
        const contractBytes = StrKey.decodeContract(contractId);
        const addr = xdr.ScAddress.scAddressTypeContract(contractBytes);
        const val = xdr.ScVal.scvAddress(addr);
        expect(deserializeScVal(val)).toBe(contractId);
    });

});

// ── Error handling ────────────────────────────────────────────────────────────

describe('scvError', () => {
    it('throws SorobanDeserializationError', () => {
        // Build a minimal error ScVal using the available API
        const errVal = xdr.ScVal.scvError(
            xdr.ScError.sceValue(xdr.ScErrorCode.scecArithDomain()),
        );
        expect(() => deserializeScVal(errVal)).toThrow(SorobanDeserializationError);
    });

    it('error has scvType set to scvError', () => {
        const errVal = xdr.ScVal.scvError(
            xdr.ScError.sceValue(xdr.ScErrorCode.scecArithDomain()),
        );
        try {
            deserializeScVal(errVal);
            expect.fail('should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(SorobanDeserializationError);
            expect((e as SorobanDeserializationError).scvType).toBe('scvError');
        }
    });
});

// ── deserializeScValAs ────────────────────────────────────────────────────────

describe('deserializeScValAs', () => {
    it('returns typed value when guard passes', () => {
        const val = xdr.ScVal.scvU32(99);
        const result = deserializeScValAs<number>(val, (v): v is number => typeof v === 'number');
        expect(result).toBe(99);
    });

    it('throws when guard fails', () => {
        const val = xdr.ScVal.scvU32(99);
        expect(() =>
            deserializeScValAs<string>(val, (v): v is string => typeof v === 'string'),
        ).toThrow(SorobanDeserializationError);
    });

    it('works without guard (plain type cast)', () => {
        const val = xdr.ScVal.scvBool(false);
        expect(deserializeScValAs(val)).toBe(false);
    });
});

// ── Serialization (inverse of deserialization) ────────────────────────────────

describe('serializeScVal – round-trip tests', () => {
    it('round-trips boolean true', () => {
        const original = true;
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips boolean false', () => {
        const original = false;
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips null', () => {
        const original = null;
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips u32 number', () => {
        const original = 42;
        const serialized = serializeScVal(original, 'u32');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips i32 number', () => {
        const original = -42;
        const serialized = serializeScVal(original, 'i32');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips u64 bigint', () => {
        const original = 9_007_199_254_740_993n;
        const serialized = serializeScVal(original, 'u64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips i64 bigint', () => {
        const original = -1_000_000_000_000n;
        const serialized = serializeScVal(original, 'i64');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips u128 bigint', () => {
        const original = 1n << 64n;
        const serialized = serializeScVal(original, 'u128');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips i256 bigint', () => {
        const original = -(1n << 255n);
        const serialized = serializeScVal(original, 'i256');
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips string', () => {
        const original = 'hello world';
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toBe(original);
    });

    it('round-trips Buffer', () => {
        const original = Buffer.from([1, 2, 3, 255]);
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(Buffer.isBuffer(deserialized)).toBe(true);
        expect(deserialized).toEqual(original);
    });

    it('round-trips empty array', () => {
        const original: SorobanValue[] = [];
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toEqual(original);
    });

    it('round-trips array of primitives', () => {
        const original: SorobanValue[] = [true, 'test', 42];
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toEqual(original);
    });

    it('round-trips empty map', () => {
        const original: SorobanValue = {};
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toEqual(original);
    });

    it('round-trips map with mixed types', () => {
        const original: Record<string, SorobanValue> = {
            active: true,
            count: 42,
            name: 'test',
        };
        const serialized = serializeScVal(original);
        const deserialized = deserializeScVal(serialized);
        expect(deserialized).toEqual(original);
    });
});

describe('serializeScVal – error handling', () => {
    it('throws for unsupported type', () => {
        const obj = new Date();
        expect(() => serializeScVal(obj as any)).toThrow(SorobanSerializationError);
    });

    it('throws for number out of range', () => {
        const tooLarge = 2 ** 32;
        expect(() => serializeScVal(tooLarge)).toThrow(SorobanSerializationError);
    });

    it('throws for bigint out of range without hint', () => {
        const tooBig = (1n << 256n);
        expect(() => serializeScVal(tooBig)).toThrow(SorobanSerializationError);
    });

    it('throws for invalid type hint', () => {
        const value = 123n;
        expect(() => serializeScVal(value, 'invalid' as any)).toThrow(SorobanSerializationError);
    });
});

// ── Regression: #1102 – explicit hint must throw instead of silently wrapping ─

describe('regression #1102 – out-of-range values with explicit hint throw SorobanSerializationError', () => {
    it('throws when hint is i32 and value exceeds i32 max (2147483647)', () => {
        // 3_000_000_000 is a valid u32 but out of i32 range — must throw, not wrap
        expect(() => serializeScVal(3_000_000_000, 'i32')).toThrow(SorobanSerializationError);
    });

    it('throws when hint is i32 and value is exactly i32 max + 1', () => {
        expect(() => serializeScVal(2_147_483_648, 'i32')).toThrow(SorobanSerializationError);
    });

    it('throws when hint is u32 and value is negative', () => {
        expect(() => serializeScVal(-1, 'u32')).toThrow(SorobanSerializationError);
    });

    it('throws when hint is u32 and value is -2147483648 (valid i32, invalid u32)', () => {
        expect(() => serializeScVal(-2_147_483_648, 'u32')).toThrow(SorobanSerializationError);
    });

    it('does NOT throw for a value that legitimately fits i32 with hint i32', () => {
        // 2_147_483_647 is INT32_MAX — must succeed
        expect(() => serializeScVal(2_147_483_647, 'i32')).not.toThrow();
        expect(() => serializeScVal(-2_147_483_648, 'i32')).not.toThrow();
    });

    it('does NOT throw for a value that legitimately fits u32 with hint u32', () => {
        expect(() => serializeScVal(4_294_967_295, 'u32')).not.toThrow();
        expect(() => serializeScVal(0, 'u32')).not.toThrow();
    });

    it('the thrown error is SorobanSerializationError not a silent wrap', () => {
        // Without the fix, scvI32(3_000_000_000 | 0) would silently produce -1294967296
        let caughtError: unknown;
        try {
            serializeScVal(3_000_000_000, 'i32');
        } catch (e) {
            caughtError = e;
        }
        expect(caughtError).toBeInstanceOf(SorobanSerializationError);
        expect((caughtError as SorobanSerializationError).valueType).toBe('number');
    });
});
