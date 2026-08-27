/**
 * Soroban Contract Upgrade Orchestration (#770)
 *
 * Validates ABI schema compatibility between old and new contract versions
 * before submitting an upgrade transaction. Supports dry-run mode to simulate
 * the upgrade without broadcasting, and emits a detailed schema diff report.
 */

import { SorobanRpc, TransactionBuilder, Networks, BASE_FEE, xdr } from 'stellar-sdk';
import { createSorobanClient } from './soroban';

// ---------------------------------------------------------------------------
// ABI Schema types
// ---------------------------------------------------------------------------

export type StorageKeyType = 'instance' | 'persistent' | 'temporary';

export interface AbiStorageEntry {
  key: string;
  type: StorageKeyType;
  /** Whether this key is required (non-optional) in the contract storage. */
  required: boolean;
}

/** Function signature information for breaking-change detection. */
export interface AbiFunctionSignature {
  /** Function name as exported by the contract. */
  name: string;
  /** Ordered list of parameter types (as TypeScript type strings). */
  paramTypes: string[];
  /** Return type (as a TypeScript type string). */
  returnType: string;
}

/** Minimal contract ABI schema covering storage keys and function signatures. */
export interface ContractAbiSchema {
  /** Contract version string (semver or arbitrary label). */
  version: string;
  /** All storage keys declared by the contract. */
  storageKeys: AbiStorageEntry[];
  /** Optional: exported functions for signature compatibility checking. */
  functions?: AbiFunctionSignature[];
}

// ---------------------------------------------------------------------------
// Diff / report types
// ---------------------------------------------------------------------------

export interface SchemaChange {
  type: 'added' | 'removed' | 'type_changed' | 'function_removed' | 'function_signature_changed';
  key: string;
  /** Present for storage key changes. */
  oldEntry?: AbiStorageEntry;
  /** Present for storage key changes. */
  newEntry?: AbiStorageEntry;
  /** Present for function signature changes. */
  oldFunction?: AbiFunctionSignature;
  /** Present for function signature changes. */
  newFunction?: AbiFunctionSignature;
}

export interface SchemaDiffReport {
  /** True when no breaking changes are detected. */
  safe: boolean;
  /** Human-readable summary of the diff. */
  summary: string;
  changes: SchemaChange[];
  /** Breaking changes only (removed required keys, changed storage type). */
  breakingChanges: SchemaChange[];
}

// ---------------------------------------------------------------------------
// Orchestrator input / output types
// ---------------------------------------------------------------------------

export interface UpgradeOrchestratorOptions {
  /** Current (deployed) contract ABI schema. */
  currentSchema: ContractAbiSchema;
  /** New contract ABI schema to upgrade to. */
  newSchema: ContractAbiSchema;
  /**
   * When true, simulate the upgrade via `simulateTransaction` but do NOT
   * broadcast the transaction to the network.
   */
  dryRun?: boolean;
  /**
   * Serialised upgrade transaction XDR (base64). Required when `dryRun` is
   * true so the orchestrator can call `simulateTransaction`.
   */
  upgradeTransactionXdr?: string;
  /** Source account public key — used to build the simulation envelope. */
  sourcePublicKey?: string;
  /** Network passphrase — defaults to TESTNET when omitted. */
  networkPassphrase?: string;
}

export type UpgradeOrchestratorResult =
  | { ok: true; dryRun: boolean; diffReport: SchemaDiffReport; simulationResult?: SorobanRpc.Api.SimulateTransactionResponse }
  | { ok: false; error: string; diffReport?: SchemaDiffReport };

// ---------------------------------------------------------------------------
// Core: ABI schema diff
// ---------------------------------------------------------------------------

/**
 * Compares two ABI schemas and returns a detailed diff report.
 *
 * Breaking changes include:
 * - Storage: A required key that exists in `current` is absent in `next`.
 * - Storage: A storage key's `type` field changes (different durability semantics).
 * - Functions: A function that exists in `current` is absent in `next`.
 * - Functions: A function's parameter types or return type change.
 *
 * Note: schemas without `functions` supplied behave exactly as before,
 * fully backward compatible with storage-key-only diffing.
 */
