/**
 * SorobanContractValidator
 *
 * Validates Soroban smart contract addresses (format) and optionally verifies
 * contract deployment via the Soroban RPC API.
 *
 * Contract addresses are 56-character base32 strings starting with 'C'.
 * The existing pure function validateContractAddress in
 * apps/web/src/lib/stellar/contract-validation.ts handles format validation;
 * this service wraps it and adds RPC-based existence checking.
 *
 * Feature: soroban-contract-address-validation
 * Issue: #248
 */

import {
    validateContractAddress,
    type ContractValidationResult,
} from '@/lib/stellar/contract-validation';

export type { ContractValidationResult };

export interface ContractExistenceResult {
    exists: boolean;
    contractId: string;
    callable: boolean;
    error?: string;
}

export interface FetchLike {
    (input: string, init?: RequestInit): Promise<Response>;
}

export class SorobanContractValidator {
    constructor(private readonly _fetch: FetchLike = fetch) {}

    /**
     * Validate contract address format only (no network call).
     */
    validateFormat(address: unknown): ContractValidationResult {
        if (typeof address !== 'string') {
            return {
                valid: false,
                reason: 'Contract address must be a string',
                code: 'CONTRACT_ADDRESS_NOT_STRING' as any,
            };
        }
        return validateContractAddress(address);
    }

    /**
     * Verify a contract is deployed and callable via the Soroban RPC API.
     * Uses getLedgerEntries to check if the contract's WASM entry exists.
     */
    async checkExistence(contractId: string, sorobanRpcUrl: string): Promise<ContractExistenceResult> {
        const formatResult = validateContractAddress(contractId);
        if (!formatResult.valid) {
            return {
                exists: false,
                contractId,
                callable: false,
                error: formatResult.reason,
            };
        }

        try {
            const response = await this._fetch(sorobanRpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 'craft-contract-check',
                    method: 'getContractData',
                    params: {
                        contract: contractId,
                        key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // Wasm hash key
                        durability: 'persistent',
                    },
                }),
            });

            if (!response.ok) {
                return {
                    exists: false,
                    contractId,
                    callable: false,
                    error: `Soroban RPC returned HTTP ${response.status}`,
                };
            }

            const data = await response.json() as {
                result?: { entries?: unknown[] };
                error?: { code: number; message: string };
            };

            // RPC error with code -32600 range typically means contract not found
            if (data.error) {
                const notFound =
                    data.error.code === -32600 ||
                    data.error.message?.toLowerCase().includes('not found') ||
                    data.error.message?.toLowerCase().includes('does not exist');

                return {
                    exists: !notFound,
                    contractId,
                    callable: false,
                    error: data.error.message,
                };
            }

            const hasEntries = Array.isArray(data.result?.entries) && data.result!.entries!.length > 0;

            return {
                exists: hasEntries,
                contractId,
                callable: hasEntries,
            };
        } catch (err: unknown) {
            return {
                exists: false,
                contractId,
                callable: false,
                error: err instanceof Error ? err.message : 'Network error',
            };
        }
    }
}

export const sorobanContractValidator = new SorobanContractValidator();
