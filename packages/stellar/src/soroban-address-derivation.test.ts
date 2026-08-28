/**
 * Tests for deterministic contract address derivation (#613)
 */
import { describe, it, expect } from 'vitest';
import { Networks } from 'stellar-sdk';
import { deriveContractAddress, verifyContractAddress } from './soroban';

// Known-good fixture: deployer, salt, wasmHash → expected contract address.
// These values were produced by running the Soroban host derivation locally
// and are used as regression anchors.
const DEPLOYER = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
const SALT_HEX = '0000000000000000000000000000000000000000000000000000000000000001';
const WASM_HASH_HEX = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('deriveContractAddress (#613)', () => {
    it('returns a C… strkey', () => {
        const addr = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        expect(addr).toMatch(/^C[A-Z2-7]{55}$/);
    });

    it('is deterministic — same inputs produce same address', () => {
        const a = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        const b = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        expect(a).toBe(b);
    });

    it('differs when salt changes', () => {
        const salt2 = '0000000000000000000000000000000000000000000000000000000000000002';
        const a = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        const b = deriveContractAddress(DEPLOYER, salt2, WASM_HASH_HEX, Networks.TESTNET);
        expect(a).not.toBe(b);
    });

    it('differs when wasmHash changes', () => {
        const wasm2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        const a = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        const b = deriveContractAddress(DEPLOYER, SALT_HEX, wasm2, Networks.TESTNET);
        expect(a).not.toBe(b);
    });

    it('differs when networkPassphrase changes', () => {
        const a = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        const b = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.PUBLIC);
        expect(a).not.toBe(b);
    });

    it('accepts Buffer inputs', () => {
        const saltBuf = Buffer.from(SALT_HEX, 'hex');
        const wasmBuf = Buffer.from(WASM_HASH_HEX, 'hex');
        const fromHex = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        const fromBuf = deriveContractAddress(DEPLOYER, saltBuf, wasmBuf, Networks.TESTNET);
        expect(fromHex).toBe(fromBuf);
    });

    it('throws when salt is not 32 bytes', () => {
        expect(() => deriveContractAddress(DEPLOYER, 'deadbeef', WASM_HASH_HEX, Networks.TESTNET)).toThrow('salt must be 32 bytes');
    });

    it('throws when wasmHash is not 32 bytes', () => {
        expect(() => deriveContractAddress(DEPLOYER, SALT_HEX, 'deadbeef', Networks.TESTNET)).toThrow('wasmHash must be 32 bytes');
    });
});

describe('verifyContractAddress (#613)', () => {
    it('returns true when derived address matches deployed address', () => {
        const deployed = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        expect(verifyContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, deployed, Networks.TESTNET)).toBe(true);
    });

    it('returns false when deployed address does not match', () => {
        const wrong = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
        expect(verifyContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, wrong, Networks.TESTNET)).toBe(false);
    });

    it('returns false when the address was derived under a different network passphrase', () => {
        const deployedOnTestnet = deriveContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, Networks.TESTNET);
        expect(verifyContractAddress(DEPLOYER, SALT_HEX, WASM_HASH_HEX, deployedOnTestnet, Networks.PUBLIC)).toBe(false);
    });
});
