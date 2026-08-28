/**
 * Type-Safe XDR Deserialization for Soroban Contract Return Values (Issue #090)
 *
 * Converts raw `xdr.ScVal` objects returned by Soroban contract invocations
 * into strongly-typed TypeScript values, eliminating manual XDR parsing.
 *
 * ## Type mapping
 * | ScVal type               | TypeScript type              |
 * |--------------------------|------------------------------|
 * | scvBool                  | boolean                      |
 * | scvVoid                  | null                         |
 * | scvU32 / scvI32          | number                       |
 * | scvU64 / scvI64          | bigint                       |
 * | scvTimepoint / scvDuration | bigint                     |
 * | scvU128 / scvI128        | bigint                       |
 * | scvU256 / scvI256        | bigint                       |
 * | scvBytes                 | Buffer                       |
 * | scvString / scvSymbol    | string                       |
 * | scvVec                   | SorobanValue[]               |
 * | scvMap                   | Record<string, SorobanValue> |
 * | scvAddress               | string (G..., C..., M..., or typed pool address) |
 * | scvError                 | throws SorobanDeserializationError |
 *
 * Malformed or unknown ScVal types always throw `SorobanDeserializationError`.
 * Values are never silently coerced.
 */

import { xdr, StrKey } from 'stellar-sdk';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Union of all possible deserialized Soroban values.
 * Recursive through `SorobanValue[]` and `Record<string, SorobanValue>`.
 */
export type SorobanValue =
    | boolean
    | null
    | number
    | bigint
    | string
    | Buffer
    | SorobanValue[]
    | { [key: string]: SorobanValue };

/**
 * Thrown when an `xdr.ScVal` cannot be safely deserialized.
 * The `scvType` property holds the raw discriminant name for diagnostics.
 */
export class SorobanDeserializationError extends Error {
    constructor(
        message: string,
        public readonly scvType?: string,
    ) {
        super(message);
        this.name = 'SorobanDeserializationError';
    }
}

/**
 * Thrown when a SorobanValue cannot be safely serialized to xdr.ScVal.
 * The `valueType` property holds the JavaScript type for diagnostics.
 */
export class SorobanSerializationError extends Error {
    constructor(
        message: string,
        public readonly valueType?: string,
    ) {
        super(message);
        this.name = 'SorobanSerializationError';
    }
}

/**
 * Optional hint for ambiguous numeric types that can map to multiple ScVal
 * discriminants (e.g., a number could be u32 or i32). When omitted, the
 * smallest lossless representation is chosen.
 */
export type ScValTypeHint = 'u32' | 'i32' | 'u64' | 'i64' | 'u128' | 'i128' | 'u256' | 'i256';

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Deserialize a Soroban `xdr.ScVal` into a strongly-typed `SorobanValue`.
 *
 * @param scVal - The raw XDR value returned by a contract invocation
 * @returns The deserialized TypeScript value
 * @throws {SorobanDeserializationError} if the value is an error type or
 *   the discriminant is not a recognized ScVal variant
 *
 * @example
 * ```typescript
 * const sim = await simulateContractCall(contractId, 'get_balance', args, key);
 * const retval = (sim as SimulateTransactionSuccessResponse).result?.retval;
 * const balance = deserializeScVal(retval) as bigint; // scvI128
 * ```
 */
