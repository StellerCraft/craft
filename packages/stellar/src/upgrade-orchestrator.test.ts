import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ContractAbiSchema } from './upgrade-orchestrator';

const mocks = vi.hoisted(() => ({
  mockSimulate: vi.fn(),
  mockFromXDR: vi.fn(),
}));

vi.mock('stellar-sdk', () => ({
  SorobanRpc: {
    Api: {
      isSimulationError: vi.fn(),
    },
    Server: vi.fn(),
  },
  TransactionBuilder: {
    fromXDR: mocks.mockFromXDR,
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  BASE_FEE: '100',
}));

vi.mock('./soroban', () => ({
  createSorobanClient: vi.fn(() => ({
    simulateTransaction: mocks.mockSimulate,
  })),
}));

const { diffAbiSchemas, orchestrateContractUpgrade } = await import('./upgrade-orchestrator');

function makeSchema(overrides?: Partial<ContractAbiSchema>): ContractAbiSchema {
  return {
    version: '1.0.0',
    storageKeys: [
      { key: 'admin', type: 'instance', required: true },
      { key: 'balance', type: 'persistent', required: true },
      { key: 'metadata', type: 'instance', required: false },
    ],
    ...overrides,
  };
}

const currentSchema = makeSchema();

// ---------------------------------------------------------------------------
// diffAbiSchemas (pure, no mocking needed)
// ---------------------------------------------------------------------------

describe('diffAbiSchemas', () => {
  it('returns safe=true with no changes when schemas are identical', () => {
    const report = diffAbiSchemas(currentSchema, makeSchema());
    expect(report.safe).toBe(true);
    expect(report.changes).toHaveLength(0);
    expect(report.breakingChanges).toHaveLength(0);
  });

  it('detects added optional keys as non-breaking', () => {
    const next = makeSchema({
      storageKeys: [
        ...currentSchema.storageKeys,
        { key: 'new_key', type: 'temporary', required: false },
      ],
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.safe).toBe(true);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].type).toBe('added');
    expect(report.changes[0].key).toBe('new_key');
  });

  it('flags added required keys as breaking', () => {
    const next = makeSchema({
      storageKeys: [
        ...currentSchema.storageKeys,
        { key: 'new_required_key', type: 'instance', required: true },
      ],
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.safe).toBe(false);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].type).toBe('added');
    expect(report.breakingChanges).toHaveLength(1);
    expect(report.breakingChanges[0].type).toBe('added');
    expect(report.breakingChanges[0].key).toBe('new_required_key');
  });

  it('detects removed optional keys as non-breaking', () => {
    const next = makeSchema({
      storageKeys: currentSchema.storageKeys.filter(
        (k) => k.key !== 'metadata',
      ),
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.safe).toBe(true);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].type).toBe('removed');
    expect(report.changes[0].key).toBe('metadata');
  });

  it('flags removed required keys as breaking', () => {
    const next = makeSchema({
      storageKeys: currentSchema.storageKeys.filter((k) => k.key !== 'admin'),
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.safe).toBe(false);
    expect(report.breakingChanges).toHaveLength(1);
    expect(report.breakingChanges[0].type).toBe('removed');
    expect(report.breakingChanges[0].key).toBe('admin');
  });

  it('flags storage type changes as breaking', () => {
    const next = makeSchema({
      storageKeys: currentSchema.storageKeys.map((k) =>
        k.key === 'balance' ? { ...k, type: 'temporary' as const } : k,
      ),
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.safe).toBe(false);
    expect(report.breakingChanges).toHaveLength(1);
    expect(report.breakingChanges[0].type).toBe('type_changed');
    expect(report.breakingChanges[0].key).toBe('balance');
  });

  it('reports multiple breaking changes together', () => {
    const next = makeSchema({
      storageKeys: [
        { key: 'balance', type: 'temporary', required: true },
        { key: 'metadata', type: 'instance', required: false },
      ],
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.safe).toBe(false);
    expect(report.breakingChanges).toHaveLength(2);
    const breakTypes = report.breakingChanges.map((c) => c.type).sort();
    expect(breakTypes).toEqual(['removed', 'type_changed']);
  });

  it('produces a human-readable summary', () => {
    const next = makeSchema({
      version: '2.0.0',
      storageKeys: [
        ...currentSchema.storageKeys,
        { key: 'fee', type: 'instance', required: true },
      ],
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.summary).toContain('1.0.0');
    expect(report.summary).toContain('2.0.0');
    expect(report.summary).toContain('Added');
    expect(report.summary).toContain('SAFE');
  });

  it('includes breaking change details in summary when unsafe', () => {
    const next = makeSchema({
      version: '2.0.0',
      storageKeys: currentSchema.storageKeys.filter((k) => k.key !== 'admin'),
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.summary).toContain('UNSAFE');
    expect(report.summary).toContain('admin');
  });

  it('includes newly-required keys in breaking change summary', () => {
    const next = makeSchema({
      version: '2.0.0',
      storageKeys: [
        ...currentSchema.storageKeys,
        { key: 'new_required_fee', type: 'persistent', required: true },
      ],
    });
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.summary).toContain('UNSAFE');
    expect(report.summary).toContain('new_required_fee');
    expect(report.summary).toContain('added as REQUIRED');
  });

  it('handles empty storage keys', () => {
    const empty: ContractAbiSchema = { version: '1.0.0', storageKeys: [] };
    const report = diffAbiSchemas(empty, empty);
    expect(report.safe).toBe(true);
    expect(report.changes).toHaveLength(0);
  });

  it('detects all additions, removals, and changes in one diff', () => {
    const next: ContractAbiSchema = {
      version: '2.0.0',
      storageKeys: [
        { key: 'balance', type: 'instance', required: true },
        { key: 'metadata', type: 'instance', required: false },
        { key: 'new_flag', type: 'temporary', required: true },
      ],
    };
    const report = diffAbiSchemas(currentSchema, next);
    expect(report.changes).toHaveLength(3);
    expect(report.changes.find((c) => c.type === 'added')?.key).toBe('new_flag');
    expect(report.changes.find((c) => c.type === 'removed')?.key).toBe('admin');
    expect(report.changes.find((c) => c.type === 'type_changed')?.key).toBe('balance');
    // admin removed (required) + balance type changed + new_flag added (required) = 3 breaking
    expect(report.breakingChanges).toHaveLength(3);
  });

  // ── Function signature diffing (Issue #969) ────────────────────────────────

  it('detects removed functions as breaking changes', () => {
    const current = makeSchema({
      functions: [
        { name: 'transfer', paramTypes: ['string', 'bigint'], returnType: 'void' },
        { name: 'balance', paramTypes: ['string'], returnType: 'bigint' },
      ],
    });
    const next = makeSchema({
      functions: [
        { name: 'balance', paramTypes: ['string'], returnType: 'bigint' },
      ],
    });

    const report = diffAbiSchemas(current, next);
    expect(report.safe).toBe(false);
    expect(report.breakingChanges).toHaveLength(1);
    expect(report.breakingChanges[0].type).toBe('function_removed');
    expect(report.breakingChanges[0].key).toBe('transfer');
  });

  it('detects changed function parameter types as breaking', () => {
    const current = makeSchema({
      functions: [
        { name: 'transfer', paramTypes: ['string', 'bigint'], returnType: 'void' },
      ],
    });
    const next = makeSchema({
      functions: [
        { name: 'transfer', paramTypes: ['Address', 'bigint'], returnType: 'void' },
      ],
    });

    const report = diffAbiSchemas(current, next);
    expect(report.safe).toBe(false);
    expect(report.breakingChanges).toHaveLength(1);
    expect(report.breakingChanges[0].type).toBe('function_signature_changed');
    expect(report.breakingChanges[0].key).toBe('transfer');
  });

  it('detects changed function return type as breaking', () => {
    const current = makeSchema({
      functions: [
        { name: 'calculate', paramTypes: ['bigint', 'bigint'], returnType: 'bigint' },
      ],
    });
    const next = makeSchema({
      functions: [
        { name: 'calculate', paramTypes: ['bigint', 'bigint'], returnType: 'string' },
      ],
    });

    const report = diffAbiSchemas(current, next);
    expect(report.safe).toBe(false);
    expect(report.breakingChanges).toHaveLength(1);
    expect(report.breakingChanges[0].type).toBe('function_signature_changed');
  });

  it('allows adding new functions (non-breaking)', () => {
    const current = makeSchema({
      functions: [
        { name: 'transfer', paramTypes: ['string', 'bigint'], returnType: 'void' },
      ],
    });
    const next = makeSchema({
      functions: [
        { name: 'transfer', paramTypes: ['string', 'bigint'], returnType: 'void' },
        { name: 'approve', paramTypes: ['string', 'bigint'], returnType: 'void' },
      ],
    });

    const report = diffAbiSchemas(current, next);
    expect(report.safe).toBe(true);
    expect(report.breakingChanges).toHaveLength(0);
  });

  it('maintains backward compatibility when functions are not supplied', () => {
    const current = makeSchema(); // No functions field
    const next = makeSchema(); // No functions field
    const report = diffAbiSchemas(current, next);
    expect(report.safe).toBe(true);
    expect(report.changes).toHaveLength(0);
  });

  it('includes function changes in summary', () => {
    const current = makeSchema({
      version: '1.0.0',
      functions: [
        { name: 'transfer', paramTypes: ['string', 'bigint'], returnType: 'void' },
      ],
    });
    const next = makeSchema({
      version: '2.0.0',
      functions: [],
    });

    const report = diffAbiSchemas(current, next);
    expect(report.summary).toContain('Function signatures');
    expect(report.summary).toContain('Removed');
    expect(report.summary).toContain('transfer');
  });

  it('detects multiple function changes together', () => {
    const current = makeSchema({
      functions: [
        { name: 'foo', paramTypes: ['string'], returnType: 'void' },
        { name: 'bar', paramTypes: ['bigint'], returnType: 'bigint' },
        { name: 'baz', paramTypes: [], returnType: 'string' },
      ],
    });
    const next = makeSchema({
      functions: [
        { name: 'bar', paramTypes: ['bigint'], returnType: 'string' }, // changed return type
        { name: 'baz', paramTypes: [], returnType: 'string' },
        { name: 'qux', paramTypes: ['string'], returnType: 'void' }, // new
      ],
    });

    const report = diffAbiSchemas(current, next);
    expect(report.safe).toBe(false);
    expect(report.breakingChanges).toHaveLength(2);
    const breakTypes = report.breakingChanges.map((c) => c.type).sort();
    expect(breakTypes).toEqual(['function_removed', 'function_signature_changed']);
  });
});

// ---------------------------------------------------------------------------
// orchestrateContractUpgrade
// ---------------------------------------------------------------------------

describe('orchestrateContractUpgrade', () => {
  const mockTx = { mockTx: true };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockFromXDR.mockReturnValue(mockTx);
  });

  it('returns success with diff report when upgrade is safe (no dry-run)', async () => {
    const result = await orchestrateContractUpgrade({
      currentSchema,
      newSchema: makeSchema(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(false);
      expect(result.diffReport.safe).toBe(true);
    }
  });

  it('blocks upgrade when breaking changes are detected', async () => {
    const badNext = makeSchema({
      storageKeys: currentSchema.storageKeys.filter((k) => k.key !== 'admin'),
    });
    const result = await orchestrateContractUpgrade({
      currentSchema,
      newSchema: badNext,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('blocked');
      expect(result.error).toContain('breaking');
      expect(result.diffReport).toBeDefined();
    }
  });

  it('returns error when dryRun=true but no upgradeTransactionXdr', async () => {
    const result = await orchestrateContractUpgrade({
      currentSchema,
      newSchema: makeSchema(),
      dryRun: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('dryRun');
    }
  });

  it('performs simulation when dryRun=true with valid XDR', async () => {
    mocks.mockSimulate.mockResolvedValue({});

    const result = await orchestrateContractUpgrade({
      currentSchema,
      newSchema: makeSchema(),
      dryRun: true,
      upgradeTransactionXdr: 'AAAAAgAAAABb8PsSeJ2XH7dDrHV6I90DH2eDBFezq92rLvdUesFGzgAAAGQADKQ7',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(true);
      expect(result.simulationResult).toBeDefined();
    }
    expect(mocks.mockFromXDR).toHaveBeenCalledWith(
      'AAAAAgAAAABb8PsSeJ2XH7dDrHV6I90DH2eDBFezq92rLvdUesFGzgAAAGQADKQ7',
      'Test SDF Network ; September 2015',
    );
    expect(mocks.mockSimulate).toHaveBeenCalledWith(mockTx);
  });

  it('handles simulation errors gracefully', async () => {
    mocks.mockSimulate.mockRejectedValue(new Error('RPC timeout'));

    const result = await orchestrateContractUpgrade({
      currentSchema,
      newSchema: makeSchema(),
      dryRun: true,
      upgradeTransactionXdr: 'AAAAAgAAAABb8PsSeJ2XH7dDrHV6I90DH2eDBFezq92rLvdUesFGzgAAAGQADKQ7',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Simulation failed');
      expect(result.error).toContain('RPC timeout');
      expect(result.diffReport).toBeDefined();
    }
  });

  it('returns simulation error when simulate returns an error response', async () => {
    const errorResult = { error: 'Contract error: out of bounds' };
    mocks.mockSimulate.mockResolvedValue(errorResult);

    const { SorobanRpc } = await import('stellar-sdk');
    vi.mocked(SorobanRpc.Api.isSimulationError).mockReturnValueOnce(true);

    const result = await orchestrateContractUpgrade({
      currentSchema,
      newSchema: makeSchema(),
      dryRun: true,
      upgradeTransactionXdr: 'AAAAAgAAAABb8PsSeJ2XH7dDrHV6I90DH2eDBFezq92rLvdUesFGzgAAAGQADKQ7',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Simulation error');
    }
  });
});
