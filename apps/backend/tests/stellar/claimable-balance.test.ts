/**
 * Stellar Claimable Balance Tests
 *
 * Tests claimable balance functionality on the Stellar testnet:
 *   - Balance creation with various claim predicates
 *   - Claim condition validation (unconditional, time-based, compound)
 *   - Balance claiming (authorized claimant)
 *   - Clawback functionality
 *   - Balance lifecycle (created → claimed / clawed back)
 *   - Balance queries (by ID, by claimant)
 *
 * No live network connection required — Horizon responses are simulated.
 *
 * Stellar claimable balance spec:
 *   - Created via CreateClaimableBalanceOp
 *   - Claimed via ClaimClaimableBalanceOp
 *   - Clawed back via ClawbackClaimableBalanceOp (requires AUTH_CLAWBACK_ENABLED)
 *   - Predicates: unconditional, before/after absolute time, compound (and/or/not)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type Network = 'testnet' | 'mainnet';

type PredicateType = 'unconditional' | 'before_absolute_time' | 'after_absolute_time' | 'and' | 'or' | 'not';

interface ClaimPredicate {
  type: PredicateType;
  value?: number; // Unix timestamp for time predicates
  predicates?: ClaimPredicate[]; // for and/or
  predicate?: ClaimPredicate; // for not
}

interface Claimant {
  destination: string;
  predicate: ClaimPredicate;
}

interface ClaimableBalance {
  id: string;
  asset: string; // "native" or "CODE:ISSUER"
  amount: string;
  claimants: Claimant[];
  sponsor?: string;
  lastModifiedLedger: number;
}

interface CreateBalanceRequest {
  asset: string;
  amount: string;
  claimants: Claimant[];
  sourceAccount: string;
  network: Network;
}

interface CreateBalanceResult {
  balanceId: string;
  transactionHash: string;
  ledger: number;
}

interface ClaimBalanceRequest {
  balanceId: string;
  claimantAccount: string;
  network: Network;
}

interface ClaimBalanceResult {
  transactionHash: string;
  ledger: number;
  claimed: boolean;
}

interface ClawbackRequest {
  balanceId: string;
  issuerAccount: string;
  network: Network;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TESTNET_ACCOUNT_A = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const TESTNET_ACCOUNT_B = 'GBVVJJWAKGKF3YJKBZGKZGKZGKZGKZGKZGKZGKZGKZGKZGKZGKZGKZ';
const TESTNET_ISSUER    = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZGKZGKZGKZGKZGKZGKZG';
const NATIVE_ASSET      = 'native';
const CUSTOM_ASSET      = 'USDC:GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZGKZGKZGKZGKZGKZGKZG';

const BALANCE_ID = '00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be';

// ── Service mock ──────────────────────────────────────────────────────────────

/**
 * Minimal in-memory claimable balance service for testing.
 * Simulates Horizon API behaviour without network calls.
 */
const store = new Map<string, ClaimableBalance>();

