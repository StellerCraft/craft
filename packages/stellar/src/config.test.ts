/**
 * Snapshot Regression Tests for Stellar Network Configuration
 *
 * Captures and diffs Stellar network configuration outputs to catch unintended
 * changes in network passphrase handling, RPC endpoint resolution, and config
 * serialization.
 *
 * Issue: #540
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getNetworkConfig, NETWORK_PASSPHRASES, HORIZON_URLS, SOROBAN_RPC_URLS } from './config';

describe('Stellar Config — Snapshot Regression Tests (#540)', () => {
    describe('getNetworkConfig — testnet', () => {
        it('should match snapshot for testnet configuration', () => {
            const config = getNetworkConfig('testnet');
            expect(config).toMatchSnapshot();
        });

        it('should have correct network passphrase for testnet', () => {
            const config = getNetworkConfig('testnet');
            expect(config.networkPassphrase).toBe(NETWORK_PASSPHRASES.testnet);
            expect(config.networkPassphrase).toMatchSnapshot();
        });

        it('should have correct Horizon URL for testnet', () => {
            const config = getNetworkConfig('testnet');
            expect(config.horizonUrl).toBe(HORIZON_URLS.testnet);
            expect(config.horizonUrl).toMatchSnapshot();
        });

        it('should have correct Soroban RPC URL for testnet', () => {
            const config = getNetworkConfig('testnet');
            expect(config.sorobanRpcUrl).toBe(SOROBAN_RPC_URLS.testnet);
            expect(config.sorobanRpcUrl).toMatchSnapshot();
        });

        it('should have network field set to testnet', () => {
            const config = getNetworkConfig('testnet');
            expect(config.network).toBe('testnet');
            expect(config.network).toMatchSnapshot();
        });
    });

    describe('getNetworkConfig — mainnet', () => {
        it('should match snapshot for mainnet configuration', () => {
            const config = getNetworkConfig('mainnet');
            expect(config).toMatchSnapshot();
        });

        it('should have correct network passphrase for mainnet', () => {
            const config = getNetworkConfig('mainnet');
            expect(config.networkPassphrase).toBe(NETWORK_PASSPHRASES.mainnet);
            expect(config.networkPassphrase).toMatchSnapshot();
        });

        it('should have correct Horizon URL for mainnet', () => {
            const config = getNetworkConfig('mainnet');
            expect(config.horizonUrl).toBe(HORIZON_URLS.mainnet);
            expect(config.horizonUrl).toMatchSnapshot();
        });

        it('should have correct Soroban RPC URL for mainnet', () => {
            const config = getNetworkConfig('mainnet');
            expect(config.sorobanRpcUrl).toBe(SOROBAN_RPC_URLS.mainnet);
            expect(config.sorobanRpcUrl).toMatchSnapshot();
        });

        it('should have network field set to mainnet', () => {
            const config = getNetworkConfig('mainnet');
            expect(config.network).toBe('mainnet');
            expect(config.network).toMatchSnapshot();
        });
    });

    describe('Network Configuration Constants', () => {
        it('should match snapshot for NETWORK_PASSPHRASES', () => {
            expect(NETWORK_PASSPHRASES).toMatchSnapshot();
        });

        it('should match snapshot for HORIZON_URLS', () => {
            expect(HORIZON_URLS).toMatchSnapshot();
        });

        it('should match snapshot for SOROBAN_RPC_URLS', () => {
            expect(SOROBAN_RPC_URLS).toMatchSnapshot();
        });

        it('should have all required networks in NETWORK_PASSPHRASES', () => {
            expect(Object.keys(NETWORK_PASSPHRASES).sort()).toMatchSnapshot();
        });

        it('should have all required networks in HORIZON_URLS', () => {
            expect(Object.keys(HORIZON_URLS).sort()).toMatchSnapshot();
        });

        it('should have all required networks in SOROBAN_RPC_URLS', () => {
            expect(Object.keys(SOROBAN_RPC_URLS).sort()).toMatchSnapshot();
        });
    });

    describe('Configuration Consistency', () => {
        it('should have matching network keys across all config objects', () => {
            const passphraseKeys = Object.keys(NETWORK_PASSPHRASES).sort();
            const horizonKeys = Object.keys(HORIZON_URLS).sort();
            const sorobanKeys = Object.keys(SOROBAN_RPC_URLS).sort();

            expect(passphraseKeys).toEqual(horizonKeys);
            expect(horizonKeys).toEqual(sorobanKeys);
            expect(passphraseKeys).toMatchSnapshot();
        });

        it('should return consistent config shape for all networks', () => {
            const testnetConfig = getNetworkConfig('testnet');
            const mainnetConfig = getNetworkConfig('mainnet');

            expect(Object.keys(testnetConfig).sort()).toEqual(Object.keys(mainnetConfig).sort());
            expect(Object.keys(testnetConfig).sort()).toMatchSnapshot();
        });

        it('should have all required fields in config output', () => {
            const config = getNetworkConfig('testnet');
            expect(Object.keys(config).sort()).toMatchSnapshot();
            expect(config).toHaveProperty('network');
            expect(config).toHaveProperty('horizonUrl');
            expect(config).toHaveProperty('networkPassphrase');
            expect(config).toHaveProperty('sorobanRpcUrl');
        });
    });

    describe('Serialization Stability', () => {
        it('should serialize testnet config consistently', () => {
            const config = getNetworkConfig('testnet');
            const serialized = JSON.stringify(config);
            expect(serialized).toMatchSnapshot();
        });

        it('should serialize mainnet config consistently', () => {
            const config = getNetworkConfig('mainnet');
            const serialized = JSON.stringify(config);
            expect(serialized).toMatchSnapshot();
        });

        it('should deserialize and re-serialize to same value', () => {
            const config = getNetworkConfig('testnet');
            const serialized1 = JSON.stringify(config);
            const deserialized = JSON.parse(serialized1);
            const serialized2 = JSON.stringify(deserialized);
            expect(serialized1).toBe(serialized2);
            expect(serialized1).toMatchSnapshot();
        });
    });

    describe('URL Format Validation', () => {
        it('should have valid HTTPS URLs for Horizon endpoints', () => {
            Object.values(HORIZON_URLS).forEach((url) => {
                expect(url).toMatch(/^https:\/\//);
                expect(url).toMatchSnapshot();
            });
        });

        it('should have valid HTTPS URLs for Soroban RPC endpoints', () => {
            Object.values(SOROBAN_RPC_URLS).forEach((url) => {
                expect(url).toMatch(/^https:\/\//);
                expect(url).toMatchSnapshot();
            });
        });

        it('should have no trailing slashes in URLs', () => {
            Object.values(HORIZON_URLS).forEach((url) => {
                expect(url).not.toMatch(/\/$/);
            });
            Object.values(SOROBAN_RPC_URLS).forEach((url) => {
                expect(url).not.toMatch(/\/$/);
            });
        });
    });

    describe('Passphrase Format Validation', () => {
        it('should have valid Stellar network passphrases', () => {
            Object.values(NETWORK_PASSPHRASES).forEach((passphrase) => {
                expect(typeof passphrase).toBe('string');
                expect(passphrase.length).toBeGreaterThan(0);
                expect(passphrase).toMatchSnapshot();
            });
        });

        it('should have distinct passphrases for each network', () => {
            const passphrases = Object.values(NETWORK_PASSPHRASES);
            const uniquePassphrases = new Set(passphrases);
            expect(uniquePassphrases.size).toBe(passphrases.length);
        });
    });

    describe('resolveNetwork — unrecognized value handling (#958)', () => {
        beforeEach(() => {
            delete process.env.STELLAR_NETWORK;
            delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
            vi.spyOn(console, 'warn').mockImplementation(() => {});
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('should silently default to testnet when STELLAR_NETWORK is unset', () => {
            delete process.env.STELLAR_NETWORK;
            delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
            const config = getNetworkConfig();
            expect(config.network).toBe('testnet');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('should resolve mainnet when STELLAR_NETWORK=mainnet', () => {
            process.env.STELLAR_NETWORK = 'mainnet';
            const config = getNetworkConfig();
            expect(config.network).toBe('mainnet');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('should resolve testnet when STELLAR_NETWORK=testnet', () => {
            process.env.STELLAR_NETWORK = 'testnet';
            const config = getNetworkConfig();
            expect(config.network).toBe('testnet');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('should warn and default to testnet for unrecognized STELLAR_NETWORK', () => {
            process.env.STELLAR_NETWORK = 'production';
            const config = getNetworkConfig();
            expect(config.network).toBe('testnet');
            expect(console.warn).toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining('Unrecognized STELLAR_NETWORK value')
            );
        });

        it('should warn for capitalization typos like Mainnet', () => {
            process.env.STELLAR_NETWORK = 'Mainnet';
            const config = getNetworkConfig();
            expect(config.network).toBe('testnet');
            expect(console.warn).toHaveBeenCalled();
        });

        it('should trim whitespace before validation', () => {
            process.env.STELLAR_NETWORK = '  mainnet  ';
            const config = getNetworkConfig();
            expect(config.network).toBe('mainnet');
            expect(console.warn).not.toHaveBeenCalled();
        });

        it('should trim whitespace and still warn for unrecognized values', () => {
            process.env.STELLAR_NETWORK = '  production  ';
            const config = getNetworkConfig();
            expect(config.network).toBe('testnet');
            expect(console.warn).toHaveBeenCalled();
        });
    });
});

// ---------------------------------------------------------------------------
// Regression #1106 – config.stellar must re-resolve on env change
// ---------------------------------------------------------------------------

describe('config.stellar live getter (regression #1106)', () => {
    let originalNetwork: string | undefined;

    beforeEach(() => {
        originalNetwork = process.env.STELLAR_NETWORK;
    });

    afterEach(() => {
        if (originalNetwork === undefined) {
            delete process.env.STELLAR_NETWORK;
        } else {
            process.env.STELLAR_NETWORK = originalNetwork;
        }
    });

    it('reflects a change to STELLAR_NETWORK made after module load', async () => {
        // Dynamically import so the getter is exercised at call-time, not frozen
        const { config } = await import('./config');

        process.env.STELLAR_NETWORK = 'testnet';
        const first = config.stellar.network;

        process.env.STELLAR_NETWORK = 'mainnet';
        const second = config.stellar.network;

        expect(first).toBe('testnet');
        expect(second).toBe('mainnet');
        // The critical assertion: the two reads must differ
        expect(first).not.toBe(second);
    });

    it('returns testnet after switching back from mainnet', async () => {
        const { config } = await import('./config');

        process.env.STELLAR_NETWORK = 'mainnet';
        expect(config.stellar.network).toBe('mainnet');

        process.env.STELLAR_NETWORK = 'testnet';
        expect(config.stellar.network).toBe('testnet');
    });

    it('config.stellar always returns the same shape as getNetworkConfig()', async () => {
        const { config, getNetworkConfig: getConfig } = await import('./config');

        process.env.STELLAR_NETWORK = 'mainnet';
        const live = config.stellar;
        const snapshot = getConfig();

        expect(live.network).toBe(snapshot.network);
        expect(live.horizonUrl).toBe(snapshot.horizonUrl);
        expect(live.networkPassphrase).toBe(snapshot.networkPassphrase);
        expect(live.sorobanRpcUrl).toBe(snapshot.sorobanRpcUrl);
    });
});
// ---------------------------------------------------------------------------
// End regression #1106
// ---------------------------------------------------------------------------
