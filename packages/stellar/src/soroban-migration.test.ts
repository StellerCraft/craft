/**
 * Soroban Cross-Network Migration Tests (#617)
 *
 * Tests rejection of testnet parameters on mainnet and the full promotion
 * flow with valid mainnet config.
 */

import { describe, it, expect } from 'vitest';
import { Networks, Keypair } from 'stellar-sdk';
import {
    migrateSorobanContract,
    detectTestnetParameters,
    SchemaRegistry,
    encodeVersioned,
    decodeVersioned,
    runSchemaMigration,
} from './soroban-migration';
import { NETWORK_PASSPHRASES, HORIZON_URLS, SOROBAN_RPC_URLS } from './config';

const MAINNET_CONFIG = {
    network: 'mainnet' as const,
    horizonUrl: HORIZON_URLS.mainnet,
    networkPassphrase: NETWORK_PASSPHRASES.mainnet,
    sorobanRpcUrl: SOROBAN_RPC_URLS.mainnet,
};

const TESTNET_CONFIG = {
    network: 'testnet' as const,
    horizonUrl: HORIZON_URLS.testnet,
    networkPassphrase: NETWORK_PASSPHRASES.testnet,
    sorobanRpcUrl: SOROBAN_RPC_URLS.testnet,
};

const DUMMY_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const SOURCE_KEY = Keypair.random().publicKey();

// ---------------------------------------------------------------------------
// detectTestnetParameters
// ---------------------------------------------------------------------------

describe('detectTestnetParameters', () => {
    it('returns null for a valid mainnet config', () => {
        expect(detectTestnetParameters(MAINNET_CONFIG)).toBeNull();
    });

    it('detects testnet network passphrase', () => {
        const cfg = { ...MAINNET_CONFIG, networkPassphrase: NETWORK_PASSPHRASES.testnet };
        expect(detectTestnetParameters(cfg)).toContain('networkPassphrase');
    });

    it('detects testnet horizonUrl', () => {
        const cfg = { ...MAINNET_CONFIG, horizonUrl: HORIZON_URLS.testnet };
        expect(detectTestnetParameters(cfg)).toContain('horizonUrl');
    });

    it('detects testnet sorobanRpcUrl', () => {
        const cfg = { ...MAINNET_CONFIG, sorobanRpcUrl: SOROBAN_RPC_URLS.testnet };
        expect(detectTestnetParameters(cfg)).toContain('sorobanRpcUrl');
    });

    it('detects "testnet" as the network value', () => {
        const cfg = { ...MAINNET_CONFIG, network: 'testnet' as const };
        expect(detectTestnetParameters(cfg)).toContain('network');
    });

    it('detects testnet horizonUrl with trailing slash', () => {
        const cfg = { ...MAINNET_CONFIG, horizonUrl: HORIZON_URLS.testnet + '/' };
        expect(detectTestnetParameters(cfg)).toContain('horizonUrl');
    });

    it('detects testnet horizonUrl with uppercase scheme', () => {
        const testnetUrl = HORIZON_URLS.testnet;
        const uppercaseUrl = 'HTTPS://' + testnetUrl.substring('https://'.length);
        const cfg = { ...MAINNET_CONFIG, horizonUrl: uppercaseUrl };
        expect(detectTestnetParameters(cfg)).toContain('horizonUrl');
    });

    it('detects testnet sorobanRpcUrl with mixed case', () => {
        const testnetUrl = SOROBAN_RPC_URLS.testnet;
        const mixedCaseUrl = 'HTTPS://SOROBAN-TESTNET.stellar.org/';
        const cfg = { ...MAINNET_CONFIG, sorobanRpcUrl: mixedCaseUrl };
        expect(detectTestnetParameters(cfg)).toContain('sorobanRpcUrl');
    });

    it('detects URL containing "testnet" substring', () => {
        const cfg = { ...MAINNET_CONFIG, horizonUrl: 'https://custom-testnet.example.com' };
        expect(detectTestnetParameters(cfg)).toContain('horizonUrl');
    });
});

// ---------------------------------------------------------------------------
// migrateSorobanContract
// ---------------------------------------------------------------------------

