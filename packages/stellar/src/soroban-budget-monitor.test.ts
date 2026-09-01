import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SorobanRpc } from 'stellar-sdk';
import {
    trackContractBudget,
    extractBudgetFromSimulation,
    onBudgetAlert,
    clearBudgetMetrics,
    getBudgetMetrics,
    setAnalyticsSink,
    addAnalyticsSink,
    emitBudgetMetrics,
    SOROBAN_CPU_INSN_LIMIT,
    SOROBAN_MEMORY_LIMIT_BYTES,
    DEFAULT_ALERT_THRESHOLD,
} from './soroban-budget-monitor';

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const SOURCE_KEY = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

function makeSimulation(cpuInsns: string, memBytes: string): SorobanRpc.Api.SimulateTransactionResponse {
    return {
        cost: { cpuInsns, memBytes },
        minResourceFee: '100',
    } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
}

beforeEach(() => {
    clearBudgetMetrics();
    setAnalyticsSink(null);
});

describe('trackContractBudget', () => {
    it('returns BudgetUsage with correct fractions', async () => {
        const cpuInsns = String(Math.floor(SOROBAN_CPU_INSN_LIMIT * 0.5));
        const memBytes = String(Math.floor(SOROBAN_MEMORY_LIMIT_BYTES * 0.25));
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation(cpuInsns, memBytes));

        const usage = await trackContractBudget(CONTRACT_ID, 'ping', [], SOURCE_KEY, {}, mockSimulate);

        expect(usage).not.toBeNull();
        expect(usage!.cpuInsns).toBe(BigInt(cpuInsns));
        expect(usage!.memoryBytes).toBe(BigInt(memBytes));
        expect(usage!.cpuLimitFraction).toBeCloseTo(0.5, 5);
        expect(usage!.memoryLimitFraction).toBeCloseTo(0.25, 5);
    });

    it('sets cpuAlert=false below threshold', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(
            makeSimulation(String(SOROBAN_CPU_INSN_LIMIT * 0.79), '0'),
        );

        const usage = await trackContractBudget(CONTRACT_ID, 'ping', [], SOURCE_KEY, {}, mockSimulate);

        expect(usage!.cpuAlert).toBe(false);
    });

    it('sets cpuAlert=true at exactly the threshold', async () => {
        const atThreshold = String(Math.floor(SOROBAN_CPU_INSN_LIMIT * DEFAULT_ALERT_THRESHOLD));
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation(atThreshold, '0'));

        const usage = await trackContractBudget(CONTRACT_ID, 'ping', [], SOURCE_KEY, {}, mockSimulate);

        expect(usage!.cpuAlert).toBe(true);
    });

    it('sets memoryAlert=true when memory exceeds threshold', async () => {
        const overThreshold = String(Math.floor(SOROBAN_MEMORY_LIMIT_BYTES * 0.9));
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('0', overThreshold));

        const usage = await trackContractBudget(CONTRACT_ID, 'ping', [], SOURCE_KEY, {}, mockSimulate);

        expect(usage!.memoryAlert).toBe(true);
    });

    it('respects custom thresholds', async () => {
        const half = String(SOROBAN_CPU_INSN_LIMIT * 0.6);
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation(half, '0'));

        const usage = await trackContractBudget(
            CONTRACT_ID, 'ping', [], SOURCE_KEY,
            { cpuFraction: 0.5 },
            mockSimulate,
        );

        expect(usage!.cpuAlert).toBe(true);
    });

    it('returns null when simulation has no cost field', async () => {
        const mockSimulate = vi.fn().mockResolvedValue({
            minResourceFee: '100',
        } as unknown as SorobanRpc.Api.SimulateTransactionResponse);

        const usage = await trackContractBudget(CONTRACT_ID, 'ping', [], SOURCE_KEY, {}, mockSimulate);

        expect(usage).toBeNull();
    });

    it('bypasses cache to get fresh simulation results', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('1000000', '512000'));

        await trackContractBudget(CONTRACT_ID, 'transfer', [], SOURCE_KEY, {}, mockSimulate);
        await trackContractBudget(CONTRACT_ID, 'transfer', [], SOURCE_KEY, {}, mockSimulate);

        // Both calls should invoke the simulate function, not use cache
        expect(mockSimulate).toHaveBeenCalledTimes(2);

        // Verify skipCache=true was passed both times
        expect(mockSimulate).toHaveBeenNthCalledWith(1, CONTRACT_ID, 'transfer', [], SOURCE_KEY, { skipCache: true });
        expect(mockSimulate).toHaveBeenNthCalledWith(2, CONTRACT_ID, 'transfer', [], SOURCE_KEY, { skipCache: true });
    });

    it('stores metric in the metrics store', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('1000000', '512000'));
        await trackContractBudget(CONTRACT_ID, 'transfer', [], SOURCE_KEY, {}, mockSimulate);

        const metrics = getBudgetMetrics();
        expect(metrics).toHaveLength(1);
        expect(metrics[0].contractId).toBe(CONTRACT_ID);
        expect(metrics[0].method).toBe('transfer');
    });
});

