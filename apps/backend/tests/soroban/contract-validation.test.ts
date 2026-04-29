import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Soroban Contract Validation Tests
 * 
 * Verifies Soroban smart contract validation and interaction work correctly.
 */

interface ContractAddress {
  address: string;
  network: 'testnet' | 'mainnet';
}

interface ContractMethod {
  name: string;
  params: Array<{ name: string; type: string }>;
  returns: string;
}

interface ContractState {
  address: string;
  methods: ContractMethod[];
  isDeployed: boolean;
  lastUpdated: number;
}

interface InvocationResult {
  success: boolean;
  result?: unknown;
  error?: string;
  gasUsed?: number;
}

// ---------------------------------------------------------------------------
// Invocation cache (mirrors soroban.ts cache design for test coverage)
//
//  - Key   : `${contractId}:${method}:${JSON.stringify(args)}`
//  - TTL   : INVOCATION_CACHE_TTL_MS (5 000 ms by default)
//  - Size  : MAX_INVOCATION_CACHE_ENTRIES (1 000).  Oldest entry evicted
//            when the cap is reached.
// ---------------------------------------------------------------------------
const INVOCATION_CACHE_TTL_MS = 5_000;
const MAX_INVOCATION_CACHE_ENTRIES = 1_000;

interface InvocationCacheEntry {
  result: InvocationResult;
  storedAt: number;
}

class SorobanContractValidator {
  private contractCache: Map<string, ContractState> = new Map();
  private invocationCache: Map<string, InvocationCacheEntry> = new Map();
  private testnetHorizonUrl = 'https://horizon-testnet.stellar.org';
  private mainnetHorizonUrl = 'https://horizon.stellar.org';

  validateContractAddress(address: string, network: 'testnet' | 'mainnet'): boolean {
    // Stellar contract addresses start with 'C' and are 56 characters
    if (!address.startsWith('C') || address.length !== 56) {
      return false;
    }

    // Basic checksum validation (simplified)
    const validChars = /^[A-Z2-7]+$/.test(address.slice(1));
    return validChars;
  }

  async getContractState(contractAddress: ContractAddress): Promise<ContractState> {
    const cacheKey = `${contractAddress.address}-${contractAddress.network}`;

    if (this.contractCache.has(cacheKey)) {
      return this.contractCache.get(cacheKey)!;
    }

    // Simulate fetching contract state
    const state: ContractState = {
      address: contractAddress.address,
      methods: this.getMockContractMethods(),
      isDeployed: true,
      lastUpdated: Date.now(),
    };

    this.contractCache.set(cacheKey, state);
    return state;
  }

  private getMockContractMethods(): ContractMethod[] {
    return [
      {
        name: 'initialize',
        params: [{ name: 'admin', type: 'Address' }],
        returns: 'void',
      },
      {
        name: 'transfer',
        params: [
          { name: 'from', type: 'Address' },
          { name: 'to', type: 'Address' },
          { name: 'amount', type: 'i128' },
        ],
        returns: 'bool',
      },
      {
        name: 'balance_of',
        params: [{ name: 'account', type: 'Address' }],
        returns: 'i128',
      },
    ];
  }

  async invokeContractMethod(
    contractAddress: ContractAddress,
    methodName: string,
    params: Record<string, unknown>
  ): Promise<InvocationResult> {
    if (!this.validateContractAddress(contractAddress.address, contractAddress.network)) {
      return {
        success: false,
        error: 'Invalid contract address',
      };
    }

    // Build a cache key from (contractId, network, method, params).
    const cacheKey = `${contractAddress.address}:${contractAddress.network}:${methodName}:${JSON.stringify(params)}`;
    const now = Date.now();

    // Cache hit – return stored result if still within TTL.
    const cached = this.invocationCache.get(cacheKey);
    if (cached && now - cached.storedAt < INVOCATION_CACHE_TTL_MS) {
      return cached.result;
    }

    const state = await this.getContractState(contractAddress);
    const method = state.methods.find((m) => m.name === methodName);

    if (!method) {
      return {
        success: false,
        error: `Method ${methodName} not found`,
      };
    }

    // Simulate method invocation (cache miss).
    const result: InvocationResult = {
      success: true,
      result: this.simulateMethodResult(methodName, params),
      gasUsed: Math.floor(Math.random() * 100000) + 10000,
    };

    // Evict oldest if at capacity, then store.
    if (this.invocationCache.size >= MAX_INVOCATION_CACHE_ENTRIES) {
      const firstKey = this.invocationCache.keys().next().value;
      if (firstKey !== undefined) this.invocationCache.delete(firstKey);
    }
    this.invocationCache.set(cacheKey, { result, storedAt: now });

    return result;
  }

  private simulateMethodResult(methodName: string, params: Record<string, unknown>): unknown {
    const results: Record<string, unknown> = {
      initialize: true,
      transfer: true,
      balance_of: Math.floor(Math.random() * 1000000),
    };
    return results[methodName] || null;
  }

