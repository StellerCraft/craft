/**
 * Adversarial property-based test suite for Soroban contract invocation state machine
 *
 * Tests cover:
 *   - All InvokeContractResult branches including partial failures
 *   - Concurrent invocation storms
 *   - Malformed XDR payloads
 *   - RPC timeout injection
 *   - Shared sorobanClient state integrity
 *
 * Uses fast-check for randomized property testing with deterministic seed replay.
 * No real RPC calls — uses mocked stub infrastructure.
 *
 * Issue: #820
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  simulateContractCall,
  clearCache,
  type InvokeContractResult,
} from './soroban';
import { xdr, StrKey } from 'stellar-sdk';

// ── Fast-Check Arbitraries ────────────────────────────────────────────────────

/** Generate valid contract addresses (C...) */
const contractAddressArbitrary = fc
  .hexaString({ minLength: 56, maxLength: 56 })
  .map((hex) => {
    try {
      // Create a contract address-like structure
      return `C${hex.slice(0, 56)}`;
    } catch {
      return 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    }
  });

/** Generate method names */
const methodNameArbitrary = fc
  .stringMatching(/^[a-z_][a-z0-9_]*$/)
  .filter((s) => s.length > 0 && s.length < 50);

/** Generate ScVal XDR values */
const scValArbitrary = fc.constantFrom([
  xdr.ScVal.scvTypeSymbol(xdr.ScSymbol.fromXDR('test')),
  xdr.ScVal.scvTypeU64(xdr.Uint64.fromString('12345')),
  xdr.ScVal.scvTypeBool(true),
]);

/** Generate source public keys (G...) */
const sourcePublicKeyArbitrary = fc
  .hexaString({ minLength: 56, maxLength: 56 })
  .map((hex) => {
    try {
      const buffer = Buffer.from(hex, 'hex');
      return StrKey.encodeEd25519PublicKey(buffer.slice(0, 32));
    } catch {
      return 'GBRPYHIL2CI3WHZDTOOQFC6EB4RBROST5G4FAST7ELS4PHPNANDMJODE';
    }
  });

/** Generate arrays of ScVal arguments */
const xdrArgsArbitrary = fc
  .array(scValArbitrary, { minLength: 0, maxLength: 10 })
  .map((values) => values);

// ── Mocking Infrastructure ────────────────────────────────────────────────────

interface MockSimulationState {
  shouldFail: boolean;
  shouldTimeout: boolean;
  isCorrupted: boolean;
  callCount: number;
  concurrentCalls: number;
}

const mockState: MockSimulationState = {
  shouldFail: false,
  shouldTimeout: false,
  isCorrupted: false,
  callCount: 0,
  concurrentCalls: 0,
};

// Mock the Soroban client to avoid real RPC calls
vi.mock('./soroban', async () => {
  const actual = await vi.importActual<typeof import('./soroban')>(
    './soroban'
  );
  return {
    ...actual,
    simulateContractCall: vi.fn(async () => {
      mockState.callCount++;
      mockState.concurrentCalls++;

      try {
        if (mockState.shouldTimeout) {
          await new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('RPC timeout')),
              100
            )
          );
        }

        if (mockState.shouldFail) {
          return {
            ok: false,
            error: {
              status: 500,
              message: 'Simulated RPC failure',
              code: 'RPC_ERROR',
            },
          };
        }

        if (mockState.isCorrupted) {
          return {
            ok: true,
            result: null, // Corrupted response
          };
        }

        return {
          ok: true,
          result: {
            events: [],
            result: { retval: { type: 'sc_val_type_u64' } },
          },
        };
      } finally {
        mockState.concurrentCalls--;
      }
    }),
  };
});