export function deserializeScVal(scVal: xdr.ScVal): SorobanValue {
    const typeName = scVal.switch().name as string;

    switch (typeName) {
        case 'scvBool':
            return scVal.b();

        case 'scvVoid':
            return null;

        case 'scvError': {
            const err = scVal.error();
            const typeStr = err.switch().name ?? 'unknown';
            throw new SorobanDeserializationError(
                `Contract returned an error value (type: ${typeStr})`,
                typeName,
            );
        }

        case 'scvU32':
            return scVal.u32();

        case 'scvI32':
            return scVal.i32();

        case 'scvU64':
            return uint64ToBigInt(scVal.u64());

        case 'scvI64':
            return int64ToBigInt(scVal.i64());

        case 'scvTimepoint':
            return uint64ToBigInt(scVal.timepoint());

        case 'scvDuration':
            return uint64ToBigInt(scVal.duration());

        case 'scvU128': {
            const p = scVal.u128();
            return (uint64ToBigInt(p.hi()) << 64n) | uint64ToBigInt(p.lo());
        }

        case 'scvI128': {
            const p = scVal.i128();
            // hi is signed (Int64), lo is unsigned (Uint64)
            const hi = int64ToBigInt(p.hi());
            const lo = uint64ToBigInt(p.lo());
            return (hi << 64n) | lo;
        }

        case 'scvU256': {
            const p = scVal.u256();
            return (
                (uint64ToBigInt(p.hiHi()) << 192n) |
                (uint64ToBigInt(p.hiLo()) << 128n) |
                (uint64ToBigInt(p.loHi()) << 64n) |
                uint64ToBigInt(p.loLo())
            );
        }

        case 'scvI256': {
            const p = scVal.i256();
            // hiHi is signed (Int64); the remaining three are unsigned
            const hiHi = int64ToBigInt(p.hiHi());
            const hiLo = uint64ToBigInt(p.hiLo());
            const loHi = uint64ToBigInt(p.loHi());
            const loLo = uint64ToBigInt(p.loLo());
            return (hiHi << 192n) | (hiLo << 128n) | (loHi << 64n) | loLo;
        }

        case 'scvBytes':
            return scVal.bytes();

        case 'scvString':
            return scVal.str().toString();

        case 'scvSymbol':
            return scVal.sym().toString();

        case 'scvVec': {
            const items = scVal.vec();
            if (items === undefined) return [];
            return items.map((item) => deserializeScVal(item));
        }

        case 'scvMap': {
            const entries = scVal.map();
            if (entries === undefined) return {};
            const result: { [key: string]: SorobanValue } = {};
            for (const entry of entries) {
                const key = mapKeyToString(entry.key());
                result[key] = deserializeScVal(entry.val());
            }
            return result;
        }

        case 'scvAddress':
            return decodeAddress(scVal.address());

        case 'scvLedgerKeyContractInstance':
            return null;

        case 'scvLedgerKeyNonce': {
            const nonce = scVal.nonce();
            return int64ToBigInt(nonce.nonce());
        }

        case 'scvContractInstance':
            return null;

        default:
            throw new SorobanDeserializationError(
                `Unrecognized ScVal type: ${typeName}`,
                typeName,
            );
    }
}

// ── Type-parameterised helper ─────────────────────────────────────────────────

/**
 * Deserialize a ScVal and cast to the expected TypeScript type `T`.
 *
 * Throws `SorobanDeserializationError` when the deserialized value does not
 * satisfy the optional `guard` predicate.
 *
 * @example
 * ```typescript
 * const count = deserializeScValAs<number>(retval, (v): v is number => typeof v === 'number');
 * ```
 */
export function deserializeScValAs<T extends SorobanValue>(
    scVal: xdr.ScVal,
    guard?: (v: SorobanValue) => v is T,
): T {
    const value = deserializeScVal(scVal);
    if (guard && !guard(value)) {
        throw new SorobanDeserializationError(
            `Deserialized value did not match expected type (got ${typeof value})`,
            scVal.switch().name,
        );
    }
    return value as T;
}

// ── Serialization (inverse of deserialization) ────────────────────────────────

/**
 * Serialize a SorobanValue into an xdr.ScVal.
 *
 * Numeric ambiguity (number → u32/i32, bigint → u64/i64/u128/i128/u256/i256)
 * is resolved via the optional `hint` parameter. When omitted, the smallest
 * lossless representation is chosen.
 *
 * @param value - The native TypeScript value to serialize
 * @param hint - Optional type hint for ambiguous numeric types
 * @returns The serialized xdr.ScVal
 * @throws {SorobanSerializationError} if the value is invalid or unserializable
 *
 * @example
 * ```typescript
 * const val = serializeScVal(123n, 'u64');
 * const scVal = serializeScVal(true);
 * ```
 */