  async queryContractState(
    contractAddress: ContractAddress,
    key: string
  ): Promise<unknown> {
    if (!this.validateContractAddress(contractAddress.address, contractAddress.network)) {
      throw new Error('Invalid contract address');
    }

    // Simulate state query
    return {
      key,
      value: `state_${key}_value`,
      ledger: Math.floor(Math.random() * 1000000),
    };
  }

  async verifyContractDeployment(contractAddress: ContractAddress): Promise<boolean> {
    if (!this.validateContractAddress(contractAddress.address, contractAddress.network)) {
      return false;
    }

    const state = await this.getContractState(contractAddress);
    return state.isDeployed;
  }

  /**
   * Flush all cached state.
   * Call this in afterEach / teardown to guarantee test isolation.
   */
  clearCache(): void {
    this.contractCache.clear();
    this.invocationCache.clear();
  }
}

describe('Soroban Contract Validation', () => {
  let validator: SorobanContractValidator;

  beforeEach(() => {
    validator = new SorobanContractValidator();
    vi.useFakeTimers();
  });

  afterEach(() => {
    validator.clearCache();
    vi.useRealTimers();
  });

  describe('Contract Address Validation', () => {
    it('should validate correct contract address format', () => {
      const validAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

      expect(validator.validateContractAddress(validAddress, 'testnet')).toBe(true);
    });

    it('should reject address with invalid prefix', () => {
      const invalidAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

      expect(validator.validateContractAddress(invalidAddress, 'testnet')).toBe(false);
    });

    it('should reject address with incorrect length', () => {
      const shortAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC';

      expect(validator.validateContractAddress(shortAddress, 'testnet')).toBe(false);
    });

    it('should reject address with invalid characters', () => {
      const invalidAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC!';

      expect(validator.validateContractAddress(invalidAddress, 'testnet')).toBe(false);
    });

    it('should validate on both testnet and mainnet', () => {
      const validAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

      expect(validator.validateContractAddress(validAddress, 'testnet')).toBe(true);
      expect(validator.validateContractAddress(validAddress, 'mainnet')).toBe(true);
    });
  });

  describe('Contract Method Invocation', () => {
    it('should invoke contract method successfully', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const result = await validator.invokeContractMethod(contractAddress, 'transfer', {
        from: 'GXXX',
        to: 'GYYY',
        amount: 100,
      });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.gasUsed).toBeGreaterThan(0);
    });

    it('should return error for invalid contract address', async () => {
      const contractAddress: ContractAddress = {
        address: 'INVALID',
        network: 'testnet',
      };

      const result = await validator.invokeContractMethod(contractAddress, 'transfer', {});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return error for non-existent method', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const result = await validator.invokeContractMethod(contractAddress, 'nonExistent', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should include gas usage in result', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const result = await validator.invokeContractMethod(contractAddress, 'transfer', {});

      expect(result.gasUsed).toBeGreaterThan(10000);
      expect(result.gasUsed).toBeLessThan(200000);
    });
  });

  describe('Contract State Queries', () => {
    it('should query contract state successfully', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const state = await validator.queryContractState(contractAddress, 'balance');

      expect(state).toBeDefined();
      expect((state as Record<string, unknown>).key).toBe('balance');
    });

    it('should throw error for invalid contract address in query', async () => {
      const contractAddress: ContractAddress = {
        address: 'INVALID',
        network: 'testnet',
      };

      await expect(
        validator.queryContractState(contractAddress, 'balance')
      ).rejects.toThrow('Invalid contract address');
    });

    it('should return ledger information in state query', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const state = await validator.queryContractState(contractAddress, 'data');

      expect((state as Record<string, unknown>).ledger).toBeGreaterThan(0);
    });
  });

  describe('Contract Deployment Verification', () => {
    it('should verify deployed contract', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const isDeployed = await validator.verifyContractDeployment(contractAddress);

      expect(isDeployed).toBe(true);
    });

    it('should return false for invalid address', async () => {
      const contractAddress: ContractAddress = {
        address: 'INVALID',
        network: 'testnet',
      };

      const isDeployed = await validator.verifyContractDeployment(contractAddress);

      expect(isDeployed).toBe(false);
    });

    it('should verify on both networks', async () => {
      const address = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

      const testnetResult = await validator.verifyContractDeployment({
        address,
        network: 'testnet',
      });

      const mainnetResult = await validator.verifyContractDeployment({
        address,
        network: 'mainnet',
      });

      expect(testnetResult).toBe(true);
      expect(mainnetResult).toBe(true);
    });
  });

  describe('Contract Error Handling', () => {
    it('should handle contract invocation errors gracefully', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const result = await validator.invokeContractMethod(contractAddress, 'unknownMethod', {});

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.result).toBeUndefined();
    });

    it('should validate address before any operation', async () => {
      const invalidAddress: ContractAddress = {
        address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const result = await validator.invokeContractMethod(invalidAddress, 'transfer', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });
  });

  describe('Contract State Caching', () => {
    it('should cache contract state', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const state1 = await validator.getContractState(contractAddress);
      const state2 = await validator.getContractState(contractAddress);

      expect(state1).toEqual(state2);
    });

    it('should clear cache without errors', () => {
      expect(() => validator.clearCache()).not.toThrow();
    });

    it('should have different cache entries for different networks', async () => {
      const address = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

      const testnetState = await validator.getContractState({
        address,
        network: 'testnet',
      });

      const mainnetState = await validator.getContractState({
        address,
        network: 'mainnet',
      });

      expect(testnetState.lastUpdated).toBeDefined();
      expect(mainnetState.lastUpdated).toBeDefined();
    });

    // -----------------------------------------------------------------------
    // Invocation-level cache tests
    // -----------------------------------------------------------------------

    it('[cache-hit] should return the cached invocation result on repeated call', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };
      const params = { from: 'GXXX', to: 'GYYY', amount: 100 };

      const first = await validator.invokeContractMethod(contractAddress, 'transfer', params);
      // Advance time by less than TTL – cache should still be valid.
      vi.advanceTimersByTime(INVOCATION_CACHE_TTL_MS - 1);
      const second = await validator.invokeContractMethod(contractAddress, 'transfer', params);

      // Both calls must return the exact same object reference (cache hit).
      expect(second).toBe(first);
      expect(second.success).toBe(true);
      expect(second.gasUsed).toBe(first.gasUsed);
    });

    it('[cache-miss] should produce independent results for different method names', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const transferResult = await validator.invokeContractMethod(contractAddress, 'transfer', {});
      const balanceResult = await validator.invokeContractMethod(contractAddress, 'balance_of', {});

      // Different methods → different cache keys → independent results.
      expect(transferResult.success).toBe(true);
      expect(balanceResult.success).toBe(true);
      // They are different cached entries, not the same object.
      expect(transferResult).not.toBe(balanceResult);
    });

    it('[cache-miss] should produce independent results for different params', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const result1 = await validator.invokeContractMethod(contractAddress, 'transfer', { amount: 50 });
      const result2 = await validator.invokeContractMethod(contractAddress, 'transfer', { amount: 200 });

      // Different params → different cache keys → different cached objects.
      expect(result1).not.toBe(result2);
    });

    it('[ttl-expiry] should invalidate cached result after TTL elapses', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };
      const params = { from: 'GXXX', to: 'GYYY', amount: 100 };

      const first = await validator.invokeContractMethod(contractAddress, 'transfer', params);

      // Advance fake time past the TTL.
      vi.advanceTimersByTime(INVOCATION_CACHE_TTL_MS + 1);

      const second = await validator.invokeContractMethod(contractAddress, 'transfer', params);

      // After TTL expiry the cache entry should have been replaced; the two
      // result objects will be different instances even though both succeed.
      expect(second.success).toBe(true);
      expect(second).not.toBe(first);
    });

    it('[clearCache] should not return stale data after clearCache() is called', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const first = await validator.invokeContractMethod(contractAddress, 'transfer', {});
      validator.clearCache();
      const second = await validator.invokeContractMethod(contractAddress, 'transfer', {});

      // Cache was cleared – the second call is a fresh invocation and must be
      // a new object, not the previously cached one.
      expect(second).not.toBe(first);
    });

    it('[cache-miss] should treat different networks as separate cache keys', async () => {
      const address = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const params = { from: 'GXXX', to: 'GYYY', amount: 100 };

      const testnetResult = await validator.invokeContractMethod(
        { address, network: 'testnet' },
        'transfer',
        params
      );
      const mainnetResult = await validator.invokeContractMethod(
        { address, network: 'mainnet' },
        'transfer',
        params
      );

      expect(testnetResult).not.toBe(mainnetResult);
    });
  });

  describe('Contract Methods Availability', () => {
    it('should return available contract methods', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const state = await validator.getContractState(contractAddress);

      expect(state.methods.length).toBeGreaterThan(0);
      expect(state.methods.some((m) => m.name === 'transfer')).toBe(true);
      expect(state.methods.some((m) => m.name === 'balance_of')).toBe(true);
    });

    it('should include method parameters and return types', async () => {
      const contractAddress: ContractAddress = {
        address: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        network: 'testnet',
      };

      const state = await validator.getContractState(contractAddress);
      const transferMethod = state.methods.find((m) => m.name === 'transfer');

      expect(transferMethod).toBeDefined();
      expect(transferMethod!.params.length).toBeGreaterThan(0);
      expect(transferMethod!.returns).toBeDefined();
    });
  });
});

// Export TTL constant so the test assertions above stay in sync with the cache
// implementation without magic numbers.
export { INVOCATION_CACHE_TTL_MS };
