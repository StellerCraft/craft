/**
 * Fuzz Tests — Soroban Contract Address Derivation Edge Cases
 *
 * Issue #743
 *
 * Exercises deriveContractAddress with adversarial and boundary inputs that
 * the deterministic unit tests in soroban-address-derivation.test.ts do not
 * cover.  All key material is fixed or seeded — no randomness at runtime.
 *
 * Coverage:
 *   F1  Invalid WASM hash lengths (< 32 bytes, > 32 bytes) always throw.
 *   F2  Salt boundary values: empty → throws; exactly 32 bytes → succeeds;
 *       33 bytes → throws.
 *   F3  Collision resistance: no two distinct (deployer, salt, wasmHash)
 *       triples produce the same contract address across 200 iterations.
 *   F4  Output is always a valid C… StrKey (56-char base32).
 *   F5  Well-known contract IDs do not collide with derived addresses.
 */

import { describe, it, expect } from 'vitest';
import { Networks } from 'stellar-sdk';
import { deriveContractAddress } from './soroban';

// ── Deterministic test fixtures ───────────────────────────────────────────────

const DEPLOYER_A = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
const DEPLOYER_B = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const DEPLOYER_C = 'GATEMHCCKCY67ZUCKTROYN24ZYT5GK4EQZ65JJLDHKHRUZI3EUEKMTCH';

