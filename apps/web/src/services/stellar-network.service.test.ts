/**
 * Stellar Network Service Unit Tests
 *
 * Tests the core functionality of network validation, metadata retrieval,
 * and error handling for unsupported or invalid network selections.
 */

import { describe, it, expect } from 'vitest';
import {
    getSupportedNetworks,
    isNetworkSupported,
    getNetworkMetadata,
    validateNetworkSelection,
    coerceNetworkId,
    StellarNetworkService,
    stellarNetworkService,
    type StellarNetworkId,
} from './stellar-network.service';

describe('StellarNetworkService — Unit Tests', () => {
    describe('getSupportedNetworks', () => {
        it('returns an array of supported network identifiers', () => {
            const networks = getSupportedNetworks();
            expect(networks).toBeInstanceOf(Array);
            expect(networks.length).toBeGreaterThan(0);
        });

        it('includes mainnet and testnet', () => {
            const networks = getSupportedNetworks();
            expect(networks).toContain('mainnet');
            expect(networks).toContain('testnet');
        });

        it('returns a consistent array across multiple calls', () => {
            const networks1 = getSupportedNetworks();
            const networks2 = getSupportedNetworks();
            expect(networks1).toEqual(networks2);
        });
    });

    describe('isNetworkSupported', () => {
        it('returns true for mainnet', () => {
            expect(isNetworkSupported('mainnet')).toBe(true);
        });

        it('returns true for testnet', () => {
            expect(isNetworkSupported('testnet')).toBe(true);
        });

        it('returns false for unsupported networks', () => {
            expect(isNetworkSupported('devnet')).toBe(false);
            expect(isNetworkSupported('stagenet')).toBe(false);
            expect(isNetworkSupported('unknown')).toBe(false);
        });

        it('returns false for non-string types', () => {
            expect(isNetworkSupported(null)).toBe(false);
            expect(isNetworkSupported(undefined)).toBe(false);
            expect(isNetworkSupported(123)).toBe(false);
            expect(isNetworkSupported({})).toBe(false);
            expect(isNetworkSupported([])).toBe(false);
        });

        it('is case-sensitive', () => {
            expect(isNetworkSupported('Mainnet')).toBe(false);
            expect(isNetworkSupported('TESTNET')).toBe(false);
        });
    });

    describe('getNetworkMetadata', () => {
        it('returns metadata for mainnet', () => {
            const metadata = getNetworkMetadata('mainnet');
            expect(metadata).not.toBeNull();
            expect(metadata?.id).toBe('mainnet');
            expect(metadata?.name).toContain('Mainnet');
            expect(metadata?.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');
            expect(metadata?.horizonUrl).toBe('https://horizon.stellar.org');
            expect(metadata?.sorobanRpcUrl).toBe('https://soroban-rpc.stellar.org');
        });

        it('returns metadata for testnet', () => {
            const metadata = getNetworkMetadata('testnet');
            expect(metadata).not.toBeNull();
            expect(metadata?.id).toBe('testnet');
            expect(metadata?.name).toContain('Test Network');
            expect(metadata?.networkPassphrase).toBe('Test SDF Network ; September 2015');
            expect(metadata?.horizonUrl).toBe('https://horizon-testnet.stellar.org');
            expect(metadata?.sorobanRpcUrl).toBe('https://soroban-testnet.stellar.org');
        });

        it('includes environment configuration for mainnet', () => {
            const metadata = getNetworkMetadata('mainnet');
            expect(metadata?.environment).toEqual({
                NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet',
                NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
                NEXT_PUBLIC_NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
                NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-rpc.stellar.org',
            });
        });

        it('includes environment configuration for testnet', () => {
            const metadata = getNetworkMetadata('testnet');
            expect(metadata?.environment).toEqual({
                NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
                NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
                NEXT_PUBLIC_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
                NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
            });
        });
    });

    describe('validateNetworkSelection', () => {
        describe('valid networks', () => {
            it('validates mainnet successfully', () => {
                const result = validateNetworkSelection('mainnet');
                expect(result.valid).toBe(true);
                expect(result.network).toBe('mainnet');
                expect(result.metadata).not.toBeUndefined();
                expect(result.error).toBeUndefined();
            });

            it('validates testnet successfully', () => {
                const result = validateNetworkSelection('testnet');
                expect(result.valid).toBe(true);
                expect(result.network).toBe('testnet');
                expect(result.metadata).not.toBeUndefined();
                expect(result.error).toBeUndefined();
            });

            it('includes metadata in successful validation', () => {
                const result = validateNetworkSelection('mainnet');
                expect(result.metadata?.id).toBe('mainnet');
                expect(result.metadata?.networkPassphrase).toBeDefined();
                expect(result.metadata?.horizonUrl).toBeDefined();
            });
        });

        describe('missing/null values', () => {
            it('returns MISSING_NETWORK error for null', () => {
                const result = validateNetworkSelection(null);
                expect(result.valid).toBe(false);
                expect(result.error?.code).toBe('MISSING_NETWORK');
                expect(result.error?.message).toContain('required');
            });

            it('returns MISSING_NETWORK error for undefined', () => {
                const result = validateNetworkSelection(undefined);
                expect(result.valid).toBe(false);
                expect(result.error?.code).toBe('MISSING_NETWORK');
            });
        });

        describe('invalid types', () => {
            it('returns INVALID_NETWORK_TYPE error for numbers', () => {
                const result = validateNetworkSelection(123);
                expect(result.valid).toBe(false);
                expect(result.error?.code).toBe('INVALID_NETWORK_TYPE');
                expect(result.error?.message).toContain('string');
            });

            it('returns INVALID_NETWORK_TYPE error for objects', () => {
                const result = validateNetworkSelection({});
                expect(result.valid).toBe(false);
                expect(result.error?.code).toBe('INVALID_NETWORK_TYPE');
            });

            it('returns INVALID_NETWORK_TYPE error for arrays', () => {
                const result = validateNetworkSelection(['mainnet']);
                expect(result.valid).toBe(false);
                expect(result.error?.code).toBe('INVALID_NETWORK_TYPE');
            });

            it('returns INVALID_NETWORK_TYPE error for booleans', () => {
                const result = validateNetworkSelection(true);
                expect(result.valid).toBe(false);
                expect(result.error?.code).toBe('INVALID_NETWORK_TYPE');
            });
        });

        describe('unsupported networks', () => {
            it('returns UNSUPPORTED_NETWORK error for devnet', () => {
                const result = validateNetworkSelection('devnet');
                expect(result.valid).toBe(false);
                expect(result.error?.code).toBe('UNSUPPORTED_NETWORK');
                expect(result.error?.message).toContain('devnet');
                expect(result.error?.message).toContain('mainnet');
            });

            it('returns UNSUPPORTED_NETWORK error for custom networks', () => {
                const result = validateNetworkSelection('my-custom-network');
                expect(result.valid).toBe(false);
                expect(result.error?.code).toBe('UNSUPPORTED_NETWORK');
            });

            it('mentions supported networks in error message', () => {
                const result = validateNetworkSelection('stagenet');
                expect(result.error?.message).toContain('mainnet');
                expect(result.error?.message).toContain('testnet');
            });
        });

        describe('error contract', () => {
            it('always includes field in error', () => {
                const result1 = validateNetworkSelection(null);
                const result2 = validateNetworkSelection('invalid');
                const result3 = validateNetworkSelection(123);

                expect(result1.error?.field).toBe('stellar.network');
                expect(result2.error?.field).toBe('stellar.network');
                expect(result3.error?.field).toBe('stellar.network');
            });

            it('always includes message in error', () => {
                const result1 = validateNetworkSelection(null);
                const result2 = validateNetworkSelection('invalid');
                expect(result1.error?.message).toBeDefined();
                expect(result2.error?.message).toBeDefined();
            });

            it('always includes code in error', () => {
                const result1 = validateNetworkSelection(null);
                const result2 = validateNetworkSelection('invalid');
                expect(result1.error?.code).toBeDefined();
                expect(result2.error?.code).toBeDefined();
            });
        });
    });

    describe('coerceNetworkId', () => {
        it('coerces valid mainnet string', () => {
            const result = coerceNetworkId('mainnet');
            expect(result).toBe('mainnet');
        });

        it('coerces valid testnet string', () => {
            const result = coerceNetworkId('testnet');
            expect(result).toBe('testnet');
        });

        it('throws for null', () => {
            expect(() => coerceNetworkId(null)).toThrow();
        });

        it('throws for undefined', () => {
            expect(() => coerceNetworkId(undefined)).toThrow();
        });

        it('throws for unsupported network', () => {
            expect(() => coerceNetworkId('devnet')).toThrow();
        });

        it('throws for invalid type', () => {
            expect(() => coerceNetworkId(123)).toThrow();
        });

        it('error message is descriptive', () => {
            try {
                coerceNetworkId('invalid-network');
                expect.fail('Should have thrown');
            } catch (error: any) {
                expect(error.message).toContain('invalid-network');
                expect(error.message).toContain('supported');
            }
        });
    });

    describe('StellarNetworkService class', () => {
        it('provides instance-based API', () => {
            const service = new StellarNetworkService();
            expect(service).toHaveProperty('getSupportedNetworks');
            expect(service).toHaveProperty('isSupported');
            expect(service).toHaveProperty('validate');
            expect(service).toHaveProperty('getMetadata');
            expect(service).toHaveProperty('coerce');
        });

        it('getSupportedNetworks returns same as module function', () => {
            const service = new StellarNetworkService();
            expect(service.getSupportedNetworks()).toEqual(getSupportedNetworks());
        });

        it('isSupported has same behavior as module function', () => {
            const service = new StellarNetworkService();
            expect(service.isSupported('mainnet')).toBe(isNetworkSupported('mainnet'));
            expect(service.isSupported('invalid')).toBe(isNetworkSupported('invalid'));
        });

        it('validate has same behavior as module function', () => {
            const service = new StellarNetworkService();
            const input = 'mainnet';
            expect(service.validate(input)).toEqual(validateNetworkSelection(input));
        });

        it('getMetadata has same behavior as module function', () => {
            const service = new StellarNetworkService();
            expect(service.getMetadata('mainnet')).toEqual(getNetworkMetadata('mainnet'));
        });

        it('coerce has same behavior as module function', () => {
            const service = new StellarNetworkService();
            expect(service.coerce('testnet')).toBe(coerceNetworkId('testnet'));
        });
    });

    describe('singleton instance', () => {
        it('stellarNetworkService is a StellarNetworkService instance', () => {
            expect(stellarNetworkService).toBeInstanceOf(StellarNetworkService);
        });

        it('singleton provides all methods', () => {
            expect(typeof stellarNetworkService.getSupportedNetworks).toBe('function');
            expect(typeof stellarNetworkService.isSupported).toBe('function');
            expect(typeof stellarNetworkService.validate).toBe('function');
            expect(typeof stellarNetworkService.getMetadata).toBe('function');
            expect(typeof stellarNetworkService.coerce).toBe('function');
        });
    });

    describe('integration scenarios', () => {
        it('validates then retrieves metadata in one flow', () => {
            const input = 'mainnet';
            const validation = validateNetworkSelection(input);

            if (validation.valid && validation.network) {
                const metadata = getNetworkMetadata(validation.network);
                expect(metadata).not.toBeNull();
                expect(metadata?.id).toBe('mainnet');
            } else {
                expect.fail('Validation should succeed');
            }
        });

        it('handles environment variable coercion', () => {
            const envValue = process.env.TEST_NETWORK || 'testnet';
            const network = coerceNetworkId(envValue);
            expect(['mainnet', 'testnet']).toContain(network);
        });

        it('provides complete configuration for code generation', () => {
            const result = validateNetworkSelection('mainnet');
            if (result.valid && result.metadata) {
                const { environment } = result.metadata;
                expect(environment.NEXT_PUBLIC_STELLAR_NETWORK).toBe('mainnet');
                expect(environment.NEXT_PUBLIC_HORIZON_URL).toBeDefined();
                expect(environment.NEXT_PUBLIC_NETWORK_PASSPHRASE).toBeDefined();
                expect(environment.NEXT_PUBLIC_SOROBAN_RPC_URL).toBeDefined();
            }
        });
    });
});
