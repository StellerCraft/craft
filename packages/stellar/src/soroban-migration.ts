/**
 * Soroban Contract Cross-Network Migration (#617 / #786)
 *
 * Safely promotes Soroban contracts from testnet to mainnet by validating
 * network-specific configuration and requiring explicit confirmation.
 *
 * Also provides schema versioning for contract storage (#786):
 * - Each persisted value is tagged with a `schemaVersion` prefix.
 * - A `SchemaRegistry` maps version numbers to decoders.
 * - A migration runner applies version transformations in sequence.
 * - Downgrades are blocked when the old schema cannot decode new-format data.
 *
 * ## Safety guarantees
 * - Testnet-only parameters are rejected before any mainnet operation.
 * - Mainnet promotion requires `confirm: true` from the caller.
 * - The network passphrase is validated against the target network.
 */

import { Networks } from 'stellar-sdk';
import { NETWORK_PASSPHRASES, HORIZON_URLS, SOROBAN_RPC_URLS } from './config';
import type { StellarNetworkConfig } from '@craft/types';

// ── Schema versioning (#786) ──────────────────────────────────────────────────

/**
 * A versioned envelope wraps every persisted storage value so that
 * migration functions can decode old-format data unambiguously.
 */
export interface VersionedValue<T = unknown> {
  schemaVersion: number;
  data: T;
}

/** Decode raw bytes for a given schema version. */
export type SchemaDecoder<T = unknown> = (raw: Uint8Array) => T;

/** Encode a value for a given schema version. */
export type SchemaEncoder<T = unknown> = (value: T) => Uint8Array;

export interface SchemaDefinition<T = unknown> {
  version: number;
  decode: SchemaDecoder<T>;
  encode: SchemaEncoder<T>;
}

/**
 * Registry mapping schema version numbers to their codec.
 *
 * @example
 * ```typescript
 * const registry = new SchemaRegistry();
 * registry.register({ version: 1, decode: decodeV1, encode: encodeV1 });
 * registry.register({ version: 2, decode: decodeV2, encode: encodeV2 });
 * ```
 */
export class SchemaRegistry {
  private readonly schemas = new Map<number, SchemaDefinition>();

  register<T>(schema: SchemaDefinition<T>): void {
    this.schemas.set(schema.version, schema as SchemaDefinition);
  }

  get(version: number): SchemaDefinition | undefined {
    return this.schemas.get(version);
  }

  has(version: number): boolean {
    return this.schemas.has(version);
  }

  /** Returns all registered versions in ascending order. */
  versions(): number[] {
    return Array.from(this.schemas.keys()).sort((a, b) => a - b);
  }

  /**
   * Returns the highest registered schema version, or undefined if no versions are registered.
   */
  latestVersion(): number | undefined {
    const versions = this.versions();
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
  }
}

/**
 * Serialize a value as a versioned envelope.
 * The first 4 bytes are a little-endian u32 schemaVersion, followed by the
 * encoded payload.
 */
export function encodeVersioned<T>(
  value: T,
  schema: SchemaDefinition<T>,
): Uint8Array {
  const payload = schema.encode(value);
  const out = new Uint8Array(4 + payload.byteLength);
  new DataView(out.buffer).setUint32(0, schema.version, true /* LE */);
  out.set(payload, 4);
  return out;
}

/**
 * Deserialize a versioned envelope.
 * Reads the 4-byte version prefix and delegates decoding to the matching
 * schema in the registry.
 *
 * @throws {Error} When the stored schema version is not in the registry
 *   (this blocks implicit downgrades).
 */
export function decodeVersioned<T>(
  raw: Uint8Array,
  registry: SchemaRegistry,
): VersionedValue<T> {
  if (raw.byteLength < 4) {
    throw new Error('Invalid versioned value: too short to contain a version prefix');
  }
  const version = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
  const schema = registry.get(version);
  if (!schema) {
    throw new Error(
      `Schema version ${version} is not registered – downgrade blocked. ` +
      `Registered versions: [${registry.versions().join(', ')}]`,
    );
  }
  return { schemaVersion: version, data: schema.decode(raw.slice(4)) as T };
}

export type VersionMigrator<From = unknown, To = unknown> = (
  oldVersion: number,
  data: From,
) => To;

export interface MigrationStep {
  fromVersion: number;
  toVersion: number;
  migrate: VersionMigrator;
}

/**
 * Resolves a migration path from one version to another without executing any migrations.
 * Returns the ordered sequence of migration steps needed, or null if no path exists.
 */
export function resolveMigrationPath(
  steps: MigrationStep[],
  fromVersion: number,
  toVersion: number,
): MigrationStep[] | null {
  if (fromVersion === toVersion) {
    return [];
  }

  const stepMap = new Map<number, MigrationStep>(steps.map((s) => [s.fromVersion, s]));
  const path: MigrationStep[] = [];
  let currentVersion = fromVersion;

  while (currentVersion !== toVersion) {
    const step = stepMap.get(currentVersion);
    if (!step) {
      return null;
    }
    path.push(step);
    currentVersion = step.toVersion;
  }

  return path;
}

/**
 * Runs a chain of version migrations in sequence to bring raw bytes from
 * their current schema version up to the target version.
 *
 * @throws {Error} When no migration path exists between the stored and target versions.
 */
