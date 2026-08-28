/**
 * Soroban Contract Execution Budget Monitoring (Issue #089 / #788)
 *
 * Tracks CPU instruction count and memory bytes from contract simulation
 * responses and fires configurable alert handlers when usage approaches
 * Soroban protocol hard limits.
 *
 * ## Metrics exposed
 * - cpuInsns: CPU instructions consumed by the invocation
 * - memoryBytes: Memory consumed in bytes
 * - cpuLimitFraction: fraction of the 100 M instruction ceiling
 * - memoryLimitFraction: fraction of the 40 MB memory ceiling
 *
 * ## Real-time emission (#788)
 * After every contract invocation, metrics are emitted to the analytics
 * service within the same async tick (no additional scheduling delay).
 * A `budget_warning` event is emitted when either resource exceeds the
 * configured threshold.
 *
 * ## Alert flow
 * Register a handler with `onBudgetAlert`. It fires whenever either
 * resource meets or exceeds the configured threshold (default 80 %).
 *
 * @see https://developers.stellar.org/docs/smart-contracts/resource-limits-fees
 */

import type { SorobanRpc } from 'stellar-sdk';
import { xdr } from 'stellar-sdk';
import { simulateContractCall } from './soroban';

// ── Soroban Protocol 21 hard limits ──────────────────────────────────────────

/** Maximum CPU instructions per Soroban transaction. */
export const SOROBAN_CPU_INSN_LIMIT = 100_000_000;

/** Maximum memory in bytes per Soroban transaction (40 MB). */
export const SOROBAN_MEMORY_LIMIT_BYTES = 41_943_040;

/** Default fraction (0–1) of a hard limit that triggers an alert. */
export const DEFAULT_ALERT_THRESHOLD = 0.8;

// ── Public types ──────────────────────────────────────────────────────────────

export interface BudgetThresholds {
    /** Fraction 0–1 of the CPU limit at which to alert. Default: 0.8 */
    cpuFraction?: number;
    /** Fraction 0–1 of the memory limit at which to alert. Default: 0.8 */
    memoryFraction?: number;
}

export interface BudgetUsage {
    cpuInsns: bigint;
    memoryBytes: bigint;
    /** cpuInsns / SOROBAN_CPU_INSN_LIMIT */
    cpuLimitFraction: number;
    /** memoryBytes / SOROBAN_MEMORY_LIMIT_BYTES */
    memoryLimitFraction: number;
    /** true when cpuLimitFraction >= configured threshold */
    cpuAlert: boolean;
    /** true when memoryLimitFraction >= configured threshold */
    memoryAlert: boolean;
}

export interface BudgetMetric {
    contractId: string;
    method: string;
    usage: BudgetUsage;
    /** Unix timestamp (ms) when this metric was recorded. */
    timestamp: number;
}

/** Called when one or both budget thresholds are breached. */
export type BudgetAlertHandler = (metric: BudgetMetric) => void;

// ── Analytics emission (#788) ─────────────────────────────────────────────────

/**
 * Analytics sink type. Receives every per-invocation metric plus an optional
 * `budget_warning` event payload when a threshold is breached.
 */
export interface AnalyticsSink {
  emit(eventName: string, payload: Record<string, unknown>): void;
}

let _analyticsSinks: AnalyticsSink[] = [];

/**
 * Register an analytics sink to receive real-time budget metrics.
 * Returns an unsubscribe function.
 *
 * @example
 * ```typescript
 * const off = addAnalyticsSink({
 *   emit(event, payload) { analytics.track(event, payload); }
 * });
 * off(); // deregister
 * ```
 */
export function addAnalyticsSink(sink: AnalyticsSink): () => void {
  _analyticsSinks.push(sink);
  return () => {
    const idx = _analyticsSinks.indexOf(sink);
    if (idx !== -1) _analyticsSinks.splice(idx, 1);
  };
}

/**
 * Register an analytics sink to receive real-time budget metrics.
 * Pass `null` to clear all sinks. Pass a sink to clear all existing sinks and
 * register only this one (backward compatibility).
 *
 * @deprecated Use {@link addAnalyticsSink} instead for multi-sink support.
 * @example
 * ```typescript
 * setAnalyticsSink({
 *   emit(event, payload) { analytics.track(event, payload); }
 * });
 * ```
 */