export function serializeScVal(value: SorobanValue, hint?: ScValTypeHint): xdr.ScVal {
    if (value === null) {
        return xdr.ScVal.scvVoid();
    }

    if (typeof value === 'boolean') {
        return xdr.ScVal.scvBool(value);
    }

    if (typeof value === 'number') {
        // Resolve number to u32 or i32
        if (!Number.isInteger(value) || value < -2_147_483_648 || value > 4_294_967_295) {
            throw new SorobanSerializationError(
                `Number ${value} is out of range for u32/i32`,
                'number',
            );
        }
        if (hint === 'u32') {
            return xdr.ScVal.scvU32(value >>> 0);
        } else if (hint === 'i32') {
            return xdr.ScVal.scvI32(value | 0);
        } else if (value >= 0) {
            return xdr.ScVal.scvU32(value >>> 0);
        } else {
            return xdr.ScVal.scvI32(value | 0);
        }
    }

    if (typeof value === 'bigint') {
        return serializeBigInt(value, hint);
    }

    if (typeof value === 'string') {
        return xdr.ScVal.scvString(value);
    }

    if (Buffer.isBuffer(value)) {
        return xdr.ScVal.scvBytes(value);
    }

    if (Array.isArray(value)) {
        const items = value.map((item) => serializeScVal(item, hint));
        return xdr.ScVal.scvVec(items);
    }

    if (typeof value === 'object') {
        const entries = Object.entries(value).map(([k, v]) => {
            const key = xdr.ScVal.scvSymbol(k);
            const val = serializeScVal(v, hint);
            return new xdr.ScMapEntry({ key, val });
        });
        return xdr.ScVal.scvMap(entries);
    }

    throw new SorobanSerializationError(
        `Unsupported type: ${typeof value}`,
        typeof value,
    );
}

/**
 * Serialize a bigint to the appropriate ScVal integer type.
 * Respects the optional hint; defaults to the smallest lossless representation.
 */