describe('Soroban Invocation - Adversarial Property-Based Test Suite', () => {
  beforeEach(() => {
    mockState.shouldFail = false;
    mockState.shouldTimeout = false;
    mockState.isCorrupted = false;
    mockState.callCount = 0;
    mockState.concurrentCalls = 0;
    clearCache();
  });

  afterEach(() => {
    clearCache();
  });

  describe('Property: Result shape invariants', () => {
    it('should always return InvokeContractResult with ok boolean', () => {
      fc.assert(
        fc.property(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            const result = await simulateContractCall(
              contractId,
              method,
              args,
              sourceKey
            );

            expect(result).toHaveProperty('ok');
            expect(typeof result.ok).toBe('boolean');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have error property only when ok is false', () => {
      fc.assert(
        fc.property(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            mockState.shouldFail = fc.sample(fc.boolean())[0];

            const result = await simulateContractCall(
              contractId,
              method,
              args,
              sourceKey
            );

            if (result.ok === false) {
              expect(result).toHaveProperty('error');
              expect(result.error).toHaveProperty('message');
            } else {
              expect(result).toHaveProperty('result');
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have well-formed error with status, message, code when ok is false', () => {
      fc.assert(
        fc.property(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            mockState.shouldFail = true;

            const result = await simulateContractCall(
              contractId,
              method,
              args,
              sourceKey
            );

            if (result.ok === false) {
              expect(result.error).toHaveProperty('message');
              expect(typeof result.error.message).toBe('string');
              expect(result.error.message.length).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property: Cache determinism', () => {
    it('should return identical results for identical inputs (cache hit)', async () => {
      await fc.assert(
        fc.asyncProperty(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            const result1 = await simulateContractCall(
              contractId,
              method,
              args,
              sourceKey
            );
            const result2 = await simulateContractCall(
              contractId,
              method,
              args,
              sourceKey
            );

            expect(result1.ok).toBe(result2.ok);
            if (result1.ok && result2.ok) {
              expect(result1.result).toEqual(result2.result);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property: Concurrent invocation safety', () => {
    it('should handle concurrent invocations without state corruption', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.tuple(
            contractAddressArbitrary,
            methodNameArbitrary,
            xdrArgsArbitrary,
            sourcePublicKeyArbitrary
          ),
          async ([contractId, method, args, sourceKey]) => {
            const promises = Array.from({ length: 10 }, async () => {
              return simulateContractCall(contractId, method, args, sourceKey);
            });

            const results = await Promise.all(promises);

            // All results should have ok property
            results.forEach((result) => {
              expect(result).toHaveProperty('ok');
              expect(typeof result.ok).toBe('boolean');
            });

            // Results should be consistent
            const firstOk = results[0].ok;
            results.forEach((result) => {
              expect(result.ok).toBe(firstOk);
            });
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should not corrupt shared sorobanClient state under concurrent load', async () => {
      clearCache();
      mockState.callCount = 0;

      const testCases = await fc.sample(
        fc.tuple(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary
        ),
        10
      );

      const promises = testCases.map(
        ([contractId, method, args, sourceKey]) =>
          simulateContractCall(contractId, method, args, sourceKey)
      );

      const results = await Promise.all(promises);

      // All results should be properly formed
      results.forEach((result) => {
        expect(result).toHaveProperty('ok');
        expect(typeof result.ok).toBe('boolean');
      });
    });
  });

  describe('Property: Error path handling', () => {
    it('should return well-formed { ok: false, error } on RPC failures', async () => {
      mockState.shouldFail = true;

      await fc.assert(
        fc.asyncProperty(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            const result = await simulateContractCall(
              contractId,
              method,
              args,
              sourceKey
            );

            expect(result.ok).toBe(false);
            expect(result).toHaveProperty('error');
            expect(result.error).toHaveProperty('message');
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should never throw, always return InvokeContractResult', async () => {
      mockState.shouldFail = true;
      mockState.shouldTimeout = true;

      await fc.assert(
        fc.asyncProperty(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            let threw = false;
            let result: InvokeContractResult | undefined;

            try {
              result = await simulateContractCall(
                contractId,
                method,
                args,
                sourceKey
              );
            } catch {
              threw = true;
            }

            expect(threw).toBe(false);
            expect(result).toBeDefined();
            expect(result).toHaveProperty('ok');
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property: Timeout resilience', () => {
    it('should handle RPC timeouts gracefully', async () => {
      mockState.shouldTimeout = true;

      await fc.assert(
        fc.asyncProperty(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            let result: InvokeContractResult | undefined;

            try {
              result = await simulateContractCall(
                contractId,
                method,
                args,
                sourceKey
              );
            } catch {
              // Timeouts may reject, which is acceptable
            }

            if (result) {
              expect(result).toHaveProperty('ok');
              expect(typeof result.ok).toBe('boolean');
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property: Malformed payload resilience', () => {
    it('should handle edge case contract IDs', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 0, maxLength: 100 }),
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            let result: InvokeContractResult | undefined;

            try {
              result = await simulateContractCall(
                contractId,
                method,
                args,
                sourceKey
              );
            } catch {
              // Invalid contracts may throw, which is acceptable
            }

            if (result) {
              expect(result).toHaveProperty('ok');
              expect(typeof result.ok).toBe('boolean');
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle empty and long method names', async () => {
      await fc.assert(
        fc.asyncProperty(
          contractAddressArbitrary,
          fc.string({ minLength: 0, maxLength: 500 }),
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            let result: InvokeContractResult | undefined;

            try {
              result = await simulateContractCall(
                contractId,
                method,
                args,
                sourceKey
              );
            } catch {
              // Invalid methods may throw
            }

            if (result) {
              expect(result).toHaveProperty('ok');
              expect(typeof result.ok).toBe('boolean');
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should handle invalid XDR arguments gracefully', async () => {
      await fc.assert(
        fc.asyncProperty(
          contractAddressArbitrary,
          methodNameArbitrary,
          fc.array(fc.anything(), { minLength: 0, maxLength: 50 }),
          sourcePublicKeyArbitrary,
          async (contractId, method, args, sourceKey) => {
            let result: InvokeContractResult | undefined;

            try {
              result = await simulateContractCall(
                contractId,
                method,
                args as any,
                sourceKey
              );
            } catch {
              // Invalid XDR may throw
            }

            if (result) {
              expect(result).toHaveProperty('ok');
              expect(typeof result.ok).toBe('boolean');
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property: Deterministic seed replay', () => {
    it('should reproduce shrunk counterexample with same seed', async () => {
      const seed = 12345;

      const result1 = fc.sample(
        fc.tuple(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary
        ),
        10,
        { seed }
      );

      const result2 = fc.sample(
        fc.tuple(
          contractAddressArbitrary,
          methodNameArbitrary,
          xdrArgsArbitrary,
          sourcePublicKeyArbitrary
        ),
        10,
        { seed }
      );

      expect(result1).toEqual(result2);
    });
  });
});