export function setAnalyticsSink(sink: AnalyticsSink | null): void {
  _analyticsSinks = [];
  if (sink) {
    _analyticsSinks.push(sink);
  }
}

/**
 * Emits a `budget_metric` event (and `budget_warning` when thresholds are
 * exceeded) to all registered analytics sinks.
 * Called synchronously after each contract invocation.
 */
export function emitBudgetMetrics(metric: BudgetMetric): void {
  if (_analyticsSinks.length === 0) return;

  const payload = {
    contractId: metric.contractId,
    functionName: metric.method,
    cpuInstructions: metric.usage.cpuInsns.toString(),
    memBytes: metric.usage.memoryBytes.toString(),
    cpuLimitFraction: metric.usage.cpuLimitFraction,
    memoryLimitFraction: metric.usage.memoryLimitFraction,
    timestamp: metric.timestamp,
  };

  for (const sink of _analyticsSinks) {
    sink.emit('budget_metric', payload);
    if (metric.usage.cpuAlert || metric.usage.memoryAlert) {
      sink.emit('budget_warning', {
        ...payload,
        cpuAlert: metric.usage.cpuAlert,
        memoryAlert: metric.usage.memoryAlert,
      });
    }
  }
}

// ── Module-level state (ring-buffer + handlers) ───────────────────────────────

const MAX_STORED_METRICS = 1_000;

// Circular buffer implementation: O(1) push instead of O(n) with shift()
const metricsBuffer = new Array<BudgetMetric>(MAX_STORED_METRICS);
let metricsWriteIndex = 0;
let metricsCount = 0;

const alertHandlers: BudgetAlertHandler[] = [];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a handler invoked whenever a CPU or memory threshold is breached.
 * Returns an unsubscribe function.
 *
 * @example
 * ```typescript
 * const off = onBudgetAlert((m) => {
 *   if (m.usage.cpuAlert) logger.warn('CPU budget alert', m);
 * });
 * off(); // deregister
 * ```
 */
export function onBudgetAlert(handler: BudgetAlertHandler): () => void {
    alertHandlers.push(handler);
    return () => {
        const idx = alertHandlers.indexOf(handler);
        if (idx !== -1) alertHandlers.splice(idx, 1);
    };
}

/**
 * Flush all recorded budget metrics.
 * Call in test teardown to ensure isolation between test cases.
 */
export function clearBudgetMetrics(): void {
    metricsWriteIndex = 0;
    metricsCount = 0;
}

/**
 * Return a read-only snapshot of all recorded budget metrics (newest last).
 * Reconstructs the circular buffer in insertion order.
 */
export function getBudgetMetrics(): readonly BudgetMetric[] {
    if (metricsCount === 0) return [];

    const result: BudgetMetric[] = [];

    if (metricsCount < MAX_STORED_METRICS) {
        // Buffer not yet full: read from index 0 to writeIndex
        for (let i = 0; i < metricsCount; i++) {
            result.push(metricsBuffer[i]!);
        }
    } else {
        // Buffer is full: read from writeIndex (oldest) to writeIndex-1 (newest)
        for (let i = 0; i < MAX_STORED_METRICS; i++) {
            const index = (metricsWriteIndex + i) % MAX_STORED_METRICS;
            result.push(metricsBuffer[index]!);
        }
    }

    return result;
}