export function runSchemaMigration<T>(
  raw: Uint8Array,
  registry: SchemaRegistry,
  steps: MigrationStep[],
  targetVersion: number,
): T {
  const { schemaVersion: currentVersion, data: currentData } = decodeVersioned(raw, registry);

  if (currentVersion === targetVersion) {
    return currentData as T;
  }

  const path = resolveMigrationPath(steps, currentVersion, targetVersion);
  if (!path) {
    throw new Error(
      `No migration step from version ${currentVersion} to ${targetVersion}. ` +
      `Available steps: [${steps.map((s) => `${s.fromVersion}→${s.toVersion}`).join(', ')}]`,
    );
  }

  let version = currentVersion;
  let data: unknown = currentData;

  for (const step of path) {
    data = step.migrate(version, data);
    version = step.toVersion;
  }

  return data as T;
}

/**
 * Migrates raw bytes to the latest registered schema version.
 */
export function migrateToLatest<T>(
  raw: Uint8Array,
  registry: SchemaRegistry,
  steps: MigrationStep[],
): T {
  const latestVersion = registry.latestVersion();
  if (latestVersion === undefined) {
    throw new Error('No schema versions registered in the registry');
  }
  return runSchemaMigration(raw, registry, steps, latestVersion);
}

// ── Cross-network migration (original #617 content below) ────────────────────

export type MigrationNetwork = 'mainnet' | 'testnet';

export interface MigrationConfig {
    /** WASM binary of the contract to deploy. */
    wasmBinary: Buffer | Uint8Array;
    /** Source account public key that will pay for deployment. */
    sourcePublicKey: string;
    /** Target network configuration. */
    config: StellarNetworkConfig;
    /**
     * Must be `true` to proceed with mainnet promotion.
     * Omitting or setting to `false` returns an error without touching the network.
     */
    confirm?: boolean;
}

export type MigrationResult =
    | { ok: true; network: MigrationNetwork; message: string }
    | { ok: false; error: string };

/** Testnet-only values that must not appear in a mainnet config. */
const TESTNET_ONLY_VALUES: ReadonlySet<string> = new Set([
    NETWORK_PASSPHRASES.testnet,
    HORIZON_URLS.testnet,
    SOROBAN_RPC_URLS.testnet,
    'testnet',
]);

/** Normalize a URL by lowercasing and removing trailing slashes. */
function normalizeUrl(url: string): string {
    return url.toLowerCase().replace(/\/+$/, '');
}

/** Normalize testnet URLs for comparison. */
const TESTNET_URLS_NORMALIZED = new Set([
    normalizeUrl(HORIZON_URLS.testnet),
    normalizeUrl(SOROBAN_RPC_URLS.testnet),
]);

/**
 * Validates that the provided config contains no testnet-only parameters
 * when the target network is mainnet.
 *
 * Detects testnet parameters regardless of trailing slashes, scheme case,
 * or hostname case by normalizing before comparison.
 *
 * @returns An error message if a testnet parameter is detected, otherwise null.
 */
export function detectTestnetParameters(cfg: StellarNetworkConfig): string | null {
    const checks: Array<[string, string]> = [
        ['networkPassphrase', cfg.networkPassphrase],
        ['horizonUrl', cfg.horizonUrl],
        ['sorobanRpcUrl', cfg.sorobanRpcUrl ?? ''],
        ['network', cfg.network],
    ];

    for (const [field, value] of checks) {
        if (TESTNET_ONLY_VALUES.has(value)) {
            return `Testnet-only parameter detected in field "${field}": "${value}". ` +
                'Mainnet deployments must use mainnet-appropriate configuration.';
        }

        if ((field === 'horizonUrl' || field === 'sorobanRpcUrl') && value) {
            const normalizedValue = normalizeUrl(value);
            if (TESTNET_URLS_NORMALIZED.has(normalizedValue) || normalizedValue.includes('testnet')) {
                return `Testnet-only parameter detected in field "${field}": "${value}". ` +
                    'Mainnet deployments must use mainnet-appropriate configuration.';
            }
        }
    }

    return null;
}

/**
 * Promotes a Soroban contract from testnet to mainnet.
 *
 * Steps:
 * 1. Require explicit confirmation (`confirm: true`).
 * 2. Reject any testnet-only parameters in the provided config.
 * 3. Validate the network passphrase matches mainnet.
 * 4. Return success — actual deployment is handled by the caller using
 *    the validated config (keeps this function pure and testable).
 *
 * @param options - Migration configuration including WASM, source key, and target config.
 */
export function migrateSorobanContract(options: MigrationConfig): MigrationResult {
    const { config, confirm } = options;
    const targetNetwork = config.network as MigrationNetwork;

    // Step 1: Require explicit confirmation for mainnet.
    if (targetNetwork === 'mainnet' && !confirm) {
        return {
            ok: false,
            error: 'Mainnet promotion requires explicit confirmation. Pass { confirm: true } to proceed.',
        };
    }

    // Step 2: Reject testnet-only parameters on mainnet.
    if (targetNetwork === 'mainnet') {
        const paramError = detectTestnetParameters(config);
        if (paramError) {
            return { ok: false, error: paramError };
        }
    }

    // Step 3: Validate network passphrase matches the target network.
    const expectedPassphrase = NETWORK_PASSPHRASES[targetNetwork];
    if (config.networkPassphrase !== expectedPassphrase) {
        return {
            ok: false,
            error: `Network passphrase mismatch: expected "${expectedPassphrase}" for ${targetNetwork}, ` +
                `got "${config.networkPassphrase}".`,
        };
    }

    return {
        ok: true,
        network: targetNetwork,
        message: `Configuration validated for ${targetNetwork} deployment. Proceed with contract upload.`,
    };
}