describe('alert handler', () => {
    it('fires handler when CPU threshold is exceeded', async () => {
        const handler = vi.fn();
        const off = onBudgetAlert(handler);

        const overThreshold = String(Math.floor(SOROBAN_CPU_INSN_LIMIT * 0.85));
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation(overThreshold, '0'));

        await trackContractBudget(CONTRACT_ID, 'heavyOp', [], SOURCE_KEY, {}, mockSimulate);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].usage.cpuAlert).toBe(true);
        off();
    });

    it('fires handler when memory threshold is exceeded', async () => {
        const handler = vi.fn();
        const off = onBudgetAlert(handler);

        const overMem = String(Math.floor(SOROBAN_MEMORY_LIMIT_BYTES * 0.9));
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('0', overMem));

        await trackContractBudget(CONTRACT_ID, 'bigAlloc', [], SOURCE_KEY, {}, mockSimulate);

        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].usage.memoryAlert).toBe(true);
        off();
    });

    it('does not fire handler when both resources are below threshold', async () => {
        const handler = vi.fn();
        const off = onBudgetAlert(handler);

        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('100', '1024'));
        await trackContractBudget(CONTRACT_ID, 'cheapOp', [], SOURCE_KEY, {}, mockSimulate);

        expect(handler).not.toHaveBeenCalled();
        off();
    });

    it('unsubscribe stops the handler from being called', async () => {
        const handler = vi.fn();
        const off = onBudgetAlert(handler);
        off();

        const over = String(SOROBAN_CPU_INSN_LIMIT);
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation(over, '0'));
        await trackContractBudget(CONTRACT_ID, 'op', [], SOURCE_KEY, {}, mockSimulate);

        expect(handler).not.toHaveBeenCalled();
    });
});

describe('extractBudgetFromSimulation', () => {
    it('computes usage without an RPC call', () => {
        const sim = makeSimulation('50000000', '20000000');
        const usage = extractBudgetFromSimulation(sim);

        expect(usage).not.toBeNull();
        expect(usage!.cpuInsns).toBe(50_000_000n);
        expect(usage!.memoryBytes).toBe(20_000_000n);
        expect(usage!.cpuAlert).toBe(false);
        expect(usage!.memoryAlert).toBe(false);
    });

    it('returns null for simulation without cost', () => {
        const usage = extractBudgetFromSimulation(
            { error: 'failed' } as unknown as SorobanRpc.Api.SimulateTransactionResponse,
        );
        expect(usage).toBeNull();
    });
});

describe('getBudgetMetrics + clearBudgetMetrics', () => {
    it('accumulates metrics across multiple calls', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('1000', '512'));

        await trackContractBudget(CONTRACT_ID, 'a', [], SOURCE_KEY, {}, mockSimulate);
        await trackContractBudget(CONTRACT_ID, 'b', [], SOURCE_KEY, {}, mockSimulate);

        expect(getBudgetMetrics()).toHaveLength(2);
    });

    it('clearBudgetMetrics empties the store', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('1000', '512'));
        await trackContractBudget(CONTRACT_ID, 'x', [], SOURCE_KEY, {}, mockSimulate);

        clearBudgetMetrics();

        expect(getBudgetMetrics()).toHaveLength(0);
    });
});