describe('migrateSorobanContract – mainnet promotion', () => {
    it('rejects when confirm is omitted', () => {
        const result = migrateSorobanContract({
            wasmBinary: DUMMY_WASM,
            sourcePublicKey: SOURCE_KEY,
            config: MAINNET_CONFIG,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('explicit confirmation');
    });

    it('rejects when confirm is false', () => {
        const result = migrateSorobanContract({
            wasmBinary: DUMMY_WASM,
            sourcePublicKey: SOURCE_KEY,
            config: MAINNET_CONFIG,
            confirm: false,
        });
        expect(result.ok).toBe(false);
    });

    it('rejects testnet passphrase on mainnet even with confirm', () => {
        const result = migrateSorobanContract({
            wasmBinary: DUMMY_WASM,
            sourcePublicKey: SOURCE_KEY,
            config: { ...MAINNET_CONFIG, networkPassphrase: Networks.TESTNET },
            confirm: true,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('networkPassphrase');
    });

    it('rejects testnet horizonUrl on mainnet even with confirm', () => {
        const result = migrateSorobanContract({
            wasmBinary: DUMMY_WASM,
            sourcePublicKey: SOURCE_KEY,
            config: { ...MAINNET_CONFIG, horizonUrl: HORIZON_URLS.testnet },
            confirm: true,
        });
        expect(result.ok).toBe(false);
    });

    it('succeeds with valid mainnet config and confirm: true', () => {
        const result = migrateSorobanContract({
            wasmBinary: DUMMY_WASM,
            sourcePublicKey: SOURCE_KEY,
            config: MAINNET_CONFIG,
            confirm: true,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.network).toBe('mainnet');
            expect(result.message).toContain('mainnet');
        }
    });
});

describe('migrateSorobanContract – testnet flow', () => {
    it('succeeds on testnet without requiring confirm', () => {
        const result = migrateSorobanContract({
            wasmBinary: DUMMY_WASM,
            sourcePublicKey: SOURCE_KEY,
            config: TESTNET_CONFIG,
        });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.network).toBe('testnet');
    });
});

// ── Schema versioning (#786) ──────────────────────────────────────────────────

const encodeString = (s: string) => new TextEncoder().encode(s);
const decodeString = (b: Uint8Array) => new TextDecoder().decode(b);

const encodeObj = (o: object) => encodeString(JSON.stringify(o));
const decodeObj = (b: Uint8Array) => JSON.parse(decodeString(b));

describe('SchemaRegistry', () => {
    it('registers and retrieves a schema by version', () => {
        const registry = new SchemaRegistry();
        registry.register({ version: 1, decode: decodeString, encode: encodeString });
        expect(registry.has(1)).toBe(true);
        expect(registry.get(1)?.version).toBe(1);
    });

    it('returns all versions in ascending order', () => {
        const registry = new SchemaRegistry();
        registry.register({ version: 3, decode: decodeString, encode: encodeString });
        registry.register({ version: 1, decode: decodeString, encode: encodeString });
        registry.register({ version: 2, decode: decodeString, encode: encodeString });
        expect(registry.versions()).toEqual([1, 2, 3]);
    });
});

describe('encodeVersioned / decodeVersioned', () => {
    it('round-trips a v1 value through encode/decode', () => {
        const registry = new SchemaRegistry();
        registry.register({ version: 1, decode: decodeString, encode: encodeString });

        const schema = registry.get(1)!;
        const raw = encodeVersioned('hello', schema as Parameters<typeof encodeVersioned>[1]);
        const { schemaVersion, data } = decodeVersioned<string>(raw, registry);

        expect(schemaVersion).toBe(1);
        expect(data).toBe('hello');
    });

    it('blocks downgrade when schema version is not in registry', () => {
        const registry = new SchemaRegistry();
        // Only v2 registered, but raw bytes claim v3
        registry.register({ version: 2, decode: decodeString, encode: encodeString });

        // Build raw bytes with version prefix = 3
        const payload = encodeString('data');
        const raw = new Uint8Array(4 + payload.byteLength);
        new DataView(raw.buffer).setUint32(0, 3, true);
        raw.set(payload, 4);

        expect(() => decodeVersioned(raw, registry)).toThrow(/downgrade blocked/);
    });

    it('throws when buffer is too short', () => {
        const registry = new SchemaRegistry();
        expect(() => decodeVersioned(new Uint8Array(2), registry)).toThrow(/too short/);
    });
});

describe('runSchemaMigration', () => {
    it('migrates v1 data to v2', () => {
        const registry = new SchemaRegistry();
        registry.register({ version: 1, decode: decodeObj, encode: encodeObj });
        registry.register({ version: 2, decode: decodeObj, encode: encodeObj });

        const schema1 = registry.get(1)!;
        const raw = encodeVersioned({ name: 'Alice' }, schema1 as Parameters<typeof encodeVersioned>[1]);

        const result = runSchemaMigration<{ name: string; displayName: string }>(
            raw,
            registry,
            [{
                fromVersion: 1,
                toVersion: 2,
                migrate: (_ver, data) => ({ ...(data as object), displayName: (data as { name: string }).name }),
            }],
            2,
        );

        expect(result).toEqual({ name: 'Alice', displayName: 'Alice' });
    });

    it('returns data unchanged when already at target version', () => {
        const registry = new SchemaRegistry();
        registry.register({ version: 2, decode: decodeObj, encode: encodeObj });

        const schema2 = registry.get(2)!;
        const raw = encodeVersioned({ value: 42 }, schema2 as Parameters<typeof encodeVersioned>[1]);

        const result = runSchemaMigration<{ value: number }>(raw, registry, [], 2);
        expect(result).toEqual({ value: 42 });
    });

    it('throws when no migration path exists', () => {
        const registry = new SchemaRegistry();
        registry.register({ version: 1, decode: decodeObj, encode: encodeObj });
        registry.register({ version: 3, decode: decodeObj, encode: encodeObj });

        const schema1 = registry.get(1)!;
        const raw = encodeVersioned({ x: 1 }, schema1 as Parameters<typeof encodeVersioned>[1]);

        expect(() => runSchemaMigration(raw, registry, [], 3)).toThrow(/No migration step/);
    });
});
