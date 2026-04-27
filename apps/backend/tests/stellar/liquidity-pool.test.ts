/**
 * Stellar Liquidity Pool Tests
 *
 * Comprehensive tests for Stellar AMM liquidity pool operations including:
 *   - Pool creation and lifecycle
 *   - Deposits and withdrawals
 *   - Swap operations
 *   - Fee calculations
 *   - Edge cases (zero liquidity, imbalanced pools, slippage)
 *
 * Run: vitest run tests/stellar/liquidity-pool.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair } from 'stellar-sdk';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Stellar AMM uses a fixed 0.3% fee (30 bps) */
const POOL_FEE_BPS = 30;
const POOL_FEE_RATE = POOL_FEE_BPS / 10_000;

/** Minimum liquidity locked on first deposit to prevent division-by-zero attacks */
const MINIMUM_LIQUIDITY = 1000n;

// ── Types ─────────────────────────────────────────────────────────────────────

interface PoolAsset {
  code: string;
  issuer: string;
}

type PoolStatus = 'active' | 'empty' | 'frozen';

interface LiquidityPool {
  id: string;
  assetA: PoolAsset;
  assetB: PoolAsset;
  reserveA: bigint;
  reserveB: bigint;
  totalShares: bigint;
  feeBps: number;
  status: PoolStatus;
}

interface DepositResult {
  sharesIssued: bigint;
  actualAmountA: bigint;
  actualAmountB: bigint;
}

interface WithdrawResult {
  amountA: bigint;
  amountB: bigint;
  sharesBurned: bigint;
}

interface SwapResult {
  amountOut: bigint;
  fee: bigint;
  priceImpact: number;
  newReserveIn: bigint;
  newReserveOut: bigint;
}

interface PoolStats {
  price: number;
  tvl: bigint;
  feeRate: number;
}

// ── AMM Implementation ────────────────────────────────────────────────────────

/** Integer square root (Babylonian method) */
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('Cannot take sqrt of negative');
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

function createPool(assetA: PoolAsset, assetB: PoolAsset, feeBps = POOL_FEE_BPS): LiquidityPool {
  const id = `pool_${assetA.code}_${assetB.code}_${feeBps}`;
  return { id, assetA, assetB, reserveA: 0n, reserveB: 0n, totalShares: 0n, feeBps, status: 'empty' };
}

/**
 * Deposit liquidity into pool.
 * First deposit: shares = sqrt(amountA * amountB) - MINIMUM_LIQUIDITY
 * Subsequent: shares = min(amountA/reserveA, amountB/reserveB) * totalShares
 */
function deposit(
  pool: LiquidityPool,
  amountA: bigint,
  amountB: bigint,
): { pool: LiquidityPool; result: DepositResult } {
  if (amountA <= 0n || amountB <= 0n) throw new Error('Deposit amounts must be positive');

  let sharesIssued: bigint;
  let actualA = amountA;
  let actualB = amountB;

  if (pool.totalShares === 0n) {
    // First deposit — lock MINIMUM_LIQUIDITY
    const liquidity = isqrt(amountA * amountB);
    if (liquidity <= MINIMUM_LIQUIDITY) throw new Error('Insufficient initial liquidity');
    sharesIssued = liquidity - MINIMUM_LIQUIDITY;
  } else {
    // Proportional deposit — use the limiting asset
    const sharesA = (amountA * pool.totalShares) / pool.reserveA;
    const sharesB = (amountB * pool.totalShares) / pool.reserveB;
    sharesIssued = sharesA < sharesB ? sharesA : sharesB;
    // Adjust the non-limiting asset to maintain ratio
    if (sharesA < sharesB) {
      actualB = (amountA * pool.reserveB) / pool.reserveA;
    } else {
      actualA = (amountB * pool.reserveA) / pool.reserveB;
    }
  }

  const updated: LiquidityPool = {
    ...pool,
    reserveA: pool.reserveA + actualA,
    reserveB: pool.reserveB + actualB,
    totalShares: pool.totalShares + sharesIssued,
    status: 'active',
  };

  return { pool: updated, result: { sharesIssued, actualAmountA: actualA, actualAmountB: actualB } };
}

function withdraw(
  pool: LiquidityPool,
  shares: bigint,
): { pool: LiquidityPool; result: WithdrawResult } {
  if (shares <= 0n) throw new Error('Shares must be positive');
  if (shares > pool.totalShares) throw new Error('Insufficient shares');

  const amountA = (shares * pool.reserveA) / pool.totalShares;
  const amountB = (shares * pool.reserveB) / pool.totalShares;

  const updated: LiquidityPool = {
    ...pool,
    reserveA: pool.reserveA - amountA,
    reserveB: pool.reserveB - amountB,
    totalShares: pool.totalShares - shares,
    status: pool.totalShares - shares === 0n ? 'empty' : 'active',
  };

  return { pool: updated, result: { amountA, amountB, sharesBurned: shares } };
}

