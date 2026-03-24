/**
 * Soroban Contract Address Validation
 *
 * Validates Soroban contract addresses according to Stellar's contract address
 * specifications. Contract addresses are 56-character base32 encoded strings
 * starting with 'C'.
 */

export type ContractValidationResult =
    | { valid: true }
    | { valid: false; reason: string; code: string };

/**
 * Validate a single Soroban contract address format.
 * 
 * Soroban contract addresses follow SEP-0023 and are:
 * - 56 characters in length
 * - Base32 encoded (characters A-Z and 2-7)
 * - Start with 'C' (indicating contract)
 * 
 * @param address - The contract address to validate
 * @returns Validation result with validity and reason if invalid
 */
export function validateContractAddress(address: string): ContractValidationResult {
    if (!address) {
        return {
            valid: false,
            reason: 'Contract address cannot be empty',
            code: 'CONTRACT_ADDRESS_EMPTY',
        };
    }

    if (typeof address !== 'string') {
        return {
            valid: false,
            reason: 'Contract address must be a string',
            code: 'CONTRACT_ADDRESS_NOT_STRING',
        };
    }

    if (address.length !== 56) {
        return {
            valid: false,
            reason: `Contract address must be 56 characters long, got ${address.length}`,
            code: 'CONTRACT_ADDRESS_INVALID_LENGTH',
        };
    }

    if (address[0] !== 'C') {
        return {
            valid: false,
            reason: 'Contract address must start with "C"',
            code: 'CONTRACT_ADDRESS_INVALID_PREFIX',
        };
    }

    // Validate base32 encoding (valid characters: A-Z, 2-7)
    const base32Regex = /^[A-Z2-7]{56}$/;
    if (!base32Regex.test(address)) {
        return {
            valid: false,
            reason: 'Contract address contains invalid characters (must be base32: A-Z, 2-7)',
            code: 'CONTRACT_ADDRESS_INVALID_CHARSET',
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