/**
 * Simulate a contract invocation, record its execution budget, and fire
 * alert handlers if CPU or memory usage meets or exceeds the configured
 * thresholds.
 *
 * When a fresh, already-computed `SimulateTransactionResponse` is available
 * (e.g. from a recent `simulateContractCall` call within the same request
 * lifecycle), pass it as `precomputedSimulation` to avoid a duplicate RPC
 * round-trip.  When `precomputedSimulation` is **not** supplied the function
 * falls back to forcing a fresh simulation (bypasses the cache) so that
 * budget tracking always records accurate per-invocation numbers.
 *
 * @param contractId - The contract address (C...)
 * @param method - Contract method name
 * @param args - XDR-encoded method arguments
 * @param sourcePublicKey - Source account public key
 * @param thresholds - Optional alert thresholds (default: 80 % of hard limit)
 * @param _simulate - Override `simulateContractCall` for unit testing
 * @param precomputedSimulation - Optional already-fresh simulation result to
 *   reuse instead of issuing a new RPC call.  Callers are responsible for
 *   ensuring the response is fresh enough for their use-case.
 * @returns `BudgetUsage` when cost data is present in the simulation, `null`
 *   when the simulation response does not include cost information
 *
 * @example
 * ```typescript
 * // Without a pre-computed result (one RPC call):
 * const usage = await trackContractBudget(contractId, 'transfer', args, pubKey);
 *
 * // With a pre-computed result (zero additional RPC calls):
 * const sim = await simulateContractCall(contractId, 'transfer', args, pubKey);
 * const usage = await trackContractBudget(contractId, 'transfer', args, pubKey, {}, simulateContractCall, sim);
 *
 * if (usage?.cpuAlert) {
 *   console.warn(`CPU at ${(usage.cpuLimitFraction * 100).toFixed(1)}% of limit`);
 * }
 * ```
 */
export async function trackContractBudget(
    contractId: string,
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string,
    thresholds: BudgetThresholds = {},
    _simulate: typeof simulateContractCall = simulateContractCall,
    precomputedSimulation?: SorobanRpc.Api.SimulateTransactionResponse,
): Promise<BudgetUsage | null> {
    const resolved = resolveThresholds(thresholds);
    const simulation = precomputedSimulation
        ? precomputedSimulation
        : await _simulate(contractId, method, args, sourcePublicKey, { skipCache: true });
    const usage = extractBudgetUsage(simulation, resolved);
    if (!usage) return null;

    pushMetric({ contractId, method, usage, timestamp: Date.now() });
    return usage;
}

/**
 * Extract execution budget from an existing simulation response without
 * triggering an additional RPC call.
 *
 * @returns `BudgetUsage` when cost data is present, `null` otherwise
 */
export function extractBudgetFromSimulation(
    simulation: SorobanRpc.Api.SimulateTransactionResponse,
    thresholds: BudgetThresholds = {},
): BudgetUsage | null {
    return extractBudgetUsage(simulation, resolveThresholds(thresholds));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveThresholds(t: BudgetThresholds): Required<BudgetThresholds> {
    return {
        cpuFraction: t.cpuFraction ?? DEFAULT_ALERT_THRESHOLD,
        memoryFraction: t.memoryFraction ?? DEFAULT_ALERT_THRESHOLD,
    };
}

function extractBudgetUsage(
    simulation: SorobanRpc.Api.SimulateTransactionResponse,
    thresholds: Required<BudgetThresholds>,
): BudgetUsage | null {
    if (!('cost' in simulation) || !simulation.cost) return null;

    const cpuInsns = BigInt(simulation.cost.cpuInsns ?? '0');
    const memoryBytes = BigInt(simulation.cost.memBytes ?? '0');
    const cpuLimitFraction = Number(cpuInsns) / SOROBAN_CPU_INSN_LIMIT;
    const memoryLimitFraction = Number(memoryBytes) / SOROBAN_MEMORY_LIMIT_BYTES;

    return {
        cpuInsns,
        memoryBytes,
        cpuLimitFraction,
        memoryLimitFraction,
        cpuAlert: cpuLimitFraction >= thresholds.cpuFraction,
        memoryAlert: memoryLimitFraction >= thresholds.memoryFraction,
    };
}

function pushMetric(metric: BudgetMetric): void {
    // Circular buffer: write to current index and advance
    metricsBuffer[metricsWriteIndex] = metric;
    metricsWriteIndex = (metricsWriteIndex + 1) % MAX_STORED_METRICS;

    // Track actual count (up to MAX_STORED_METRICS)
    if (metricsCount < MAX_STORED_METRICS) {
        metricsCount++;
    }

    // Emit to analytics sink immediately (#788)
    emitBudgetMetrics(metric);

    if (metric.usage.cpuAlert || metric.usage.memoryAlert) {
        for (const handler of alertHandlers) {
            handler(metric);
        }
    }
}