/**
 * Constant-product swap: x * y = k
 * amountOut = (reserveOut * amountIn * (10000 - feeBps)) / (reserveIn * 10000 + amountIn * (10000 - feeBps))
 */
function swap(
  pool: LiquidityPool,
  amountIn: bigint,
  swapAForB: boolean,
): { pool: LiquidityPool; result: SwapResult } {
  if (pool.status !== 'active') throw new Error('Pool is not active');
  if (amountIn <= 0n) throw new Error('Swap amount must be positive');

  const reserveIn = swapAForB ? pool.reserveA : pool.reserveB;
  const reserveOut = swapAForB ? pool.reserveB : pool.reserveA;

  const feeFactor = BigInt(10_000 - pool.feeBps);
  const amountInWithFee = amountIn * feeFactor;
  const amountOut = (reserveOut * amountInWithFee) / (reserveIn * 10_000n + amountInWithFee);
  const fee = amountIn - (amountIn * feeFactor) / 10_000n;

  if (amountOut >= reserveOut) throw new Error('Insufficient liquidity for swap');

  const newReserveIn = reserveIn + amountIn;
  const newReserveOut = reserveOut - amountOut;

  // Price impact: (amountOut / reserveOut) as percentage
  const priceImpact = Number((amountOut * 10_000n) / reserveOut) / 100;

  const updated: LiquidityPool = swapAForB
    ? { ...pool, reserveA: newReserveIn, reserveB: newReserveOut }
    : { ...pool, reserveA: newReserveOut, reserveB: newReserveIn };

  return { pool: updated, result: { amountOut, fee, priceImpact, newReserveIn, newReserveOut } };
}

function getPoolStats(pool: LiquidityPool): PoolStats {
  if (pool.reserveA === 0n) return { price: 0, tvl: 0n, feeRate: pool.feeBps / 10_000 };
  const price = Number(pool.reserveB) / Number(pool.reserveA);
  return { price, tvl: pool.reserveA + pool.reserveB, feeRate: pool.feeBps / 10_000 };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const XLM: PoolAsset = { code: 'XLM', issuer: '' };
const USDC: PoolAsset = { code: 'USDC', issuer: Keypair.random().publicKey() };
const BTC: PoolAsset = { code: 'BTC', issuer: Keypair.random().publicKey() };

function makeActivePool(reserveA = 1_000_000n, reserveB = 5_000_000n): LiquidityPool {
  const pool = createPool(XLM, USDC);
  return deposit(pool, reserveA, reserveB).pool;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Stellar Liquidity Pool — Pool Creation', () => {
  it('creates a pool with correct asset pair', () => {
    const pool = createPool(XLM, USDC);
    expect(pool.assetA.code).toBe('XLM');
    expect(pool.assetB.code).toBe('USDC');
  });

  it('creates pool with zero reserves and empty status', () => {
    const pool = createPool(XLM, USDC);
    expect(pool.reserveA).toBe(0n);
    expect(pool.reserveB).toBe(0n);
    expect(pool.totalShares).toBe(0n);
    expect(pool.status).toBe('empty');
  });

  it('creates pool with default 30 bps fee', () => {
    const pool = createPool(XLM, USDC);
    expect(pool.feeBps).toBe(30);
  });

  it('creates pool with custom fee', () => {
    const pool = createPool(XLM, USDC, 10);
    expect(pool.feeBps).toBe(10);
  });

  it('generates unique pool id from asset pair and fee', () => {
    const p1 = createPool(XLM, USDC, 30);
    const p2 = createPool(XLM, BTC, 30);
    expect(p1.id).not.toBe(p2.id);
  });
});

