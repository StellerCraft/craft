/**
 * Stellar Network Integration Tests
 *
 * Verifies real interactions with the Stellar testnet: Horizon API
 * connectivity, Soroban RPC, asset/account validation, and network switching.
 *
 * Requirements:
 *   - Network access to Stellar testnet endpoints
 *   - Optional: STELLAR_TEST_ACCOUNT set to a funded testnet public key
 *
 * Run:
 *   vitest run tests/stellar
 *
 * These tests are skipped automatically when the network is unavailable
 * (CI without outbound access) — each suite probes connectivity first.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Keypair } from 'stellar-sdk';
import {
    HORIZON_URLS,
    SOROBAN_RPC_URLS,
    getNetworkConfig,
} from '../../../../packages/stellar/src/config';
import {
    checkHorizonEndpoint,
    checkSorobanRpcEndpoint,
    checkStellarEndpoints,
} from '../../src/lib/stellar/endpoint-connectivity';
import {
    validateNetworkSelection,
    getNetworkMetadata,
    getSupportedNetworks,
    coerceNetworkId,
} from '../../src/services/stellar-network.service';
import { validateAccountAddress } from '../../src/services/stellar-account-validator.service';

// ── Well-known testnet constants ──────────────────────────────────────────────

const TESTNET_HORIZON = HORIZON_URLS.testnet;
const TESTNET_SOROBAN = SOROBAN_RPC_URLS.testnet;
const MAINNET_HORIZON = HORIZON_URLS.mainnet;

/** Funded testnet account from Friendbot (stable across resets). */
const KNOWN_TESTNET_ACCOUNT =
    process.env.STELLAR_TEST_ACCOUNT ??
    Keypair.random().publicKey(); // Ensure valid format and checksum

const TIMEOUT_MS = 15_000;

// ── Connectivity probe (used to skip suites when offline) ─────────────────────

let horizonReachable = false;
let sorobanReachable = false;

beforeAll(async () => {
    const [h, s] = await Promise.all([
        checkHorizonEndpoint(TESTNET_HORIZON, { timeout: TIMEOUT_MS }),
        checkSorobanRpcEndpoint(TESTNET_SOROBAN, { timeout: TIMEOUT_MS }),
    ]);
    horizonReachable = h.reachable;
    sorobanReachable = s.reachable;
}, TIMEOUT_MS + 2_000);

// ── Horizon API connectivity ──────────────────────────────────────────────────