// ── Analytics emission (#788) ─────────────────────────────────────────────────

describe('emitBudgetMetrics – analytics sink', () => {
    it('emits budget_metric event for every invocation', async () => {
        const sink = { emit: vi.fn() };
        setAnalyticsSink(sink);

        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('500000', '256000'));
        await trackContractBudget(CONTRACT_ID, 'transfer', [], SOURCE_KEY, {}, mockSimulate);

        expect(sink.emit).toHaveBeenCalledWith('budget_metric', expect.objectContaining({
            contractId: CONTRACT_ID,
            functionName: 'transfer',
        }));
    });

    it('emits budget_warning event when CPU threshold exceeded', async () => {
        const sink = { emit: vi.fn() };
        setAnalyticsSink(sink);

        const over = String(Math.floor(SOROBAN_CPU_INSN_LIMIT * 0.9));
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation(over, '0'));
        await trackContractBudget(CONTRACT_ID, 'heavyOp', [], SOURCE_KEY, {}, mockSimulate);

        const warningCall = sink.emit.mock.calls.find(([event]) => event === 'budget_warning');
        expect(warningCall).toBeDefined();
        expect(warningCall![1]).toMatchObject({ cpuAlert: true });
    });

    it('does not emit budget_warning when below threshold', async () => {
        const sink = { emit: vi.fn() };
        setAnalyticsSink(sink);

        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('100', '512'));
        await trackContractBudget(CONTRACT_ID, 'cheapOp', [], SOURCE_KEY, {}, mockSimulate);

        const warningCall = sink.emit.mock.calls.find(([event]) => event === 'budget_warning');
        expect(warningCall).toBeUndefined();
    });

    it('does not throw when no analytics sink is registered', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('1000', '512'));
        await expect(
            trackContractBudget(CONTRACT_ID, 'op', [], SOURCE_KEY, {}, mockSimulate)
        ).resolves.not.toThrow();
    });

    it('emitBudgetMetrics sends cpuInstructions and memBytes fields', () => {
        const sink = { emit: vi.fn() };
        setAnalyticsSink(sink);

        emitBudgetMetrics({
            contractId: CONTRACT_ID,
            method: 'ping',
            timestamp: 1000,
            usage: {
                cpuInsns: 5_000_000n,
                memoryBytes: 1_000_000n,
                cpuLimitFraction: 0.05,
                memoryLimitFraction: 0.02,
                cpuAlert: false,
                memoryAlert: false,
            },
        });

        expect(sink.emit).toHaveBeenCalledWith('budget_metric', expect.objectContaining({
            cpuInstructions: '5000000',
            memBytes: '1000000',
        }));
    });

    it('addAnalyticsSink supports multiple concurrent sinks', () => {
        const sink1 = { emit: vi.fn() };
        const sink2 = { emit: vi.fn() };

        const off1 = addAnalyticsSink(sink1);
        const off2 = addAnalyticsSink(sink2);

        emitBudgetMetrics({
            contractId: CONTRACT_ID,
            method: 'ping',
            timestamp: 1000,
            usage: {
                cpuInsns: 5_000_000n,
                memoryBytes: 1_000_000n,
                cpuLimitFraction: 0.05,
                memoryLimitFraction: 0.02,
                cpuAlert: false,
                memoryAlert: false,
            },
        });

        expect(sink1.emit).toHaveBeenCalledWith('budget_metric', expect.any(Object));
        expect(sink2.emit).toHaveBeenCalledWith('budget_metric', expect.any(Object));

        off1();
        off2();
    });

    it('addAnalyticsSink returns unsubscribe function', () => {
        const sink = { emit: vi.fn() };
        const off = addAnalyticsSink(sink);

        emitBudgetMetrics({
            contractId: CONTRACT_ID,
            method: 'a',
            timestamp: 1000,
            usage: {
                cpuInsns: 1_000_000n,
                memoryBytes: 512_000n,
                cpuLimitFraction: 0.01,
                memoryLimitFraction: 0.01,
                cpuAlert: false,
                memoryAlert: false,
            },
        });

        expect(sink.emit).toHaveBeenCalledOnce();
        sink.emit.mockClear();

        off();

        emitBudgetMetrics({
            contractId: CONTRACT_ID,
            method: 'b',
            timestamp: 2000,
            usage: {
                cpuInsns: 1_000_000n,
                memoryBytes: 512_000n,
                cpuLimitFraction: 0.01,
                memoryLimitFraction: 0.01,
                cpuAlert: false,
                memoryAlert: false,
            },
        });

        expect(sink.emit).not.toHaveBeenCalled();
    });

    it('setAnalyticsSink clears previous sinks and registers a new one', () => {
        const sink1 = { emit: vi.fn() };
        const sink2 = { emit: vi.fn() };

        addAnalyticsSink(sink1);
        setAnalyticsSink(sink2);

        emitBudgetMetrics({
            contractId: CONTRACT_ID,
            method: 'op',
            timestamp: 1000,
            usage: {
                cpuInsns: 1_000_000n,
                memoryBytes: 512_000n,
                cpuLimitFraction: 0.01,
                memoryLimitFraction: 0.01,
                cpuAlert: false,
                memoryAlert: false,
            },
        });

        expect(sink1.emit).not.toHaveBeenCalled();
        expect(sink2.emit).toHaveBeenCalledWith('budget_metric', expect.any(Object));
    });
});

