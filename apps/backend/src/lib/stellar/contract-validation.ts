/**
 * Soroban Contract Address Validation
 *
 * Validates Soroban contract addresses according to Stellar's contract address
 * specifications (SEP-0023 / strkey). Contract addresses are 56-character
 * base32 encoded strings starting with 'C'.
 */

export type ContractValidationResult =
    | { valid: true }
    | { valid: false; reason: string; code: string };

// Base32 alphabet used by Stellar strkey
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decode a base32 string to a Uint8Array (no padding required). */
function base32Decode(input: string): Uint8Array {
    const output: number[] = [];
    let buffer = 0;
    let bitsLeft = 0;

    for (const char of input) {
        const val = BASE32_ALPHABET.indexOf(char);
        if (val < 0) throw new Error(`Invalid base32 character: ${char}`);
        buffer = (buffer << 5) | val;
        bitsLeft += 5;
        if (bitsLeft >= 8) {
            bitsLeft -= 8;
            output.push((buffer >> bitsLeft) & 0xff);
        }
    }
    return new Uint8Array(output);
}

/** CRC-16/XMODEM as used by Stellar strkey. */
function crc16(data: Uint8Array): number {
    let crc = 0x0000;
    for (const byte of data) {
        crc ^= byte << 8;
        for (let i = 0; i < 8; i++) {
            crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }
    return crc & 0xffff;
}

/**
 * Verify the Stellar strkey checksum embedded in a contract address.
 * The last 2 bytes of the decoded payload are a little-endian CRC-16 of the
 * preceding bytes.
 */
function verifyStrKeyChecksum(address: string): boolean {
    try {
        const decoded = base32Decode(address);
        if (decoded.length < 3) return false;
        const payload = decoded.slice(0, -2);
        const storedCrc = decoded[decoded.length - 2]! | (decoded[decoded.length - 1]! << 8);
        return crc16(payload) === storedCrc;
    } catch {
        return false;
    }
}

/**
 * Validate a single Soroban contract address format.
 *
 * Checks (in order):
 * 1. Whitespace — address must not contain any whitespace
 * 2. Empty — address must not be empty
 * 3. Length — must be exactly 56 characters
 * 4. Prefix — must start with 'C'
 * 5. Charset — must be valid base32 (A-Z, 2-7)
 * 6. Checksum — Stellar strkey CRC-16 must match
 *
 * @param address - The contract address to validate
 * @returns Validation result with validity and reason if invalid
 */
export function validateContractAddress(address: string): ContractValidationResult {
    // 1. Whitespace check (before empty check so we catch whitespace-only strings)
    if (/\s/.test(address)) {
        return {
            valid: false,
            reason: 'Contract address must not contain whitespace',
            code: 'CONTRACT_ADDRESS_WHITESPACE',
        };
    }

    // 2. Empty check
    if (!address) {
        return {
            valid: false,
            reason: 'Contract address cannot be empty',
            code: 'CONTRACT_ADDRESS_EMPTY',
        };
    }

    // 3. Length check
    if (address.length !== 56) {
        return {
            valid: false,
            reason: `Contract address must be 56 characters long, got ${address.length}`,
            code: 'CONTRACT_ADDRESS_INVALID_LENGTH',
        };
    }

    // 4. Prefix check
    if (address[0] !== 'C') {
        return {
            valid: false,
            reason: 'Contract address must start with "C"',
            code: 'CONTRACT_ADDRESS_INVALID_PREFIX',
        };
    }

    // 5. Charset check — base32: A-Z and 2-7
    if (!/^[A-Z2-7]{56}$/.test(address)) {
        return {
            valid: false,
            reason: 'Contract address contains invalid characters (must be base32: A-Z, 2-7)',
            code: 'CONTRACT_ADDRESS_INVALID_CHARSET',
        };
    }

    // 6. Checksum check
    if (!verifyStrKeyChecksum(address)) {
        return {
            valid: false,
            reason: 'Contract address checksum is invalid',
            code: 'CONTRACT_ADDRESS_INVALID_CHECKSUM',
        };
    }

    return { valid: true };
}

/**
 * Validate all contract addresses in a record.
 * Returns first validation error encountered, or success.
 *
 * @param contracts - Object with contract name keys and address values
 * @returns Validation result with field path if invalid
 */
export function validateContractAddresses(
    contracts: Record<string, string> | undefined
): { valid: true } | { valid: false; field: string; reason: string; code: string } {
    if (!contracts || Object.keys(contracts).length === 0) {
        return { valid: true };
    }

    for (const [name, address] of Object.entries(contracts)) {
        const result = validateContractAddress(address);
        if (!result.valid) {
            return {
                valid: false,
                field: `stellar.contractAddresses.${name}`,
                reason: result.reason,
                code: result.code,
            };
        }
    }

    return { valid: true };
}