export function diffAbiSchemas(
  current: ContractAbiSchema,
  next: ContractAbiSchema,
): SchemaDiffReport {
  const currentStorageMap = new Map(current.storageKeys.map((e) => [e.key, e]));
  const nextStorageMap = new Map(next.storageKeys.map((e) => [e.key, e]));

  const changes: SchemaChange[] = [];

  // ── Storage key changes ───────────────────────────────────────────────────────

  // Detect removed / type-changed storage keys
  for (const [key, oldEntry] of currentStorageMap) {
    const newEntry = nextStorageMap.get(key);
    if (!newEntry) {
      changes.push({ type: 'removed', key, oldEntry });
    } else if (oldEntry.type !== newEntry.type) {
      changes.push({ type: 'type_changed', key, oldEntry, newEntry });
    }
  }

  // Detect added storage keys
  for (const [key, newEntry] of nextStorageMap) {
    if (!currentStorageMap.has(key)) {
      changes.push({ type: 'added', key, newEntry });
    }
  }

  // ── Function signature changes ────────────────────────────────────────────────

  if (current.functions && next.functions) {
    const currentFuncMap = new Map(current.functions.map((f) => [f.name, f]));
    const nextFuncMap = new Map(next.functions.map((f) => [f.name, f]));

    // Detect removed functions
    for (const [name, oldFunc] of currentFuncMap) {
      const newFunc = nextFuncMap.get(name);
      if (!newFunc) {
        changes.push({
          type: 'function_removed',
          key: name,
          oldFunction: oldFunc,
        });
      } else {
        // Check for signature changes (param types or return type)
        const paramsChanged = oldFunc.paramTypes.length !== newFunc.paramTypes.length ||
          oldFunc.paramTypes.some((t, i) => t !== newFunc.paramTypes[i]);
        const returnTypeChanged = oldFunc.returnType !== newFunc.returnType;

        if (paramsChanged || returnTypeChanged) {
          changes.push({
            type: 'function_signature_changed',
            key: name,
            oldFunction: oldFunc,
            newFunction: newFunc,
          });
        }
      }
    }

    // Note: added functions are not breaking, so we don't need to track them
  }

  // ── Identify breaking changes ─────────────────────────────────────────────────

  const breakingChanges = changes.filter((c) => {
    if (c.type === 'removed' && c.oldEntry?.required) return true;
    // A newly-added key that is required is a breaking change: existing on-chain
    // contract instances will not have this key populated, so code that relies on
    // its presence (per required: true) can fail post-upgrade.
    if (c.type === 'added' && c.newEntry?.required) return true;
    if (c.type === 'type_changed') return true;
    if (c.type === 'function_removed') return true;
    if (c.type === 'function_signature_changed') return true;
    return false;
  });

  const safe = breakingChanges.length === 0;

  // ── Build summary ─────────────────────────────────────────────────────────────

  const storageChanges = changes.filter((c) => 'oldEntry' in c || 'newEntry' in c);
  const funcChanges = changes.filter((c) => 'oldFunction' in c || 'newFunction' in c);

  const summaryLines: string[] = [
    `Schema diff: ${current.version} → ${next.version}`,
    `  Storage keys:`,
    `    Added   : ${storageChanges.filter((c) => c.type === 'added').length} key(s)`,
    `    Removed : ${storageChanges.filter((c) => c.type === 'removed').length} key(s)`,
    `    Changed : ${storageChanges.filter((c) => c.type === 'type_changed').length} key(s)`,
  ];

  if (current.functions || next.functions) {
    summaryLines.push(`  Function signatures:`);
    summaryLines.push(`    Removed : ${funcChanges.filter((c) => c.type === 'function_removed').length} function(s)`);
    summaryLines.push(`    Changed : ${funcChanges.filter((c) => c.type === 'function_signature_changed').length} signature(s)`);
  }

  summaryLines.push(`  Breaking: ${breakingChanges.length} change(s)`);
  summaryLines.push(safe ? '  Result  : SAFE to upgrade' : '  Result  : UNSAFE — breaking changes detected');

  if (breakingChanges.length > 0) {
    summaryLines.push('  Breaking change details:');
    for (const bc of breakingChanges) {
      if (bc.type === 'removed') {
        summaryLines.push(`    - Key "${bc.key}" (${bc.oldEntry?.type}) was REMOVED`);
      } else if (bc.type === 'added') {
        summaryLines.push(
          `    - Key "${bc.key}" (${bc.newEntry?.type}) added as REQUIRED — existing on-chain instances lack this key`,
        );
      } else if (bc.type === 'type_changed') {
        summaryLines.push(
          `    - Key "${bc.key}" storage type changed: ${bc.oldEntry?.type} → ${bc.newEntry?.type}`,
        );
      } else if (bc.type === 'function_removed') {
        summaryLines.push(`    - Function "${bc.key}" was REMOVED`);
      } else if (bc.type === 'function_signature_changed') {
        const oldSig = bc.oldFunction ? `(${bc.oldFunction.paramTypes.join(', ')}) => ${bc.oldFunction.returnType}` : '?';
        const newSig = bc.newFunction ? `(${bc.newFunction.paramTypes.join(', ')}) => ${bc.newFunction.returnType}` : '?';
        summaryLines.push(`    - Function "${bc.key}" signature changed: ${oldSig} → ${newSig}`);
      }
    }
  }

  return { safe, summary: summaryLines.join('\n'), changes, breakingChanges };
}