// ── #1108 – precomputedSimulation regression tests ────────────────────────────

describe('trackContractBudget – precomputedSimulation (#1108)', () => {
    it('does not call _simulate when a precomputedSimulation is supplied', async () => {
        const mockSimulate = vi.fn();
        const precomputedSim = makeSimulation('5000000', '2000000');

        const usage = await trackContractBudget(
            CONTRACT_ID, 'transfer', [], SOURCE_KEY,
            {},
            mockSimulate,
            precomputedSim,
        );

        // _simulate must NOT have been called — we reused the supplied result.
        expect(mockSimulate).not.toHaveBeenCalled();
        expect(usage).not.toBeNull();
        expect(usage!.cpuInsns).toBe(5_000_000n);
    });

    it('issues a fresh RPC call (skipCache:true) when no precomputedSimulation is supplied', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('1000000', '512000'));

        await trackContractBudget(CONTRACT_ID, 'transfer', [], SOURCE_KEY, {}, mockSimulate);

        expect(mockSimulate).toHaveBeenCalledOnce();
        expect(mockSimulate).toHaveBeenCalledWith(
            CONTRACT_ID, 'transfer', [], SOURCE_KEY, { skipCache: true },
        );
    });

    it('calling simulateContractCall then trackContractBudget with the result issues only one RPC call', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('3000000', '1500000'));

        // Simulate the pattern: "I already simulated, now track budget"
        const sim = await mockSimulate(CONTRACT_ID, 'transfer', [], SOURCE_KEY, { skipCache: false });
        const usage = await trackContractBudget(
            CONTRACT_ID, 'transfer', [], SOURCE_KEY,
            {},
            mockSimulate, // pass mockSimulate but it should NOT be called again
            sim,
        );

        // mockSimulate was called once (for the explicit simulate), not a second time for tracking.
        expect(mockSimulate).toHaveBeenCalledOnce();
        expect(usage).not.toBeNull();
    });

    it('still records metric when precomputedSimulation is supplied', async () => {
        const mockSimulate = vi.fn();
        const precomputedSim = makeSimulation('8000000', '4000000');

        await trackContractBudget(CONTRACT_ID, 'myMethod', [], SOURCE_KEY, {}, mockSimulate, precomputedSim);

        const metrics = getBudgetMetrics();
        expect(metrics).toHaveLength(1);
        expect(metrics[0].contractId).toBe(CONTRACT_ID);
        expect(metrics[0].method).toBe('myMethod');
    });
});