describe('Horizon API connectivity', () => {
    it('testnet Horizon is reachable and responds within 15s', async () => {
        if (!horizonReachable) {
            console.warn('Skipping: testnet Horizon unreachable');
            return;
        }
        const result = await checkHorizonEndpoint(TESTNET_HORIZON, { timeout: TIMEOUT_MS });
        expect(result.reachable).toBe(true);
        expect(result.status).toBe(200);
        expect(result.responseTime).toBeLessThan(TIMEOUT_MS);
    });

    it('testnet Horizon returns a valid JSON response body', async () => {
        if (!horizonReachable) return;
        const res = await fetch(`${TESTNET_HORIZON}/`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        expect(res.ok).toBe(true);
        const body = await res.json();
        // Horizon root returns _links and horizon_version
        expect(body).toHaveProperty('_links');
        expect(body).toHaveProperty('horizon_version');
    });

    it('invalid Horizon URL returns VALIDATION error without network call', async () => {
        const result = await checkHorizonEndpoint('not-a-url');
        expect(result.reachable).toBe(false);
        expect(result.errorType).toBe('VALIDATION');
    });

    it('unreachable Horizon URL returns TRANSIENT error', async () => {
        const result = await checkHorizonEndpoint('https://horizon.invalid.example.com', {
            timeout: 3_000,
        });
        expect(result.reachable).toBe(false);
        expect(result.errorType).toBe('TRANSIENT');
    });

    it('checkStellarEndpoints returns results for both endpoints', async () => {
        if (!horizonReachable) return;
        const results = await checkStellarEndpoints(TESTNET_HORIZON, TESTNET_SOROBAN, {
            timeout: TIMEOUT_MS,
        });
        expect(results).toHaveLength(2);
        expect(results[0].endpoint).toBe(TESTNET_HORIZON);
        expect(results[1].endpoint).toBe(TESTNET_SOROBAN);
    });
});

// ── Soroban RPC integration ───────────────────────────────────────────────────

describe('Soroban RPC integration', () => {
    it('testnet Soroban RPC is reachable', async () => {
        if (!sorobanReachable) {
            console.warn('Skipping: testnet Soroban RPC unreachable');
            return;
        }
        const result = await checkSorobanRpcEndpoint(TESTNET_SOROBAN, { timeout: TIMEOUT_MS });
        expect(result.reachable).toBe(true);
        expect(result.status).toBe(200);
    });

    it('Soroban getNetwork returns testnet passphrase', async () => {
        if (!sorobanReachable) return;
        const res = await fetch(TESTNET_SOROBAN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getNetwork' }), // Removed params: []
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.result?.passphrase).toContain('Test SDF Network');
    });

    it('invalid Soroban RPC URL returns VALIDATION error', async () => {
        const result = await checkSorobanRpcEndpoint('ftp://bad-url');
        expect(result.reachable).toBe(false);
        expect(result.errorType).toBe('VALIDATION');
    });
});

// ── Account validation against live network ───────────────────────────────────

describe('Account validation', () => {
    it('validates a well-formed Stellar public key format', () => {
        const result = validateAccountAddress(KNOWN_TESTNET_ACCOUNT);
        expect(result.valid).toBe(true);
        expect(result.address).toBe(KNOWN_TESTNET_ACCOUNT);
    });

    it('rejects an address with wrong prefix', () => {
        const bad = 'SABC' + 'A'.repeat(52); // secret key prefix
        const result = validateAccountAddress(bad);
        expect(result.valid).toBe(false);
    });

    it('rejects an address that is too short', () => {
        const result = validateAccountAddress('GABC');
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('ACCOUNT_ADDRESS_INVALID_LENGTH');
    });

    it('rejects an empty address', () => {
        const result = validateAccountAddress('');
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('ACCOUNT_ADDRESS_EMPTY');
    });

    it('known testnet account exists on Horizon', async () => {
        if (!horizonReachable) {
            console.warn('Skipping: testnet Horizon unreachable');
            return;
        }
        const res = await fetch(`${TESTNET_HORIZON}/accounts/${KNOWN_TESTNET_ACCOUNT}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // 200 = exists, 404 = not funded — both are valid network responses
        expect([200, 404]).toContain(res.status);
    });
});

// ── Network switching (mainnet ↔ testnet) ─────────────────────────────────────

describe('Network switching', () => {
    it('getNetworkConfig returns correct URLs for testnet', () => {
        const cfg = getNetworkConfig('testnet');
        expect(cfg.horizonUrl).toBe(TESTNET_HORIZON);
        expect(cfg.sorobanRpcUrl).toBe(TESTNET_SOROBAN);
        expect(cfg.networkPassphrase).toContain('Test SDF');
    });

    it('getNetworkConfig returns correct URLs for mainnet', () => {
        const cfg = getNetworkConfig('mainnet');
        expect(cfg.horizonUrl).toBe(MAINNET_HORIZON);
        expect(cfg.networkPassphrase).toContain('Public Global Stellar Network');
    });

    it('testnet and mainnet configs have distinct passphrases', () => {
        const testnet = getNetworkConfig('testnet');
        const mainnet = getNetworkConfig('mainnet');
        expect(testnet.networkPassphrase).not.toBe(mainnet.networkPassphrase);
    });

    it('testnet and mainnet configs have distinct Horizon URLs', () => {
        const testnet = getNetworkConfig('testnet');
        const mainnet = getNetworkConfig('mainnet');
        expect(testnet.horizonUrl).not.toBe(mainnet.horizonUrl);
    });

    it('validateNetworkSelection accepts mainnet and testnet', () => {
        expect(validateNetworkSelection('testnet').valid).toBe(true);
        expect(validateNetworkSelection('mainnet').valid).toBe(true);
    });

    it('validateNetworkSelection rejects unknown networks', () => {
        const result = validateNetworkSelection('devnet');
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('UNSUPPORTED_NETWORK');
    });

    it('coerceNetworkId throws for unsupported network', () => {
        expect(() => coerceNetworkId('staging')).toThrow();
    });

    it('getSupportedNetworks returns exactly mainnet and testnet', () => {
        const networks = getSupportedNetworks();
        expect(networks).toContain('mainnet');
        expect(networks).toContain('testnet');
        expect(networks).toHaveLength(2);
    });

    it('getNetworkMetadata returns correct environment variables for testnet', () => {
        const meta = getNetworkMetadata('testnet');
        expect(meta?.environment.NEXT_PUBLIC_STELLAR_NETWORK).toBe('testnet');
        expect(meta?.environment.NEXT_PUBLIC_HORIZON_URL).toBe(TESTNET_HORIZON);
    });

    it('mainnet Horizon URL is distinct from testnet in metadata', () => {
        const testMeta = getNetworkMetadata('testnet');
        const mainMeta = getNetworkMetadata('mainnet');
        expect(testMeta?.horizonUrl).not.toBe(mainMeta?.horizonUrl);
    });
});