const SALT_32 = '0000000000000000000000000000000000000000000000000000000000000001';
const WASM_32 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function makePrng(seed: number) {
    let s = seed;
    return (): number => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Generate a random 32-byte hex string using the supplied PRNG. */
function gen32ByteHex(rand: () => number): string {
    return Array.from({ length: 64 }, () =>
        Math.floor(rand() * 16).toString(16),
    ).join('');
}

/**
 * Pick from the three known-valid deployer addresses using the iteration index.
 * Cycles A → B → C to keep the fuzz space wide without needing runtime key
 * generation.
 */
function pickDeployer(i: number): string {
    const deployers = [DEPLOYER_A, DEPLOYER_B, DEPLOYER_C];
    return deployers[i % deployers.length];
}

// Well-known contract addresses that must not collide with any derivation.
const WELL_KNOWN = [
    'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    'CBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALYXS',
] as const;

// ── F1: Invalid WASM hash lengths ─────────────────────────────────────────────

describe('F1 — invalid WASM hash lengths always throw', () => {
    const rand = makePrng(0xf1220743);

    it('wasm hash shorter than 32 bytes always throws', () => {
        for (let byteLen = 0; byteLen < 32; byteLen++) {
            const shortHash = '00'.repeat(byteLen);
            expect(
                () => deriveContractAddress(DEPLOYER_A, SALT_32, shortHash, Networks.TESTNET),
                `expected throw for wasmHash length ${byteLen}`,
            ).toThrow('wasmHash must be 32 bytes');
        }
    });

    it('wasm hash longer than 32 bytes always throws', () => {
        for (let byteLen = 33; byteLen <= 64; byteLen++) {
            const longHash = '00'.repeat(byteLen);
            expect(
                () => deriveContractAddress(DEPLOYER_A, SALT_32, longHash, Networks.TESTNET),
                `expected throw for wasmHash length ${byteLen}`,
            ).toThrow('wasmHash must be 32 bytes');
        }
    });

    it('fuzz: random-length wasm hashes ≠ 32 bytes always throw', () => {
        for (let i = 0; i < 100; i++) {
            const byteLen = Math.floor(rand() * 64);
            if (byteLen === 32) continue; // skip valid lengths
            const hash = '00'.repeat(byteLen);
            expect(
                () => deriveContractAddress(DEPLOYER_A, SALT_32, hash, Networks.TESTNET),
            ).toThrow('wasmHash must be 32 bytes');
        }
    });
});

// ── F2: Salt boundary values ──────────────────────────────────────────────────

describe('F2 — salt boundary values', () => {
    it('empty salt (0 bytes) throws', () => {
        expect(() => deriveContractAddress(DEPLOYER_A, '', WASM_32, Networks.TESTNET)).toThrow(
            'salt must be 32 bytes',
        );
    });

    it('salt exactly 32 bytes succeeds and returns a C… StrKey', () => {
        const addr = deriveContractAddress(DEPLOYER_A, SALT_32, WASM_32, Networks.TESTNET);
        expect(addr).toMatch(/^C[A-Z2-7]{55}$/);
    });

    it('salt of 31 bytes throws', () => {
        const short = '00'.repeat(31);
        expect(() => deriveContractAddress(DEPLOYER_A, short, WASM_32, Networks.TESTNET)).toThrow(
            'salt must be 32 bytes',
        );
    });

    it('salt of 33 bytes throws', () => {
        const long = '00'.repeat(33);
        expect(() => deriveContractAddress(DEPLOYER_A, long, WASM_32, Networks.TESTNET)).toThrow(
            'salt must be 32 bytes',
        );
    });

    it('salt over 32 bytes always throws', () => {
        for (let byteLen = 33; byteLen <= 64; byteLen++) {
            expect(
                () => deriveContractAddress(DEPLOYER_A, '00'.repeat(byteLen), WASM_32, Networks.TESTNET),
                `expected throw for salt length ${byteLen}`,
            ).toThrow('salt must be 32 bytes');
        }
    });

    it('Buffer salt of exactly 32 bytes succeeds', () => {
        const saltBuf = Buffer.alloc(32, 0x01);
        const addr = deriveContractAddress(DEPLOYER_A, saltBuf, WASM_32, Networks.TESTNET);
        expect(addr).toMatch(/^C[A-Z2-7]{55}$/);
    });

    it('Buffer salt of 31 bytes throws', () => {
        expect(
            () => deriveContractAddress(DEPLOYER_A, Buffer.alloc(31), WASM_32, Networks.TESTNET),
        ).toThrow('salt must be 32 bytes');
    });
});

// ── F3: Collision resistance ──────────────────────────────────────────────────

describe('F3 — collision resistance across 200 distinct inputs', () => {
    it('no two distinct (deployer, salt, wasmHash) triples share an address', () => {
        const rand = makePrng(0xc0111153);
        const seen = new Set<string>();

        for (let i = 0; i < 200; i++) {
            const deployer = pickDeployer(i);
            const salt = gen32ByteHex(rand);
            const wasm = gen32ByteHex(rand);

            const addr = deriveContractAddress(deployer, salt, wasm, Networks.TESTNET);

            // Invariant: this address must not have appeared before
            expect(seen.has(addr)).toBe(false);
            seen.add(addr);
        }
    });

    it('changing only the salt produces a different address', () => {
        const rand = makePrng(0xaa55cc11);
        for (let i = 0; i < 50; i++) {
            const salt1 = gen32ByteHex(rand);
            const salt2 = gen32ByteHex(rand);
            if (salt1 === salt2) continue;

            const a1 = deriveContractAddress(DEPLOYER_A, salt1, WASM_32, Networks.TESTNET);
            const a2 = deriveContractAddress(DEPLOYER_A, salt2, WASM_32, Networks.TESTNET);
            expect(a1).not.toBe(a2);
        }
    });

    it('changing only the wasm hash produces a different address', () => {
        const rand = makePrng(0x11223344);
        for (let i = 0; i < 50; i++) {
            const w1 = gen32ByteHex(rand);
            const w2 = gen32ByteHex(rand);
            if (w1 === w2) continue;

            const a1 = deriveContractAddress(DEPLOYER_A, SALT_32, w1, Networks.TESTNET);
            const a2 = deriveContractAddress(DEPLOYER_A, SALT_32, w2, Networks.TESTNET);
            expect(a1).not.toBe(a2);
        }
    });

    it('changing only the deployer produces a different address', () => {
        const a1 = deriveContractAddress(DEPLOYER_A, SALT_32, WASM_32, Networks.TESTNET);
        const a2 = deriveContractAddress(DEPLOYER_B, SALT_32, WASM_32, Networks.TESTNET);
        expect(a1).not.toBe(a2);
    });
});

// ── F4: Output format invariant ───────────────────────────────────────────────

describe('F4 — output is always a valid C… StrKey', () => {
    it('all 200 derived addresses match the C-StrKey pattern', () => {
        const rand = makePrng(0xdeadf444);
        const C_STRKEY_RE = /^C[A-Z2-7]{55}$/;

        for (let i = 0; i < 200; i++) {
            const deployer = pickDeployer(i);
            const salt = gen32ByteHex(rand);
            const wasm = gen32ByteHex(rand);
            const addr = deriveContractAddress(deployer, salt, wasm, Networks.TESTNET);
            expect(addr).toMatch(C_STRKEY_RE);
        }
    });
});

// ── F5: No collision with well-known addresses ────────────────────────────────

describe('F5 — no collision with well-known contract IDs', () => {
    it('derived addresses never match well-known contract IDs', () => {
        const rand = makePrng(0x5afebeef);
        const wellKnownSet = new Set<string>(WELL_KNOWN);

        for (let i = 0; i < 200; i++) {
            const deployer = pickDeployer(i);
            const salt = gen32ByteHex(rand);
            const wasm = gen32ByteHex(rand);
            const addr = deriveContractAddress(deployer, salt, wasm, Networks.TESTNET);
            expect(wellKnownSet.has(addr)).toBe(false);
        }
    });
});