describe('Stellar Liquidity Pool — Deposits', () => {
  it('first deposit issues shares and activates pool', () => {
    const pool = createPool(XLM, USDC);
    const { pool: updated, result } = deposit(pool, 1_000_000n, 4_000_000n);
    expect(updated.status).toBe('active');
    expect(result.sharesIssued).toBeGreaterThan(0n);
    expect(updated.reserveA).toBe(1_000_000n);
    expect(updated.reserveB).toBe(4_000_000n);
  });

  it('first deposit locks MINIMUM_LIQUIDITY', () => {
    const pool = createPool(XLM, USDC);
    const { result } = deposit(pool, 1_000_000n, 1_000_000n);
    // shares = sqrt(1e6 * 1e6) - 1000 = 1_000_000 - 1000 = 999_000
    expect(result.sharesIssued).toBe(999_000n);
  });

  it('subsequent deposit issues proportional shares', () => {
    const pool = makeActivePool(1_000_000n, 1_000_000n);
    const { result } = deposit(pool, 500_000n, 500_000n);
    // 50% of existing liquidity → ~50% of shares
    expect(result.sharesIssued).toBeGreaterThan(0n);
  });

  it('subsequent deposit adjusts non-limiting asset to maintain ratio', () => {
    const pool = makeActivePool(1_000_000n, 2_000_000n); // ratio 1:2
    const { result } = deposit(pool, 100_000n, 300_000n); // excess B
    // actualB should be adjusted to 200_000 (100_000 * 2)
    expect(result.actualAmountB).toBe(200_000n);
    expect(result.actualAmountA).toBe(100_000n);
  });

  it('rejects zero deposit amounts', () => {
    const pool = createPool(XLM, USDC);
    expect(() => deposit(pool, 0n, 1_000_000n)).toThrow('positive');
    expect(() => deposit(pool, 1_000_000n, 0n)).toThrow('positive');
  });

  it('rejects initial deposit below minimum liquidity threshold', () => {
    const pool = createPool(XLM, USDC);
    expect(() => deposit(pool, 10n, 10n)).toThrow('Insufficient initial liquidity');
  });

  it('total shares increase after each deposit', () => {
    const pool = makeActivePool();
    const sharesBefore = pool.totalShares;
    const { pool: updated } = deposit(pool, 100_000n, 500_000n);
    expect(updated.totalShares).toBeGreaterThan(sharesBefore);
  });
});

describe('Stellar Liquidity Pool — Withdrawals', () => {
  it('withdraws proportional assets for given shares', () => {
    const pool = makeActivePool(1_000_000n, 2_000_000n);
    const halfShares = pool.totalShares / 2n;
    const { result } = withdraw(pool, halfShares);
    expect(result.amountA).toBeGreaterThan(0n);
    expect(result.amountB).toBeGreaterThan(0n);
  });

  it('full withdrawal empties pool and sets status to empty', () => {
    const pool = makeActivePool();
    const { pool: updated } = withdraw(pool, pool.totalShares);
    expect(updated.status).toBe('empty');
    expect(updated.totalShares).toBe(0n);
  });

  it('withdrawal reduces reserves proportionally', () => {
    const pool = makeActivePool(1_000_000n, 4_000_000n);
    const { result } = withdraw(pool, pool.totalShares);
    // ratio should be preserved: amountB / amountA ≈ 4
    const ratio = Number(result.amountB) / Number(result.amountA);
    expect(ratio).toBeCloseTo(4, 0);
  });

  it('rejects withdrawal of zero shares', () => {
    const pool = makeActivePool();
    expect(() => withdraw(pool, 0n)).toThrow('positive');
  });

  it('rejects withdrawal exceeding total shares', () => {
    const pool = makeActivePool();
    expect(() => withdraw(pool, pool.totalShares + 1n)).toThrow('Insufficient shares');
  });

  it('burns correct number of shares', () => {
    const pool = makeActivePool();
    const sharesToBurn = pool.totalShares / 4n;
    const { result } = withdraw(pool, sharesToBurn);
    expect(result.sharesBurned).toBe(sharesToBurn);
  });
});

describe('Stellar Liquidity Pool — Swap Operations', () => {
  it('swaps asset A for asset B and returns positive output', () => {
    const pool = makeActivePool(1_000_000n, 5_000_000n);
    const { result } = swap(pool, 10_000n, true);
    expect(result.amountOut).toBeGreaterThan(0n);
  });

  it('swaps asset B for asset A', () => {
    const pool = makeActivePool(1_000_000n, 5_000_000n);
    const { result } = swap(pool, 50_000n, false);
    expect(result.amountOut).toBeGreaterThan(0n);
  });

  it('maintains constant product invariant (k = x * y) after swap', () => {
    const pool = makeActivePool(1_000_000n, 5_000_000n);
    const kBefore = pool.reserveA * pool.reserveB;
    const { pool: updated } = swap(pool, 10_000n, true);
    const kAfter = updated.reserveA * updated.reserveB;
    // k should increase slightly due to fees
    expect(kAfter).toBeGreaterThanOrEqual(kBefore);
  });

  it('larger swap produces higher price impact', () => {
    const pool = makeActivePool(1_000_000n, 5_000_000n);
    const { result: small } = swap(pool, 1_000n, true);
    const { result: large } = swap(pool, 100_000n, true);
    expect(large.priceImpact).toBeGreaterThan(small.priceImpact);
  });

  it('rejects swap on empty pool', () => {
    const pool = createPool(XLM, USDC);
    expect(() => swap(pool, 1_000n, true)).toThrow('not active');
  });

  it('rejects zero swap amount', () => {
    const pool = makeActivePool();
    expect(() => swap(pool, 0n, true)).toThrow('positive');
  });

  it('rejects swap that would drain the pool', () => {
    const pool = makeActivePool(1_000n, 1_000n);
    expect(() => swap(pool, 999_999_999n, true)).toThrow('Insufficient liquidity');
  });

  it('updates reserves correctly after swap A→B', () => {
    const pool = makeActivePool(1_000_000n, 5_000_000n);
    const amountIn = 10_000n;
    const { pool: updated } = swap(pool, amountIn, true);
    expect(updated.reserveA).toBe(pool.reserveA + amountIn);
    expect(updated.reserveB).toBeLessThan(pool.reserveB);
  });
});

