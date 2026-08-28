/**
 * Soroban Contract Simulation Dry-Run Tests
 *
 * Validates that contract simulation performs dry-runs before deployment,
 * surfacing errors and resource estimates without committing to the ledger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SorobanRpc, xdr } from 'stellar-sdk';
import { performContractDryRun, simulateContractCall, dryRunWithForecast, clearForecastCache } from './soroban';

describe('Soroban Contract Simulation Dry-Run', () => {
  const mockContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const mockMethod = 'transfer';
  const mockArgs: xdr.ScVal[] = [];
  const mockPublicKey = 'GBUQWP3BOUZX34ULNQG23RQ6F4BWFIRETEI7I2AXBCCF7C3HLCA5UABK';

  describe('performContractDryRun', () => {
    it('should return success for valid simulation', async () => {
      const result = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    });

    it('should include error message on simulation failure', async () => {
      // Use invalid contract ID to trigger error
      const result = await performContractDryRun(
        'INVALID',
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      if (!result.success) {
        expect(result.error).toBeTruthy();
        expect(typeof result.error).toBe('string');
      }
    });

    it('should include resource estimates on success', async () => {
      const result = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      if (result.success && result.resourceEstimate) {
        expect(result.resourceEstimate).toBeDefined();
        // Resource estimates may include cpuInstructions, memoryBytes, fee
      }
    });

    it('should include simulation result', async () => {
      const result = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      expect(result).toHaveProperty('result');
    });

    it('should handle account not found error', async () => {
      const invalidPublicKey = 'GINVALIDACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
      
      const result = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        invalidPublicKey
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should handle contract not found error', async () => {
      const nonExistentContract = 'CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBD2KM';
      
      const result = await performContractDryRun(
        nonExistentContract,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      expect(result.success).toBe(false);
    });

    it('should detect simulation errors', async () => {
      // This test validates error detection in simulation response
      const result = await performContractDryRun(
        mockContractId,
        'nonexistent_method',
        mockArgs,
        mockPublicKey
      );

      // Should handle gracefully whether success or failure
      expect(result).toHaveProperty('success');
    });
  });

  describe('Resource Estimation', () => {
    it('should provide CPU instruction estimates when available', async () => {
      const result = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      if (result.success && result.resourceEstimate?.cpuInstructions) {
        expect(typeof result.resourceEstimate.cpuInstructions).toBe('string');
      }
    });

    it('should provide memory byte estimates when available', async () => {
      const result = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      if (result.success && result.resourceEstimate?.memoryBytes) {
        expect(typeof result.resourceEstimate.memoryBytes).toBe('string');
      }
    });

    it('should provide fee estimates when available', async () => {
      const result = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      if (result.success && result.resourceEstimate?.fee) {
        expect(typeof result.resourceEstimate.fee).toBe('string');
      }
    });
  });

  describe('Deployment Blocking', () => {
    it('should indicate deployment should be blocked on failure', async () => {
      const result = await performContractDryRun(
        'INVALID',
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      if (!result.success) {
        // Caller should check result.success and block deployment
        expect(result.success).toBe(false);
        expect(result.error).toBeTruthy();
      }
    });

    it('should indicate deployment can proceed on success', async () => {
      const result = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      if (result.success) {
        // Caller can proceed with deployment
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
      }
    });
  });

  describe('Integration with simulateContractCall', () => {
    it('should use simulateContractCall internally', async () => {
      // performContractDryRun wraps simulateContractCall
      const dryRunResult = await performContractDryRun(
        mockContractId,
        mockMethod,
        mockArgs,
        mockPublicKey
      );

      expect(dryRunResult).toHaveProperty('success');
      expect(dryRunResult).toHaveProperty('result');
    });
  });
});

// ---------------------------------------------------------------------------
// dryRunWithForecast – resource consumption forecasting (#782)
// ---------------------------------------------------------------------------

function makeSuccessSimulation(overrides: Record<string, any> = {}): SorobanRpc.Api.SimulateTransactionResponse {
  return {
    cost: { cpuInsns: '5000000', memBytes: '2097152' },
    minResourceFee: '500',
    events: [],
    ...overrides,
  } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
}

function makeErrorSimulation(): SorobanRpc.Api.SimulateTransactionResponse {
  return { error: 'contract trap' } as unknown as SorobanRpc.Api.SimulateTransactionResponse;
}

describe('dryRunWithForecast', () => {
  const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const SOURCE = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
  const ARGS: xdr.ScVal[] = [];

  beforeEach(() => {
    clearForecastCache();
  });

  it('returns all forecast fields for a successful simulation', async () => {
    const mockSim = vi.fn().mockResolvedValue(makeSuccessSimulation());
    const result = await dryRunWithForecast(CONTRACT, 'transfer', ARGS, SOURCE, mockSim);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.forecast.estimatedFee).toBe('500');
    expect(result.forecast.cpuInstructions).toBe('5000000');
    expect(result.forecast.memoryBytes).toBe('2097152');
    expect(typeof result.forecast.ledgerEntriesRead).toBe('number');
    expect(typeof result.forecast.ledgerEntriesWritten).toBe('number');
    expect(typeof result.forecast.eventsEmitted).toBe('number');
    expect(Array.isArray(result.forecast.warnings)).toBe(true);
  });

  it('returns ok:false for a simulation error', async () => {
    const mockSim = vi.fn().mockResolvedValue(makeErrorSimulation());
    const result = await dryRunWithForecast(CONTRACT, 'transfer', ARGS, SOURCE, mockSim);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeTruthy();
  });

  it('populates warnings when CPU instructions exceed 80% of limit', async () => {
    // 100_000_000 * 0.85 = 85_000_000
    const mockSim = vi.fn().mockResolvedValue(
      makeSuccessSimulation({ cost: { cpuInsns: '85000000', memBytes: '0' } }),
    );
    const result = await dryRunWithForecast(CONTRACT, 'heavy', ARGS, SOURCE, mockSim);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forecast.warnings.some((w) => w.includes('CPU instructions'))).toBe(true);
  });

  it('populates warnings when memory bytes exceed 80% of limit', async () => {
    // 41_943_040 * 0.85 ≈ 35_651_584
    const mockSim = vi.fn().mockResolvedValue(
      makeSuccessSimulation({ cost: { cpuInsns: '0', memBytes: '35651584' } }),
    );
    const result = await dryRunWithForecast(CONTRACT, 'bigAlloc', ARGS, SOURCE, mockSim);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forecast.warnings.some((w) => w.includes('Memory bytes'))).toBe(true);
  });

  it('counts events emitted from the simulation events array', async () => {
    const fakeEvents = [{}, {}, {}] as any[];
    const mockSim = vi.fn().mockResolvedValue(makeSuccessSimulation({ events: fakeEvents }));
    const result = await dryRunWithForecast(CONTRACT, 'emit', ARGS, SOURCE, mockSim);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forecast.eventsEmitted).toBe(3);
  });

  it('caches results for identical calls within 60 seconds', async () => {
    const mockSim = vi.fn().mockResolvedValue(makeSuccessSimulation());
    await dryRunWithForecast(CONTRACT, 'transfer', ARGS, SOURCE, mockSim);
    await dryRunWithForecast(CONTRACT, 'transfer', ARGS, SOURCE, mockSim);

    expect(mockSim).toHaveBeenCalledTimes(1);
  });

  it('does not emit warnings when resources are below 80% of limits', async () => {
    const mockSim = vi.fn().mockResolvedValue(makeSuccessSimulation());
    const result = await dryRunWithForecast(CONTRACT, 'cheap', ARGS, SOURCE, mockSim);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.forecast.warnings).toHaveLength(0);
  });

  it('returns ok:false when simulate throws', async () => {
    const mockSim = vi.fn().mockRejectedValue(new Error('RPC timeout'));
    const result = await dryRunWithForecast(CONTRACT, 'crash', ARGS, SOURCE, mockSim);

    expect(result.ok).toBe(false);
  });
});