const claimableBalanceService = {
  create(req: CreateBalanceRequest): CreateBalanceResult {
    if (!req.asset) throw new Error('asset is required');
    if (!req.amount || Number(req.amount) <= 0) throw new Error('amount must be positive');
    if (!req.claimants || req.claimants.length === 0) throw new Error('at least one claimant required');
    if (req.claimants.length > 10) throw new Error('maximum 10 claimants allowed');

    const id = `balance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const balance: ClaimableBalance = {
      id,
      asset: req.asset,
      amount: req.amount,
      claimants: req.claimants,
      sponsor: req.sourceAccount,
      lastModifiedLedger: 1000,
    };
    store.set(id, balance);
    return { balanceId: id, transactionHash: `tx-${id}`, ledger: 1000 };
  },

  getById(id: string): ClaimableBalance | null {
    return store.get(id) ?? null;
  },

  getByClaimant(destination: string): ClaimableBalance[] {
    return Array.from(store.values()).filter(b =>
      b.claimants.some(c => c.destination === destination),
    );
  },

  claim(req: ClaimBalanceRequest): ClaimBalanceResult {
    const balance = store.get(req.balanceId);
    if (!balance) throw new Error(`Balance not found: ${req.balanceId}`);

    const claimant = balance.claimants.find(c => c.destination === req.claimantAccount);
    if (!claimant) throw new Error('Account is not an authorized claimant');

    if (!evaluatePredicate(claimant.predicate, Date.now())) {
      throw new Error('Claim predicate not satisfied');
    }

    store.delete(req.balanceId);
    return { transactionHash: `tx-claim-${req.balanceId}`, ledger: 1001, claimed: true };
  },

  clawback(req: ClawbackRequest): { transactionHash: string; ledger: number } {
    const balance = store.get(req.balanceId);
    if (!balance) throw new Error(`Balance not found: ${req.balanceId}`);
    if (balance.asset === NATIVE_ASSET) throw new Error('Cannot clawback native asset');
    store.delete(req.balanceId);
    return { transactionHash: `tx-clawback-${req.balanceId}`, ledger: 1002 };
  },
};

function evaluatePredicate(predicate: ClaimPredicate, nowMs: number): boolean {
  const nowSec = Math.floor(nowMs / 1000);
  switch (predicate.type) {
    case 'unconditional': return true;
    case 'before_absolute_time': return nowSec < (predicate.value ?? 0);
    case 'after_absolute_time': return nowSec >= (predicate.value ?? 0);
    case 'and': return (predicate.predicates ?? []).every(p => evaluatePredicate(p, nowMs));
    case 'or': return (predicate.predicates ?? []).some(p => evaluatePredicate(p, nowMs));
    case 'not': return !evaluatePredicate(predicate.predicate!, nowMs);
    default: return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const unconditional: ClaimPredicate = { type: 'unconditional' };

function makeClaimant(destination: string, predicate: ClaimPredicate = unconditional): Claimant {
  return { destination, predicate };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  store.clear();
});

describe('Claimable balance creation', () => {
  it('creates a balance with native asset', () => {
    const result = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '100',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    expect(result.balanceId).toBeDefined();
    expect(result.transactionHash).toBeDefined();
    expect(result.ledger).toBeGreaterThan(0);
  });

  it('creates a balance with a custom asset', () => {
    const result = claimableBalanceService.create({
      asset: CUSTOM_ASSET,
      amount: '50',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    expect(result.balanceId).toBeDefined();
  });

  it('creates a balance with multiple claimants', () => {
    const result = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [
        makeClaimant(TESTNET_ACCOUNT_A),
        makeClaimant(TESTNET_ACCOUNT_B),
      ],
      sourceAccount: TESTNET_ISSUER,
      network: 'testnet',
    });
    const balance = claimableBalanceService.getById(result.balanceId);
    expect(balance?.claimants).toHaveLength(2);
  });

  it('throws when asset is missing', () => {
    expect(() =>
      claimableBalanceService.create({
        asset: '',
        amount: '10',
        claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
        sourceAccount: TESTNET_ACCOUNT_B,
        network: 'testnet',
      }),
    ).toThrow('asset is required');
  });

  it('throws when amount is zero', () => {
    expect(() =>
      claimableBalanceService.create({
        asset: NATIVE_ASSET,
        amount: '0',
        claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
        sourceAccount: TESTNET_ACCOUNT_B,
        network: 'testnet',
      }),
    ).toThrow('amount must be positive');
  });

  it('throws when no claimants are provided', () => {
    expect(() =>
      claimableBalanceService.create({
        asset: NATIVE_ASSET,
        amount: '10',
        claimants: [],
        sourceAccount: TESTNET_ACCOUNT_B,
        network: 'testnet',
      }),
    ).toThrow('at least one claimant required');
  });

  it('throws when more than 10 claimants are provided', () => {
    const claimants = Array.from({ length: 11 }, (_, i) =>
      makeClaimant(`G${'A'.repeat(54)}${i}`),
    );
    expect(() =>
      claimableBalanceService.create({
        asset: NATIVE_ASSET,
        amount: '10',
        claimants,
        sourceAccount: TESTNET_ACCOUNT_B,
        network: 'testnet',
      }),
    ).toThrow('maximum 10 claimants allowed');
  });
});

describe('Claim predicates', () => {
  it('unconditional predicate always evaluates to true', () => {
    expect(evaluatePredicate({ type: 'unconditional' }, Date.now())).toBe(true);
  });

  it('before_absolute_time predicate is true before the deadline', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    expect(evaluatePredicate({ type: 'before_absolute_time', value: futureTs }, Date.now())).toBe(true);
  });

  it('before_absolute_time predicate is false after the deadline', () => {
    const pastTs = Math.floor(Date.now() / 1000) - 3600;
    expect(evaluatePredicate({ type: 'before_absolute_time', value: pastTs }, Date.now())).toBe(false);
  });

  it('after_absolute_time predicate is true after the start time', () => {
    const pastTs = Math.floor(Date.now() / 1000) - 3600;
    expect(evaluatePredicate({ type: 'after_absolute_time', value: pastTs }, Date.now())).toBe(true);
  });

  it('after_absolute_time predicate is false before the start time', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    expect(evaluatePredicate({ type: 'after_absolute_time', value: futureTs }, Date.now())).toBe(false);
  });

  it('and predicate requires all sub-predicates to be true', () => {
    const pastTs = Math.floor(Date.now() / 1000) - 3600;
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const andPredicate: ClaimPredicate = {
      type: 'and',
      predicates: [
        { type: 'after_absolute_time', value: pastTs },
        { type: 'before_absolute_time', value: futureTs },
      ],
    };
    expect(evaluatePredicate(andPredicate, Date.now())).toBe(true);
  });

  it('and predicate is false if any sub-predicate is false', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const andPredicate: ClaimPredicate = {
      type: 'and',
      predicates: [
        { type: 'unconditional' },
        { type: 'before_absolute_time', value: futureTs - 7200 }, // already past
      ],
    };
    expect(evaluatePredicate(andPredicate, Date.now())).toBe(false);
  });

  it('or predicate is true if any sub-predicate is true', () => {
    const pastTs = Math.floor(Date.now() / 1000) - 3600;
    const orPredicate: ClaimPredicate = {
      type: 'or',
      predicates: [
        { type: 'before_absolute_time', value: pastTs }, // false
        { type: 'unconditional' }, // true
      ],
    };
    expect(evaluatePredicate(orPredicate, Date.now())).toBe(true);
  });

  it('not predicate inverts the sub-predicate', () => {
    const notPredicate: ClaimPredicate = {
      type: 'not',
      predicate: { type: 'unconditional' },
    };
    expect(evaluatePredicate(notPredicate, Date.now())).toBe(false);
  });
});

describe('Balance claiming', () => {
  it('authorized claimant can claim a balance', () => {
    const { balanceId } = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    const result = claimableBalanceService.claim({
      balanceId,
      claimantAccount: TESTNET_ACCOUNT_A,
      network: 'testnet',
    });
    expect(result.claimed).toBe(true);
    expect(result.transactionHash).toBeDefined();
  });

  it('balance is removed from store after claiming', () => {
    const { balanceId } = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    claimableBalanceService.claim({ balanceId, claimantAccount: TESTNET_ACCOUNT_A, network: 'testnet' });
    expect(claimableBalanceService.getById(balanceId)).toBeNull();
  });

  it('unauthorized account cannot claim a balance', () => {
    const { balanceId } = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    expect(() =>
      claimableBalanceService.claim({
        balanceId,
        claimantAccount: TESTNET_ACCOUNT_B,
        network: 'testnet',
      }),
    ).toThrow('Account is not an authorized claimant');
  });

  it('claiming a non-existent balance throws', () => {
    expect(() =>
      claimableBalanceService.claim({
        balanceId: 'nonexistent-id',
        claimantAccount: TESTNET_ACCOUNT_A,
        network: 'testnet',
      }),
    ).toThrow('Balance not found');
  });

  it('claim fails when time predicate is not satisfied', () => {
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const { balanceId } = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A, { type: 'after_absolute_time', value: futureTs })],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    expect(() =>
      claimableBalanceService.claim({ balanceId, claimantAccount: TESTNET_ACCOUNT_A, network: 'testnet' }),
    ).toThrow('Claim predicate not satisfied');
  });
});

describe('Clawback functionality', () => {
  it('issuer can clawback a custom asset balance', () => {
    const { balanceId } = claimableBalanceService.create({
      asset: CUSTOM_ASSET,
      amount: '50',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ISSUER,
      network: 'testnet',
    });
    const result = claimableBalanceService.clawback({
      balanceId,
      issuerAccount: TESTNET_ISSUER,
      network: 'testnet',
    });
    expect(result.transactionHash).toBeDefined();
    expect(result.ledger).toBeGreaterThan(0);
  });

  it('balance is removed from store after clawback', () => {
    const { balanceId } = claimableBalanceService.create({
      asset: CUSTOM_ASSET,
      amount: '50',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ISSUER,
      network: 'testnet',
    });
    claimableBalanceService.clawback({ balanceId, issuerAccount: TESTNET_ISSUER, network: 'testnet' });
    expect(claimableBalanceService.getById(balanceId)).toBeNull();
  });

  it('cannot clawback native asset balance', () => {
    const { balanceId } = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    expect(() =>
      claimableBalanceService.clawback({ balanceId, issuerAccount: TESTNET_ISSUER, network: 'testnet' }),
    ).toThrow('Cannot clawback native asset');
  });

  it('clawback of non-existent balance throws', () => {
    expect(() =>
      claimableBalanceService.clawback({ balanceId: 'ghost', issuerAccount: TESTNET_ISSUER, network: 'testnet' }),
    ).toThrow('Balance not found');
  });
});

describe('Balance queries', () => {
  it('getById returns the created balance', () => {
    const { balanceId } = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    const balance = claimableBalanceService.getById(balanceId);
    expect(balance).not.toBeNull();
    expect(balance?.asset).toBe(NATIVE_ASSET);
    expect(balance?.amount).toBe('10');
  });

  it('getById returns null for unknown ID', () => {
    expect(claimableBalanceService.getById('unknown')).toBeNull();
  });

  it('getByClaimant returns balances for a given destination', () => {
    claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    claimableBalanceService.create({
      asset: CUSTOM_ASSET,
      amount: '20',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ISSUER,
      network: 'testnet',
    });
    const balances = claimableBalanceService.getByClaimant(TESTNET_ACCOUNT_A);
    expect(balances).toHaveLength(2);
  });

  it('getByClaimant returns empty array when no balances exist for account', () => {
    const balances = claimableBalanceService.getByClaimant(TESTNET_ACCOUNT_B);
    expect(balances).toHaveLength(0);
  });

  it('getByClaimant does not return balances for other claimants', () => {
    claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '10',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });
    const balances = claimableBalanceService.getByClaimant(TESTNET_ACCOUNT_B);
    expect(balances).toHaveLength(0);
  });
});

describe('Balance lifecycle', () => {
  it('full lifecycle: create → query → claim', () => {
    // Create
    const { balanceId } = claimableBalanceService.create({
      asset: NATIVE_ASSET,
      amount: '100',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ACCOUNT_B,
      network: 'testnet',
    });

    // Query
    const balance = claimableBalanceService.getById(balanceId);
    expect(balance).not.toBeNull();
    expect(balance?.claimants[0].destination).toBe(TESTNET_ACCOUNT_A);

    // Claim
    const result = claimableBalanceService.claim({
      balanceId,
      claimantAccount: TESTNET_ACCOUNT_A,
      network: 'testnet',
    });
    expect(result.claimed).toBe(true);

    // Verify removed
    expect(claimableBalanceService.getById(balanceId)).toBeNull();
  });

  it('full lifecycle: create → clawback', () => {
    const { balanceId } = claimableBalanceService.create({
      asset: CUSTOM_ASSET,
      amount: '50',
      claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
      sourceAccount: TESTNET_ISSUER,
      network: 'testnet',
    });

    expect(claimableBalanceService.getById(balanceId)).not.toBeNull();

    claimableBalanceService.clawback({ balanceId, issuerAccount: TESTNET_ISSUER, network: 'testnet' });

    expect(claimableBalanceService.getById(balanceId)).toBeNull();
  });

  it('multiple independent balances coexist', () => {
    const ids = Array.from({ length: 3 }, (_, i) =>
      claimableBalanceService.create({
        asset: NATIVE_ASSET,
        amount: String(10 + i),
        claimants: [makeClaimant(TESTNET_ACCOUNT_A)],
        sourceAccount: TESTNET_ACCOUNT_B,
        network: 'testnet',
      }).balanceId,
    );
    expect(claimableBalanceService.getByClaimant(TESTNET_ACCOUNT_A)).toHaveLength(3);

    // Claim one, others remain
    claimableBalanceService.claim({ balanceId: ids[0], claimantAccount: TESTNET_ACCOUNT_A, network: 'testnet' });
    expect(claimableBalanceService.getByClaimant(TESTNET_ACCOUNT_A)).toHaveLength(2);
  });
});