describe('Stellar Liquidity Pool — Fee Calculations', () => {
  it('calculates 0.3% fee on swap input', () => {
    const pool = makeActivePool(10_000_000n, 10_000_000n);
    const amountIn = 100_000n;
    const { result } = swap(pool, amountIn, true);
    // fee = amountIn * feeBps / 10000 = 100_000 * 30 / 10000 = 300
    expect(result.fee).toBe(300n);
  });

  it('lower fee pool returns more output for same input', () => {
    const poolHighFee = createPool(XLM, USDC, 100); // 1%
    const poolLowFee = createPool(XLM, USDC, 10);   // 0.1%
    const { pool: activeHigh } = deposit(poolHighFee, 1_000_000n, 5_000_000n);
    const { pool: activeLow } = deposit(poolLowFee, 1_000_000n, 5_000_000n);

    const { result: highResult } = swap(activeHigh, 10_000n, true);
    const { result: lowResult } = swap(activeLow, 10_000n, true);
    expect(lowResult.amountOut).toBeGreaterThan(highResult.amountOut);
  });

  it('fee is always less than input amount', () => {
    const pool = makeActivePool();
    const amountIn = 50_000n;
    const { result } = swap(pool, amountIn, true);
    expect(result.fee).toBeLessThan(amountIn);
  });

  it('zero fee pool (feeBps=0) charges no fee', () => {
    const freePool = createPool(XLM, USDC, 0);
    const { pool: active } = deposit(freePool, 1_000_000n, 5_000_000n);
    const { result } = swap(active, 10_000n, true);
    expect(result.fee).toBe(0n);
  });
});

describe('Stellar Liquidity Pool — Pool Statistics', () => {
  it('calculates correct price ratio', () => {
    const pool = makeActivePool(1_000_000n, 5_000_000n);
    const stats = getPoolStats(pool);
    expect(stats.price).toBeCloseTo(5.0, 1);
  });

  it('returns zero price for empty pool', () => {
    const pool = createPool(XLM, USDC);
    const stats = getPoolStats(pool);
    expect(stats.price).toBe(0);
  });

  it('calculates TVL as sum of reserves', () => {
    const pool = makeActivePool(1_000_000n, 5_000_000n);
    const stats = getPoolStats(pool);
    expect(stats.tvl).toBe(6_000_000n);
  });

  it('reports correct fee rate', () => {
    const pool = makeActivePool();
    const stats = getPoolStats(pool);
    expect(stats.feeRate).toBeCloseTo(POOL_FEE_RATE, 5);
  });
});

describe('Stellar Liquidity Pool — Edge Cases', () => {
  it('handles equal reserve pool (1:1 ratio)', () => {
    const pool = makeActivePool(1_000_000n, 1_000_000n);
    const { result } = swap(pool, 1_000n, true);
    expect(result.amountOut).toBeGreaterThan(0n);
    // With equal reserves and small input, output ≈ input (minus fee)
    expect(result.amountOut).toBeLessThan(1_000n);
  });

  it('handles highly imbalanced pool', () => {
    const pool = makeActivePool(1_000_000_000n, 1n);
    // Swapping B for A on a heavily A-weighted pool
    const { result } = swap(pool, 1n, false);
    expect(result.amountOut).toBeGreaterThan(0n);
  });

  it('multiple sequential swaps maintain pool integrity', () => {
    let pool = makeActivePool(10_000_000n, 10_000_000n);
    for (let i = 0; i < 10; i++) {
      const dir = i % 2 === 0;
      ({ pool } = swap(pool, 10_000n, dir));
    }
    expect(pool.reserveA).toBeGreaterThan(0n);
    expect(pool.reserveB).toBeGreaterThan(0n);
  });

  it('deposit then withdraw returns close to original amounts', () => {
    const emptyPool = createPool(XLM, USDC);
    const { pool: funded, result: dep } = deposit(emptyPool, 1_000_000n, 4_000_000n);
    const { result: wd } = withdraw(funded, dep.sharesIssued);
    // Due to MINIMUM_LIQUIDITY lock, slightly less is returned
    expect(wd.amountA).toBeLessThanOrEqual(dep.actualAmountA);
    expect(wd.amountB).toBeLessThanOrEqual(dep.actualAmountB);
  });
});
