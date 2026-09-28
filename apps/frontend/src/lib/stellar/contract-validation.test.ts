import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    validateContractAddress,
    validateContractAddresses,
    type ContractValidationResult,
} from './contract-validation';
import { encodeContractAddress } from './strkey-test-utils';

// ── Valid Contract Addresses ─────────────────────────────────────────────────

// Real strkey-encoded contract IDs (valid CRC-16 checksum, version byte 0x10).
const VALID_TESTNET_CONTRACTS = {
    usdcContract: 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR',
    nativeTokenContract: 'CAAQQDYWDUSCWMRZIBDU4VK4MNVHC6D7Q2GZJG5CVGYLPPWFZTJ5U2RQ',
};

const VALID_MAINNET_CONTRACTS = {
    someContract: 'CAAQQDYWDUSCWMRZIBDU4VK4MNVHC6D7Q2GZJG5CVGYLPPWFZTJ5U2RQ',
};

// ── Invalid Contract Addresses ───────────────────────────────────────────────

const INVALID_CONTRACTS = {
    tooShort: 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHK',
    tooLong: 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQSTX',
    wrongPrefix: 'GBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST',
    invalidCharacters: 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7-FWVGNQST',
    invalidChars2: 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQS1', // 1 is invalid (not base32)
    // Well-formed base32, 56 chars, 'C' prefix — but the last char was altered so the CRC-16 no longer matches.
    badChecksum: 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KA',
    // Valid strkey (correct CRC) with version byte 0x11 instead of the CONTRACT type 0x10.
    wrongVersionByte: 'CEDQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOKO4',
    // A G... account address with its first char swapped to C.
    accountAddressAsContract: 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOZPI',
};

// ── Arbitraries for Property-Based Tests ─────────────────────────────────────

const validChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Valid contract arbitraries: real strkey encoding of 32 random bytes (version 0x10)
const arbValidContractAddress = fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .map(encodeContractAddress);

// Contract names
const arbContractName = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]*$/);

// ── Unit Tests: validateContractAddress ──────────────────────────────────────

describe('validateContractAddress', () => {
    describe('valid addresses', () => {
        it('accepts valid testnet contract address', () => {
            const result = validateContractAddress(VALID_TESTNET_CONTRACTS.usdcContract);
            expect(result).toEqual({ valid: true });
        });

        it('accepts another valid testnet contract', () => {
            const result = validateContractAddress(VALID_TESTNET_CONTRACTS.nativeTokenContract);
            expect(result).toEqual({ valid: true });
        });

        it('accepts valid mainnet contract address', () => {
            const result = validateContractAddress(VALID_MAINNET_CONTRACTS.someContract);
            expect(result).toEqual({ valid: true });
        });
    });

    describe('format validation', () => {
        it('rejects empty string', () => {
            const result = validateContractAddress('');
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_EMPTY');
        });

        it('rejects null address', () => {
            const result = validateContractAddress(null as any);
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_EMPTY');
        });

        it('rejects undefined address', () => {
            const result = validateContractAddress(undefined as any);
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_EMPTY');
        });

        it('rejects number input', () => {
            const result = validateContractAddress(123 as any);
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_NOT_STRING');
        });
    });

    describe('length validation', () => {
        it('rejects address too short', () => {
            const result = validateContractAddress(INVALID_CONTRACTS.tooShort);
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_INVALID_LENGTH');
        });

        it('rejects address too long', () => {
            const result = validateContractAddress(INVALID_CONTRACTS.tooLong);
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_INVALID_LENGTH');
        });
    });

    describe('prefix validation', () => {
        it('rejects address with wrong prefix (G)', () => {
            const result = validateContractAddress(INVALID_CONTRACTS.wrongPrefix);
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_INVALID_PREFIX');
        });

        it('rejects address with lowercase prefix', () => {
            const result = validateContractAddress('c' + VALID_TESTNET_CONTRACTS.usdcContract.slice(1));
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_INVALID_PREFIX');
        });
    });

    describe('checksum and version byte validation', () => {
        it('rejects an address with an invalid checksum', () => {
            const result = validateContractAddress(INVALID_CONTRACTS.badChecksum);
            expect(result.valid).toBe(false);
            expect((result as any).code).toBe('CONTRACT_ADDRESS_INVALID_CHECKSUM');
        });

        it('rejects a G... account address re-encoded with a C prefix', () => {
            const result = validateContractAddress(INVALID_CONTRACTS.accountAddressAsContract);
            expect(result.valid).toBe(false);
            expect((result as any).code).toBe('CONTRACT_ADDRESS_INVALID_CHECKSUM');
        });

        it('rejects a valid strkey whose version byte is not 0x10', () => {
            const result = validateContractAddress(INVALID_CONTRACTS.wrongVersionByte);
            expect(result.valid).toBe(false);
            expect((result as any).code).toBe('CONTRACT_ADDRESS_INVALID_VERSION_BYTE');
        });

        it('rejects addresses containing whitespace', () => {
            const result = validateContractAddress(` ${VALID_TESTNET_CONTRACTS.usdcContract}`);
            expect((result as any).code).toBe('CONTRACT_ADDRESS_WHITESPACE');
        });
    });

    describe('charset validation', () => {
        it('rejects address with invalid characters', () => {
            const result = validateContractAddress(INVALID_CONTRACTS.invalidCharacters);
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_INVALID_CHARSET');
        });

        it('rejects address with 1 (not in base32 alphabet)', () => {
            const result = validateContractAddress(INVALID_CONTRACTS.invalidChars2);
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_INVALID_CHARSET');
        });

        it('rejects address with 8 (not in base32 alphabet)', () => {
            const result = validateContractAddress('CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM78FWVGNQST');
            expect(result.valid).toBe(false);
            expect(result.code).toBe('CONTRACT_ADDRESS_INVALID_CHARSET');
        });
    });
});