function serializeBigInt(value: bigint, hint?: ScValTypeHint): xdr.ScVal {
    // Validate range for hint-less serialization
    if (!hint) {
        if (value >= 0n && value <= 0xFFFFFFFFn) {
            return xdr.ScVal.scvU64(bigintToUint64(value));
        } else if (value >= -0x8000000000000000n && value <= 0x7FFFFFFFFFFFFFFFn) {
            return xdr.ScVal.scvI64(bigintToInt64(value));
        } else if (value >= 0n && value <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn) {
            return xdr.ScVal.scvU128(bigintToUint128(value));
        } else if (value >= -0x80000000000000000000000000000000n && value <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn) {
            return xdr.ScVal.scvI128(bigintToInt128(value));
        } else if (value >= 0n && value <= 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn) {
            return xdr.ScVal.scvU256(bigintToUint256(value));
        } else if (value >= -0x8000000000000000000000000000000000000000000000000000000000000000n && value <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn) {
            return xdr.ScVal.scvI256(bigintToInt256(value));
        }
        throw new SorobanSerializationError(
            `BigInt ${value} is out of range for all integer types`,
            'bigint',
        );
    }

    // Hint-based serialization
    switch (hint) {
        case 'u64':
            return xdr.ScVal.scvU64(bigintToUint64(value));
        case 'i64':
            return xdr.ScVal.scvI64(bigintToInt64(value));
        case 'u128':
            return xdr.ScVal.scvU128(bigintToUint128(value));
        case 'i128':
            return xdr.ScVal.scvI128(bigintToInt128(value));
        case 'u256':
            return xdr.ScVal.scvU256(bigintToUint256(value));
        case 'i256':
            return xdr.ScVal.scvI256(bigintToInt256(value));
        default:
            throw new SorobanSerializationError(
                `Invalid hint for bigint: ${hint}`,
                'bigint',
            );
    }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Unsigned 64-bit XDR integer → BigInt. */
function uint64ToBigInt(v: { high: number; low: number }): bigint {
    return (BigInt(v.high >>> 0) << 32n) | BigInt(v.low >>> 0);
}

/** Signed 64-bit XDR integer → BigInt (preserves two's-complement sign). */
function int64ToBigInt(v: { high: number; low: number }): bigint {
    const unsigned = (BigInt(v.high >>> 0) << 32n) | BigInt(v.low >>> 0);
    // If the sign bit (bit 63) is set, convert from unsigned to signed representation.
    return v.high < 0 ? unsigned - (1n << 64n) : unsigned;
}

/** Convert a ScAddress to its Stellar StrKey string representation. */
function decodeAddress(addr: xdr.ScAddress): string {
    const typeName = addr.switch().name as string;

    if (typeName === 'scAddressTypeAccount') {
        return StrKey.encodeEd25519PublicKey(addr.accountId().ed25519());
    }

    if (typeName === 'scAddressTypeContract') {
        return StrKey.encodeContract(addr.contractId());
    }

    if (typeName === 'scAddressTypeMuxedAccount') {
        const muxed = addr.muxedAccount();
        const ed25519Bytes = muxed.ed25519().v0();
        const id = muxed.id();
        return StrKey.encodeMed25519PublicKey(ed25519Bytes, id);
    }

    if (typeName === 'scAddressTypeClaimableBalance') {
        const claimBalanceId = addr.claimableBalanceId();
        const hashedId = claimBalanceId.v0();
        return StrKey.encodeClaimableBalanceId(hashedId);
    }

    if (typeName === 'scAddressTypeLiquidityPool') {
        const poolId = addr.liquidityPoolId();
        const hashedId = poolId.v0();
        return StrKey.encodeLiquidityPoolId(hashedId);
    }

    throw new SorobanDeserializationError(
        `Unknown ScAddress type: ${typeName}`,
        'scvAddress',
    );
}

/**
 * Convert a ScVal map key to a string for use as an object property name.
 * Symbols and strings are used verbatim; numeric and other types are
 * rendered as their string representation.
 *
 * scvBytes keys are hex-encoded (prefixed with "0x") to guarantee distinct
 * strings for distinct byte sequences.
 *
 * scvAddress keys are decoded via `decodeAddress` to their canonical StrKey
 * representation (G..., C..., M..., etc.) so that each distinct address
 * maps to a unique string.
 *
 * For genuinely unrecognised key types a `SorobanDeserializationError` is
 * thrown rather than silently collapsing all such keys to the same placeholder.
 */
function mapKeyToString(key: xdr.ScVal): string {
    const typeName = key.switch().name as string;
    switch (typeName) {
        case 'scvSymbol': return key.sym().toString();
        case 'scvString': return key.str().toString();
        case 'scvU32':    return String(key.u32());
        case 'scvI32':    return String(key.i32());
        case 'scvU64':    return uint64ToBigInt(key.u64()).toString();
        case 'scvI64':    return int64ToBigInt(key.i64()).toString();
        case 'scvBool':   return String(key.b());
        case 'scvBytes':  return '0x' + (key.bytes() as Buffer).toString('hex');
        case 'scvAddress': return decodeAddress(key.address());
        default:
            throw new SorobanDeserializationError(
                `Unsupported ScVal map key type: ${typeName}`,
                typeName,
            );
    }
}

// ── Serialization helpers ──────────────────────────────────────────────────────

/** BigInt → Unsigned 64-bit XDR integer. */
function bigintToUint64(value: bigint): { high: number; low: number } {
    const hi = Number((value >> 32n) & 0xFFFFFFFFn);
    const lo = Number(value & 0xFFFFFFFFn);
    return { high: hi >>> 0, low: lo >>> 0 };
}

/** BigInt → Signed 64-bit XDR integer. */
function bigintToInt64(value: bigint): { high: number; low: number } {
    const unsigned = bigintToUint64(value);
    if (value < 0n) {
        unsigned.high = unsigned.high | 0;
    }
    return unsigned;
}

/** BigInt → Unsigned 128-bit XDR integer. */
function bigintToUint128(value: bigint): { hi: { high: number; low: number }; lo: { high: number; low: number } } {
    const hi = bigintToUint64(value >> 64n);
    const lo = bigintToUint64(value & 0xFFFFFFFFFFFFFFFFn);
    return { hi, lo };
}

/** BigInt → Signed 128-bit XDR integer. */
function bigintToInt128(value: bigint): { hi: { high: number; low: number }; lo: { high: number; low: number } } {
    const u128 = bigintToUint128(value);
    if (value < 0n) {
        u128.hi.high = u128.hi.high | 0;
    }
    return u128;
}

/** BigInt → Unsigned 256-bit XDR integer. */
function bigintToUint256(value: bigint): {
    hiHi: { high: number; low: number };
    hiLo: { high: number; low: number };
    loHi: { high: number; low: number };
    loLo: { high: number; low: number };
} {
    const hiHi = bigintToUint64(value >> 192n);
    const hiLo = bigintToUint64((value >> 128n) & 0xFFFFFFFFFFFFFFFFn);
    const loHi = bigintToUint64((value >> 64n) & 0xFFFFFFFFFFFFFFFFn);
    const loLo = bigintToUint64(value & 0xFFFFFFFFFFFFFFFFn);
    return { hiHi, hiLo, loHi, loLo };
}

/** BigInt → Signed 256-bit XDR integer. */
function bigintToInt256(value: bigint): {
    hiHi: { high: number; low: number };
    hiLo: { high: number; low: number };
    loHi: { high: number; low: number };
    loLo: { high: number; low: number };
} {
    const u256 = bigintToUint256(value);
    if (value < 0n) {
        u256.hiHi.high = u256.hiHi.high | 0;
    }
    return u256;
}