// ---------------------------------------------------------------------------
// Core: orchestrate upgrade
// ---------------------------------------------------------------------------

/**
 * Orchestrates a Soroban contract upgrade with schema safety verification.
 *
 * Steps:
 * 1. Diff the old and new ABI schemas.
 * 2. Block if breaking changes are detected (unless all removed keys are optional).
 * 3. If `dryRun` is true, simulate the transaction via Soroban RPC and return
 *    the simulation result without broadcasting.
 * 4. Otherwise, confirm the upgrade is safe and return success.
 *
 * The caller is responsible for constructing and broadcasting the actual
 * upgrade transaction — this keeps the orchestrator pure and testable.
 */
export async function orchestrateContractUpgrade(
  options: UpgradeOrchestratorOptions,
): Promise<UpgradeOrchestratorResult> {
  const {
    currentSchema,
    newSchema,
    dryRun = false,
    upgradeTransactionXdr,
    networkPassphrase = Networks.TESTNET,
  } = options;

  // Step 1: Compare schemas
  const diffReport = diffAbiSchemas(currentSchema, newSchema);

  // Step 2: Block on breaking changes
  if (!diffReport.safe) {
    return {
      ok: false,
      error:
        `Upgrade blocked: breaking schema changes detected.\n${diffReport.summary}\n` +
        'Provide a migration path for removed/changed storage keys before upgrading.',
      diffReport,
    };
  }

  // Step 3: Dry-run simulation
  if (dryRun) {
    if (!upgradeTransactionXdr) {
      return {
        ok: false,
        error: 'dryRun requires upgradeTransactionXdr to simulate the transaction.',
        diffReport,
      };
    }

    let simulationResult: SorobanRpc.Api.SimulateTransactionResponse;
    try {
      const client = createSorobanClient();
      const tx = TransactionBuilder.fromXDR(upgradeTransactionXdr, networkPassphrase);
      simulationResult = await client.simulateTransaction(tx as Parameters<typeof client.simulateTransaction>[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Simulation failed: ${message}`, diffReport };
    }

    if (SorobanRpc.Api.isSimulationError(simulationResult)) {
      return {
        ok: false,
        error: `Simulation error: ${simulationResult.error}`,
        diffReport,
      };
    }

    return { ok: true, dryRun: true, diffReport, simulationResult };
  }

  // Step 4: Schema is safe, no dry-run — confirm readiness
  return { ok: true, dryRun: false, diffReport };
}