// ── Property Tests: validateContractAddress ──────────────────────────────────

describe('validateContractAddress — Property Tests', () => {
    it('always validates generated valid addresses', () => {
        fc.assert(
            fc.property(arbValidContractAddress, (address) => {
                const result = validateContractAddress(address);
                expect(result.valid).toBe(true);
            })
        );
    });

    it('always rejects addresses shorter than 56 chars', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 55 }), (len) => {
                const shortAddr = 'C' + 'A'.repeat(len - 1);
                const result = validateContractAddress(shortAddr);
                expect(result.valid).toBe(false);
                expect(result.code).toBe('CONTRACT_ADDRESS_INVALID_LENGTH');
            })
        );
    });

    it('always rejects addresses starting with non-C character', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...'GABDEFGHIJKLMNOPQRSTUVWXYZ234567'.split('')),
                (prefix) => {
                    const addr = prefix + 'A'.repeat(55);
                    const result = validateContractAddress(addr);
                    if (prefix !== 'C') {
                        expect(result.valid).toBe(false);
                    }
                }
            )
        );
    });
});

// ── Unit Tests: validateContractAddresses ────────────────────────────────────

describe('validateContractAddresses', () => {
    it('returns valid for undefined contracts', () => {
        const result = validateContractAddresses(undefined);
        expect(result.valid).toBe(true);
    });

    it('returns valid for empty contract object', () => {
        const result = validateContractAddresses({});
        expect(result.valid).toBe(true);
    });

    it('returns valid for valid contracts', () => {
        const result = validateContractAddresses(VALID_TESTNET_CONTRACTS);
        expect(result.valid).toBe(true);
    });

    it('returns valid for single valid contract', () => {
        const result = validateContractAddresses({
            primary: VALID_TESTNET_CONTRACTS.usdcContract,
        });
        expect(result.valid).toBe(true);
    });

    it('rejects invalid contract and includes field path', () => {
        const result = validateContractAddresses({
            usdcContract: VALID_TESTNET_CONTRACTS.usdcContract,
            badContract: INVALID_CONTRACTS.tooShort,
        });

        expect(result.valid).toBe(false);
        expect((result as any).field).toBe('stellar.contractAddresses.badContract');
        expect((result as any).code).toBe('CONTRACT_ADDRESS_INVALID_LENGTH');
    });

    it('returns error for first invalid contract encountered', () => {
        const result = validateContractAddresses({
            first: VALID_TESTNET_CONTRACTS.usdcContract,
            second: INVALID_CONTRACTS.wrongPrefix,
            third: INVALID_CONTRACTS.tooShort, // This won't be checked
        });

        expect(result.valid).toBe(false);
        expect((result as any).code).toBe('CONTRACT_ADDRESS_INVALID_PREFIX');
    });

    it('includes descriptive error message for invalid contract', () => {
        const result = validateContractAddresses({
            defi: INVALID_CONTRACTS.invalidCharacters,
        });

        expect(result.valid).toBe(false);
        expect((result as any).reason).toContain('invalid characters');
    });
});

// ── Property Tests: validateContractAddresses ────────────────────────────────

describe('validateContractAddresses — Property Tests', () => {
    it('always validates records with all valid contracts', () => {
        fc.assert(
            fc.property(
                fc.dictionary(arbContractName, arbValidContractAddress, { minKeys: 1, maxKeys: 5 }),
                (contracts) => {
                    const result = validateContractAddresses(contracts);
                    expect(result.valid).toBe(true);
                }
            )
        );
    });

    it('always rejects records containing any invalid address', () => {
        fc.assert(
            fc.property(
                fc
                    .dictionary(arbContractName, arbValidContractAddress, { minKeys: 1, maxKeys: 4 })
                    .chain((valid) =>
                        fc.tuple(
                            fc.constant(valid),
                            arbContractName,
                            fc.constantFrom(...Object.values(INVALID_CONTRACTS))
                        )
                    ),
                ([validContracts, invalidName, invalidAddr]) => {
                    const contracts = { ...validContracts, [invalidName]: invalidAddr };
                    const result = validateContractAddresses(contracts);
                    expect(result.valid).toBe(false);
                }
            )
        );
    });
});