describe('Circular buffer metrics storage', () => {
    it('preserves insertion order when buffer is below capacity', async () => {
        const mockSimulate = vi.fn()
            .mockResolvedValueOnce(makeSimulation('1000000', '512000'))
            .mockResolvedValueOnce(makeSimulation('2000000', '1024000'))
            .mockResolvedValueOnce(makeSimulation('3000000', '2048000'));

        await trackContractBudget(CONTRACT_ID, 'method1', [], SOURCE_KEY, {}, mockSimulate);
        await trackContractBudget(CONTRACT_ID, 'method2', [], SOURCE_KEY, {}, mockSimulate);
        await trackContractBudget(CONTRACT_ID, 'method3', [], SOURCE_KEY, {}, mockSimulate);

        const metrics = getBudgetMetrics();
        expect(metrics).toHaveLength(3);
        expect(metrics[0].method).toBe('method1');
        expect(metrics[1].method).toBe('method2');
        expect(metrics[2].method).toBe('method3');
    });

    it('returns empty array when no metrics recorded', () => {
        clearBudgetMetrics();
        const metrics = getBudgetMetrics();
        expect(metrics).toEqual([]);
    });

    it('evicts oldest entry when buffer reaches capacity', async () => {
        const mockSimulate = vi.fn().mockImplementation((_, method) =>
            Promise.resolve(makeSimulation('1000000', '512000')),
        );

        // Push MAX_STORED_METRICS + 1 entries
        for (let i = 0; i < 1001; i++) {
            await trackContractBudget(CONTRACT_ID, `method${i}`, [], SOURCE_KEY, {}, mockSimulate);
        }

        const metrics = getBudgetMetrics();
        expect(metrics).toHaveLength(1000);
        // First entry should be method1 (method0 was evicted)
        expect(metrics[0].method).toBe('method1');
        // Last entry should be method1000
        expect(metrics[999].method).toBe('method1000');
    });

    it('maintains correct ordering (newest last) after circular wrap', async () => {
        const mockSimulate = vi.fn().mockImplementation((_, method) =>
            Promise.resolve(makeSimulation('1000000', '512000')),
        );

        // Fill buffer beyond capacity to force wrap-around
        for (let i = 0; i < 1005; i++) {
            await trackContractBudget(CONTRACT_ID, `m${i}`, [], SOURCE_KEY, {}, mockSimulate);
        }

        const metrics = getBudgetMetrics();
        // Should have exactly 1000 entries (capacity)
        expect(metrics).toHaveLength(1000);
        // First should be m5 (since m0-m4 were evicted in circular wrap)
        expect(metrics[0].method).toBe('m5');
        // Last should be m1004
        expect(metrics[999].method).toBe('m1004');

        // Verify strict order
        for (let i = 0; i < metrics.length; i++) {
            const expectedNum = 5 + i;
            expect(metrics[i].method).toBe(`m${expectedNum}`);
        }
    });

    it('clears all metrics and resets circular buffer state', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('1000000', '512000'));

        await trackContractBudget(CONTRACT_ID, 'method1', [], SOURCE_KEY, {}, mockSimulate);
        expect(getBudgetMetrics()).toHaveLength(1);

        clearBudgetMetrics();
        expect(getBudgetMetrics()).toHaveLength(0);

        // Verify buffer is properly reset by adding new metrics
        await trackContractBudget(CONTRACT_ID, 'method2', [], SOURCE_KEY, {}, mockSimulate);
        const metrics = getBudgetMetrics();
        expect(metrics).toHaveLength(1);
        expect(metrics[0].method).toBe('method2');
    });

    it('handles sequential fills and clears correctly', async () => {
        const mockSimulate = vi.fn().mockResolvedValue(makeSimulation('1000000', '512000'));

        // Fill 10 entries
        for (let i = 0; i < 10; i++) {
            await trackContractBudget(CONTRACT_ID, `a${i}`, [], SOURCE_KEY, {}, mockSimulate);
        }
        expect(getBudgetMetrics()).toHaveLength(10);

        // Clear
        clearBudgetMetrics();
        expect(getBudgetMetrics()).toHaveLength(0);

        // Fill 5 more entries (should start from index 0 again)
        for (let i = 0; i < 5; i++) {
            await trackContractBudget(CONTRACT_ID, `b${i}`, [], SOURCE_KEY, {}, mockSimulate);
        }
        const metrics = getBudgetMetrics();
        expect(metrics).toHaveLength(5);
        expect(metrics[0].method).toBe('b0');
        expect(metrics[4].method).toBe('b4');
    });
});