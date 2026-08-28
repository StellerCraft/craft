/**
 * Property-Based Tests for Soroban Dry-Run Fee Estimation Accuracy and Determinism
 *
 * Tests that:
 * 1. Identical contract call inputs always produce the same fee estimate (determinism)
 * 2. Estimated fee matches minResourceFee from simulation (pass-through behavior)
 * 3. Edge cases like zero-resource invocations return minimum base fee
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SorobanRpc, xdr } from 'stellar-sdk';
import { dryRunWithForecast, clearForecastCache } from './soroban';
import * as fc from 'fast-check';

describe('Soroban Dry-Run Fee Estimation Property Tests', () => {
  const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
  const SOURCE = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';

  beforeEach(() => {
    clearForecastCache();
  });

  describe('Determinism: identical inputs produce identical estimates', () => {
    it('should return consistent fee estimates for repeated calls with identical arguments', async () => {
      const mockArgs: xdr.ScVal[] = [];
      const mockSimulation = {
        cost: { cpuInsns: '5000000', memBytes: '2097152' },
        minResourceFee: '500',
        events: [],
      } as unknown as SorobanRpc.Api.SimulateTransactionResponse;

      const mockSim = vi.fn().mockResolvedValue(mockSimulation);

      // Call with identical args multiple times
      const result1 = await dryRunWithForecast(CONTRACT, 'transfer', mockArgs, SOURCE, mockSim);
      const result2 = await dryRunWithForecast(CONTRACT, 'transfer', mockArgs, SOURCE, mockSim);
      const result3 = await dryRunWithForecast(CONTRACT, 'transfer', mockArgs, SOURCE, mockSim);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      expect(result3.ok).toBe(true);

      if (!result1.ok || !result2.ok || !result3.ok) return;

      // Forecasts should be identical
      expect(result1.forecast.estimatedFee).toBe(result2.forecast.estimatedFee);
      expect(result2.forecast.estimatedFee).toBe(result3.forecast.estimatedFee);
      expect(result1.forecast.cpuInstructions).toBe(result2.forecast.cpuInstructions);
      expect(result2.forecast.cpuInstructions).toBe(result3.forecast.cpuInstructions);
      expect(result1.forecast.memoryBytes).toBe(result2.forecast.memoryBytes);
      expect(result2.forecast.memoryBytes).toBe(result3.forecast.memoryBytes);

      // Only the first call should hit the simulate function (rest are cached)
      expect(mockSim).toHaveBeenCalledTimes(1);
    });

    it('should not cache results across different methods', async () => {
      const mockArgs: xdr.ScVal[] = [];
      const mockSim = vi.fn()
        .mockResolvedValueOnce({
          cost: { cpuInsns: '1000000', memBytes: '1000000' },
          minResourceFee: '100',
          events: [],
        } as unknown as SorobanRpc.Api.SimulateTransactionResponse)
        .mockResolvedValueOnce({
          cost: { cpuInsns: '2000000', memBytes: '2000000' },
          minResourceFee: '200',
          events: [],
        } as unknown as SorobanRpc.Api.SimulateTransactionResponse);

      const result1 = await dryRunWithForecast(CONTRACT, 'method1', mockArgs, SOURCE, mockSim);
      const result2 = await dryRunWithForecast(CONTRACT, 'method2', mockArgs, SOURCE, mockSim);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);

      if (!result1.ok || !result2.ok) return;

      // Different methods should produce different fees
      expect(result1.forecast.estimatedFee).toBe('100');
      expect(result2.forecast.estimatedFee).toBe('200');

      // Both calls should hit the simulate function
      expect(mockSim).toHaveBeenCalledTimes(2);
    });
  });

  describe('Simulation result handling', () => {
    it('should return exactly the minResourceFee from simulation as estimatedFee', async () => {
      const mockArgs: xdr.ScVal[] = [];

      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 1000000 }),
          fc.integer({ min: 100, max: 100000000 }),
          fc.integer({ min: 100, max: 41943040 }),
          async (fee, cpuInsns, memBytes) => {
            // Clear cache for each iteration to avoid cache interference
            clearForecastCache();

            const mockSimulation = {
              cost: { cpuInsns: cpuInsns.toString(), memBytes: memBytes.toString() },
              minResourceFee: fee.toString(),
              events: [],
            } as unknown as SorobanRpc.Api.SimulateTransactionResponse;

            const mockSim = vi.fn().mockResolvedValue(mockSimulation);
            const result = await dryRunWithForecast(CONTRACT, 'test', mockArgs, SOURCE, mockSim);

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            // estimatedFee should exactly match what the simulation returned
            expect(result.forecast.estimatedFee).toBe(fee.toString());
          },
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge cases', () => {
    it('should return minimum base fee for zero-resource invocation', async () => {
      const mockArgs: xdr.ScVal[] = [];
      const mockSimulation = {
        cost: { cpuInsns: '0', memBytes: '0' },
        minResourceFee: '100',
        events: [],
      } as unknown as SorobanRpc.Api.SimulateTransactionResponse;

      const mockSim = vi.fn().mockResolvedValue(mockSimulation);
      const result = await dryRunWithForecast(CONTRACT, 'noOp', mockArgs, SOURCE, mockSim);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.forecast.estimatedFee).toBe('100');
      expect(result.forecast.cpuInstructions).toBe('0');
      expect(result.forecast.memoryBytes).toBe('0');
    });

    it('should handle maximum resource values', async () => {
      const mockArgs: xdr.ScVal[] = [];
      const mockSimulation = {
        cost: { cpuInsns: '100000000', memBytes: '41943040' },
        minResourceFee: '1000000',
        events: [],
      } as unknown as SorobanRpc.Api.SimulateTransactionResponse;

      const mockSim = vi.fn().mockResolvedValue(mockSimulation);
      const result = await dryRunWithForecast(CONTRACT, 'heavy', mockArgs, SOURCE, mockSim);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.forecast.cpuInstructions).toBe('100000000');
      expect(result.forecast.memoryBytes).toBe('41943040');
    });

    it('should emit warnings only when exceeding 80% of limits', async () => {
      const mockArgs: xdr.ScVal[] = [];

      // Below threshold
      const belowThreshold = {
        cost: { cpuInsns: '79000000', memBytes: '33554432' },
        minResourceFee: '500',
        events: [],
      } as unknown as SorobanRpc.Api.SimulateTransactionResponse;

      let mockSim = vi.fn().mockResolvedValue(belowThreshold);
      let result = await dryRunWithForecast(CONTRACT, 'low', mockArgs, SOURCE, mockSim);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.forecast.warnings).toHaveLength(0);
      }

      clearForecastCache();

      // Above threshold
      const aboveThreshold = {
        cost: { cpuInsns: '85000000', memBytes: '35651584' },
        minResourceFee: '500',
        events: [],
      } as unknown as SorobanRpc.Api.SimulateTransactionResponse;

      mockSim = vi.fn().mockResolvedValue(aboveThreshold);
      result = await dryRunWithForecast(CONTRACT, 'high', mockArgs, SOURCE, mockSim);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.forecast.warnings.length).toBeGreaterThan(0);
        expect(result.forecast.warnings.some((w) => w.includes('CPU instructions'))).toBe(true);
        expect(result.forecast.warnings.some((w) => w.includes('Memory bytes'))).toBe(true);
      }
    });
  });

  describe('Varied argument complexity', () => {
    it('should handle varied argument lists with proper resource tracking', async () => {
      const mockSimulation = {
        cost: { cpuInsns: '5000000', memBytes: '2097152' },
        minResourceFee: '500',
        events: [],
      } as unknown as SorobanRpc.Api.SimulateTransactionResponse;

      const mockSim = vi.fn().mockResolvedValue(mockSimulation);

      // Generate varied argument lists using fast-check
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.nat({ max: 100 }), { maxLength: 10 }),
          async (values) => {
            // Clear cache for each generated case
            clearForecastCache();

            const mockArgs: xdr.ScVal[] = values.map((v) =>
              xdr.ScVal.scvI32(v)
            );

            const result = await dryRunWithForecast(
              CONTRACT,
              'complex',
              mockArgs,
              SOURCE,
              mockSim
            );

            expect(result.ok).toBe(true);
            if (!result.ok) return;

            expect(result.forecast).toHaveProperty('estimatedFee');
            expect(result.forecast).toHaveProperty('cpuInstructions');
            expect(result.forecast).toHaveProperty('memoryBytes');
            expect(result.forecast).toHaveProperty('warnings');
          },
        ),
        { numRuns: 50 }
      );
    });
  });
});
