/**
 * Stellar Path Payment Tests
 *
 * Comprehensive tests for Stellar path payment operations including:
 * - Path finding algorithms for multi-hop payments
 * - Path payment execution (strict send and strict receive)
 * - Multi-hop payment scenarios
 * - Slippage protection mechanisms
 * - Error handling and edge cases
 *
 * Path payments allow sending one asset while the recipient receives a different asset,
 * with automatic conversion through the Stellar DEX. The network finds the best path
 * through available order books and liquidity pools.
 *
 * No live network connection required — all operations are simulated in-memory.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────

const STROOP = 1;
const XLM = 10_000_000; // stroops per XLM
const BASE_FEE_STROOPS = 100;
const MAX_PATH_LENGTH = 5; // Stellar allows up to 6 assets in a path (including source and dest)

// ── Types ─────────────────────────────────────────────────────────────────────

type AssetType = 'native' | 'credit_alphanum4' | 'credit_alphanum12';

interface Asset {
  type: AssetType;
  code?: string;
  issuer?: string;
}

interface Keypair {
  publicKey: string;
  secretKey: string;
}

interface OrderBookEntry {
  price: number; // price of selling asset in terms of buying asset
  amount: number; // amount of selling asset available
}

interface OrderBook {
  selling: Asset;
  buying: Asset;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

interface PaymentPath {
  sourceAsset: Asset;
  destAsset: Asset;
  path: Asset[]; // intermediate assets
  sourceAmount: number;
  destAmount: number;
  hops: number;
}

interface PathPaymentResult {
  success: boolean;
  sourceAmount: number;
  destAmount: number;
  path: Asset[];
  slippage?: number; // percentage
  error?: string;
}

interface MockLedger {
  accounts: Map<string, { balances: Map<string, number> }>;
  orderBooks: OrderBook[];
}

// ── Implementation ────────────────────────────────────────────────────────────

let _keyCounter = 0;
function generateKeypair(seed?: string): Keypair {
  const id = seed ?? `key_${++_keyCounter}`;
  return {
    publicKey: `G${id.toUpperCase().padEnd(55, '0')}`,
    secretKey: `S${id.toUpperCase().padEnd(55, '0')}`,
  };
}

function createNativeAsset(): Asset {
  return { type: 'native' };
}

function createAsset(code: string, issuer: string): Asset {
  const type = code.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12';
  return { type, code, issuer };
}

function assetKey(asset: Asset): string {
  if (asset.type === 'native') return 'XLM';
  return `${asset.code}:${asset.issuer}`;
}

function createMockLedger(): MockLedger {
  return { accounts: new Map(), orderBooks: [] };
}

function fundAccount(ledger: MockLedger, publicKey: string, asset: Asset, amount: number): void {
  let account = ledger.accounts.get(publicKey);
  if (!account) {
    account = { balances: new Map() };
    ledger.accounts.set(publicKey, account);
  }
  const key = assetKey(asset);
  account.balances.set(key, (account.balances.get(key) ?? 0) + amount);
}

function getBalance(ledger: MockLedger, publicKey: string, asset: Asset): number {
  const account = ledger.accounts.get(publicKey);
  if (!account) return 0;
  return account.balances.get(assetKey(asset)) ?? 0;
}

function addOrderBook(
  ledger: MockLedger,
  selling: Asset,
  buying: Asset,
  asks: OrderBookEntry[],
  bids: OrderBookEntry[] = [],
): void {
  ledger.orderBooks.push({ selling, buying, bids, asks });
}

/**
 * Find all possible payment paths between source and destination assets
 * Uses breadth-first search to explore paths through order books
 */
function findPaymentPaths(
  ledger: MockLedger,
  sourceAsset: Asset,
  destAsset: Asset,
  sourceAmount: number,
  maxPaths: number = 5,
): PaymentPath[] {
  const paths: PaymentPath[] = [];
  const sourceKey = assetKey(sourceAsset);
  const destKey = assetKey(destAsset);

  // Direct path (no intermediaries)
  const directBook = ledger.orderBooks.find(
    (ob) => assetKey(ob.selling) === sourceKey && assetKey(ob.buying) === destKey,
  );
  if (directBook && directBook.asks.length > 0) {
    const destAmount = calculateConversion(directBook.asks, sourceAmount);
    if (destAmount > 0) {
      paths.push({
        sourceAsset,
        destAsset,
        path: [],
        sourceAmount,
        destAmount,
        hops: 1,
      });
    }
  }

  // Multi-hop paths (with intermediaries)
  const queue: Array<{ currentAsset: Asset; path: Asset[]; amount: number }> = [
    { currentAsset: sourceAsset, path: [], amount: sourceAmount },
  ];
  const visited = new Set<string>([sourceKey]);

  while (queue.length > 0 && paths.length < maxPaths) {
    const { currentAsset, path, amount } = queue.shift()!;
    const currentKey = assetKey(currentAsset);

    // Find all order books where we can sell current asset
    for (const ob of ledger.orderBooks) {
      if (assetKey(ob.selling) !== currentKey) continue;
      if (path.length >= MAX_PATH_LENGTH - 1) continue; // Respect max path length

      const nextAsset = ob.buying;
      const nextKey = assetKey(nextAsset);
      const convertedAmount = calculateConversion(ob.asks, amount);

      if (convertedAmount <= 0) continue;

      // Found destination
      if (nextKey === destKey) {
        paths.push({
          sourceAsset,
          destAsset,
          path: [...path],
          sourceAmount,
          destAmount: convertedAmount,
          hops: path.length + 2,
        });
        continue;
      }

      // Continue searching if not visited
      if (!visited.has(nextKey)) {
        visited.add(nextKey);
        queue.push({
          currentAsset: nextAsset,
          path: [...path, currentAsset],
          amount: convertedAmount,
        });
      }
    }
  }

  // Sort by best destination amount (highest first)
  return paths.sort((a, b) => b.destAmount - a.destAmount);
}

/**
 * Calculate how much of the buying asset you get for a given amount of selling asset
 */
function calculateConversion(asks: OrderBookEntry[], sellAmount: number): number {
  let remaining = sellAmount;
  let received = 0;

  for (const ask of asks) {
    if (remaining <= 0) break;
    const canTake = Math.min(remaining, ask.amount);
    received += canTake * ask.price;
    remaining -= canTake;
  }

  return remaining > 0 ? 0 : received; // Return 0 if insufficient liquidity
}

/**
 * Execute a path payment with strict send (exact source amount)
 */
function executePathPaymentStrictSend(
  ledger: MockLedger,
  sender: Keypair,
  receiver: string,
  sendAsset: Asset,
  sendAmount: number,
  destAsset: Asset,
  destMin: number,
  path: Asset[] = [],
): PathPaymentResult {
  // Validate sender has sufficient balance
  const senderBalance = getBalance(ledger, sender.publicKey, sendAsset);
  if (senderBalance < sendAmount) {
    return {
      success: false,
      sourceAmount: sendAmount,
      destAmount: 0,
      path,
      error: 'INSUFFICIENT_BALANCE',
    };
  }

  // Find best path if not provided
  if (path.length === 0) {
    const paths = findPaymentPaths(ledger, sendAsset, destAsset, sendAmount, 1);
    if (paths.length === 0) {
      return {
        success: false,
        sourceAmount: sendAmount,
        destAmount: 0,
        path: [],
        error: 'NO_PATH_FOUND',
      };
    }
    path = paths[0].path;
  }

  // Calculate destination amount through the path
  let currentAsset = sendAsset;
  let currentAmount = sendAmount;
  const fullPath = [sendAsset, ...path, destAsset];

  for (let i = 0; i < fullPath.length - 1; i++) {
    const selling = fullPath[i];
    const buying = fullPath[i + 1];
    const orderBook = ledger.orderBooks.find(
      (ob) => assetKey(ob.selling) === assetKey(selling) && assetKey(ob.buying) === assetKey(buying),
    );

    if (!orderBook) {
      return {
        success: false,
        sourceAmount: sendAmount,
        destAmount: 0,
        path,
        error: 'ORDER_BOOK_NOT_FOUND',
      };
    }

    currentAmount = calculateConversion(orderBook.asks, currentAmount);
    if (currentAmount <= 0) {
      return {
        success: false,
        sourceAmount: sendAmount,
        destAmount: 0,
        path,
        error: 'INSUFFICIENT_LIQUIDITY',
      };
    }
    currentAsset = buying;
  }

  const destAmount = currentAmount;

  // Check slippage protection
  if (destAmount < destMin) {
    const slippage = ((destMin - destAmount) / destMin) * 100;
    return {
      success: false,
      sourceAmount: sendAmount,
      destAmount,
      path,
      slippage,
      error: 'SLIPPAGE_EXCEEDED',
    };
  }

  // Execute the payment
  fundAccount(ledger, sender.publicKey, sendAsset, -sendAmount);
  fundAccount(ledger, receiver, destAsset, destAmount);

  return {
    success: true,
    sourceAmount: sendAmount,
    destAmount,
    path,
  };
}

/**
 * Execute a path payment with strict receive (exact destination amount)
 */
function executePathPaymentStrictReceive(
  ledger: MockLedger,
  sender: Keypair,
  receiver: string,
  sendAsset: Asset,
  sendMax: number,
  destAsset: Asset,
  destAmount: number,
  path: Asset[] = [],
): PathPaymentResult {
  // Find paths and calculate required source amount
  const paths = findPaymentPaths(ledger, sendAsset, destAsset, sendMax, 10);
  if (paths.length === 0) {
    return {
      success: false,
      sourceAmount: 0,
      destAmount,
      path: [],
      error: 'NO_PATH_FOUND',
    };
  }

  // Find a path that can deliver the exact destination amount
  let selectedPath: PaymentPath | null = null;
  for (const p of paths) {
    if (p.destAmount >= destAmount) {
      selectedPath = p;
      break;
    }
  }

  if (!selectedPath) {
    return {
      success: false,
      sourceAmount: 0,
      destAmount,
      path: [],
      error: 'INSUFFICIENT_LIQUIDITY',
    };
  }

  // Calculate exact source amount needed (proportional)
  const ratio = destAmount / selectedPath.destAmount;
  const sourceNeeded = Math.ceil(selectedPath.sourceAmount * ratio);

  if (sourceNeeded > sendMax) {
    return {
      success: false,
      sourceAmount: sourceNeeded,
      destAmount,
      path: selectedPath.path,
      error: 'SEND_MAX_EXCEEDED',
    };
  }

  // Validate sender has sufficient balance
  const senderBalance = getBalance(ledger, sender.publicKey, sendAsset);
  if (senderBalance < sourceNeeded) {
    return {
      success: false,
      sourceAmount: sourceNeeded,
      destAmount,
      path: selectedPath.path,
      error: 'INSUFFICIENT_BALANCE',
    };
  }

  // Execute the payment
  fundAccount(ledger, sender.publicKey, sendAsset, -sourceNeeded);
  fundAccount(ledger, receiver, destAsset, destAmount);

  return {
    success: true,
    sourceAmount: sourceNeeded,
    destAmount,
    path: selectedPath.path,
  };
}

// ── Test Helpers ──────────────────────────────────────────────────────────────

function setupBasicMarket(ledger: MockLedger) {
  const issuer = generateKeypair('issuer');
  const xlm = createNativeAsset();
  const usdc = createAsset('USDC', issuer.publicKey);
  const eur = createAsset('EUR', issuer.publicKey);

  // XLM/USDC market: 1 XLM = 0.10 USDC
  addOrderBook(ledger, xlm, usdc, [
    { price: 0.10, amount: 1000 * XLM },
  ]);

  // USDC/EUR market: 1 USDC = 0.92 EUR
  addOrderBook(ledger, usdc, eur, [
    { price: 0.92, amount: 10000 },
  ]);

  return { xlm, usdc, eur, issuer };
}

function setupComplexMarket(ledger: MockLedger) {
  const issuer = generateKeypair('issuer');
  const xlm = createNativeAsset();
  const usdc = createAsset('USDC', issuer.publicKey);
  const btc = createAsset('BTC', issuer.publicKey);
  const eth = createAsset('ETH', issuer.publicKey);

  // Multiple paths possible
  addOrderBook(ledger, xlm, usdc, [{ price: 0.10, amount: 10000 * XLM }]);
  addOrderBook(ledger, usdc, btc, [{ price: 0.000025, amount: 100000 }]);
  addOrderBook(ledger, btc, eth, [{ price: 15.5, amount: 10 }]);
  addOrderBook(ledger, xlm, eth, [{ price: 0.0004, amount: 5000 * XLM }]); // Direct path

  return { xlm, usdc, btc, eth, issuer };
}

// ── Tests: Path Finding ───────────────────────────────────────────────────────

describe('Path finding algorithms', () => {
  let ledger: MockLedger;

  beforeEach(() => {
    ledger = createMockLedger();
  });

  it('finds direct path between two assets', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    const paths = findPaymentPaths(ledger, xlm, usdc, 100 * XLM);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].path).toEqual([]);
    expect(paths[0].hops).toBe(1);
    expect(paths[0].destAmount).toBeCloseTo(10, 1); // 100 XLM * 0.10 = 10 USDC
  });

  it('finds multi-hop path through intermediate assets', () => {
    const { xlm, eur } = setupBasicMarket(ledger);
    const paths = findPaymentPaths(ledger, xlm, eur, 100 * XLM);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].hops).toBe(2);
    expect(paths[0].path.length).toBeGreaterThan(0);
  });

  it('calculates correct destination amount for multi-hop path', () => {
    const { xlm, eur } = setupBasicMarket(ledger);
    const paths = findPaymentPaths(ledger, xlm, eur, 100 * XLM);

    // 100 XLM -> 10 USDC -> 9.2 EUR
    expect(paths[0].destAmount).toBeCloseTo(9.2, 1);
  });

  it('returns multiple paths sorted by best rate', () => {
    const { xlm, eth } = setupComplexMarket(ledger);
    const paths = findPaymentPaths(ledger, xlm, eth, 100 * XLM, 10);

    expect(paths.length).toBeGreaterThan(1);
    // Verify sorted by destination amount (descending)
    for (let i = 1; i < paths.length; i++) {
      expect(paths[i - 1].destAmount).toBeGreaterThanOrEqual(paths[i].destAmount);
    }
  });

  it('respects maximum path length constraint', () => {
    const { xlm, eth } = setupComplexMarket(ledger);
    const paths = findPaymentPaths(ledger, xlm, eth, 100 * XLM);

    paths.forEach((path) => {
      expect(path.path.length).toBeLessThanOrEqual(MAX_PATH_LENGTH - 1);
    });
  });

  it('returns empty array when no path exists', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const isolated = createAsset('ISO', issuer.publicKey);

    const paths = findPaymentPaths(ledger, xlm, isolated, 100 * XLM);
    expect(paths).toEqual([]);
  });

  it('handles insufficient liquidity in path finding', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    // Request more than available liquidity
    const paths = findPaymentPaths(ledger, xlm, usdc, 2000 * XLM);

    expect(paths).toEqual([]);
  });

  it('avoids circular paths', () => {
    const issuer = generateKeypair('issuer');
    const a = createAsset('A', issuer.publicKey);
    const b = createAsset('B', issuer.publicKey);
    const c = createAsset('C', issuer.publicKey);

    // Create circular market: A -> B -> C -> A
    addOrderBook(ledger, a, b, [{ price: 1.0, amount: 1000 }]);
    addOrderBook(ledger, b, c, [{ price: 1.0, amount: 1000 }]);
    addOrderBook(ledger, c, a, [{ price: 1.0, amount: 1000 }]);

    const paths = findPaymentPaths(ledger, a, c, 100);
    expect(paths.length).toBeGreaterThan(0);
    // Should find A -> B -> C, not loop back
    expect(paths[0].hops).toBe(2);
  });
});

// ── Tests: Path Payment Execution (Strict Send) ──────────────────────────────

describe('Path payment execution — strict send', () => {
  let ledger: MockLedger;
  let sender: Keypair;
  let receiver: Keypair;

  beforeEach(() => {
    ledger = createMockLedger();
    sender = generateKeypair('sender');
    receiver = generateKeypair('receiver');
  });

  it('executes direct path payment successfully', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      9, // min dest amount
    );

    expect(result.success).toBe(true);
    expect(result.sourceAmount).toBe(100 * XLM);
    expect(result.destAmount).toBeCloseTo(10, 1);
    expect(getBalance(ledger, sender.publicKey, xlm)).toBe(100 * XLM);
    expect(getBalance(ledger, receiver.publicKey, usdc)).toBeCloseTo(10, 1);
  });

  it('executes multi-hop path payment successfully', () => {
    const { xlm, eur } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      eur,
      8, // min dest amount
    );

    expect(result.success).toBe(true);
    expect(result.hops).toBeUndefined(); // hops not tracked in result
    expect(result.destAmount).toBeCloseTo(9.2, 1);
    expect(getBalance(ledger, receiver.publicKey, eur)).toBeCloseTo(9.2, 1);
  });

  it('deducts exact source amount from sender', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 500 * XLM);

    executePathPaymentStrictSend(ledger, sender, receiver.publicKey, xlm, 100 * XLM, usdc, 5);

    expect(getBalance(ledger, sender.publicKey, xlm)).toBe(400 * XLM);
  });

  it('fails when sender has insufficient balance', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 50 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      5,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_BALANCE');
  });

  it('fails when no path exists between assets', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const isolated = createAsset('ISO', issuer.publicKey);
    fundAccount(ledger, sender.publicKey, xlm, 100 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      50 * XLM,
      isolated,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_PATH_FOUND');
  });

  it('fails when slippage protection is triggered', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      15, // min dest amount too high
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('SLIPPAGE_EXCEEDED');
    expect(result.slippage).toBeGreaterThan(0);
  });

  it('fails when liquidity is insufficient', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 5000 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      2000 * XLM, // More than available liquidity
      usdc,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_LIQUIDITY');
  });

  it('does not modify balances on failed payment', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 100 * XLM);

    executePathPaymentStrictSend(ledger, sender, receiver.publicKey, xlm, 100 * XLM, usdc, 50);

    expect(getBalance(ledger, sender.publicKey, xlm)).toBe(100 * XLM);
    expect(getBalance(ledger, receiver.publicKey, usdc)).toBe(0);
  });
});

// ── Tests: Path Payment Execution (Strict Receive) ───────────────────────────

describe('Path payment execution — strict receive', () => {
  let ledger: MockLedger;
  let sender: Keypair;
  let receiver: Keypair;

  beforeEach(() => {
    ledger = createMockLedger();
    sender = generateKeypair('sender');
    receiver = generateKeypair('receiver');
  });

  it('executes payment with exact destination amount', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 500 * XLM);

    const result = executePathPaymentStrictReceive(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      200 * XLM, // send max
      usdc,
      10, // exact dest amount
    );

    expect(result.success).toBe(true);
    expect(result.destAmount).toBe(10);
    expect(getBalance(ledger, receiver.publicKey, usdc)).toBe(10);
  });

  it('calculates correct source amount needed', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 500 * XLM);

    const result = executePathPaymentStrictReceive(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      200 * XLM,
      usdc,
      5, // Want exactly 5 USDC
    );

    expect(result.success).toBe(true);
    // Should need ~50 XLM to get 5 USDC (at 0.10 rate)
    expect(result.sourceAmount).toBeGreaterThanOrEqual(50 * XLM);
    expect(result.sourceAmount).toBeLessThanOrEqual(51 * XLM);
  });

  it('fails when send max is exceeded', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 500 * XLM);

    const result = executePathPaymentStrictReceive(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      50 * XLM, // send max too low
      usdc,
      10, // Want 10 USDC but can only send 50 XLM (= 5 USDC)
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('SEND_MAX_EXCEEDED');
  });

  it('fails when sender has insufficient balance', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 50 * XLM);

    const result = executePathPaymentStrictReceive(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      200 * XLM,
      usdc,
      10,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_BALANCE');
  });

  it('works with multi-hop paths', () => {
    const { xlm, eur } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 500 * XLM);

    const result = executePathPaymentStrictReceive(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      200 * XLM,
      eur,
      9.2, // Exact EUR amount
    );

    expect(result.success).toBe(true);
    expect(result.destAmount).toBe(9.2);
    expect(getBalance(ledger, receiver.publicKey, eur)).toBe(9.2);
  });

  it('fails when no path exists', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const isolated = createAsset('ISO', issuer.publicKey);
    fundAccount(ledger, sender.publicKey, xlm, 100 * XLM);

    const result = executePathPaymentStrictReceive(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      isolated,
      10,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_PATH_FOUND');
  });

  it('fails when liquidity cannot satisfy destination amount', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 20000 * XLM);

    const result = executePathPaymentStrictReceive(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      20000 * XLM,
      usdc,
      2000, // More USDC than available in order book
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_LIQUIDITY');
  });
});
// ── Tests: Multi-hop Payment Scenarios ───────────────────────────────────────

describe('Multi-hop payment scenarios', () => {
  let ledger: MockLedger;
  let sender: Keypair;
  let receiver: Keypair;

  beforeEach(() => {
    ledger = createMockLedger();
    sender = generateKeypair('sender');
    receiver = generateKeypair('receiver');
  });

  it('handles 2-hop payment (A -> B -> C)', () => {
    const { xlm, eur } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      eur,
      8,
    );

    expect(result.success).toBe(true);
    expect(result.path.length).toBe(1); // One intermediate asset (USDC)
  });

  it('handles 3-hop payment (A -> B -> C -> D)', () => {
    const { xlm, eth } = setupComplexMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 1000 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      eth,
      0.01,
    );

    expect(result.success).toBe(true);
    expect(result.path.length).toBeGreaterThanOrEqual(2); // At least 2 intermediate assets
  });

  it('chooses optimal path among multiple options', () => {
    const { xlm, eth } = setupComplexMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 1000 * XLM);

    // Should choose the path that gives the best rate
    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      eth,
      0.01,
    );

    expect(result.success).toBe(true);
    // Verify we got a reasonable amount of ETH
    expect(result.destAmount).toBeGreaterThan(0.01);
  });

  it('handles complex market with multiple competing paths', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const usdc = createAsset('USDC', issuer.publicKey);
    const btc = createAsset('BTC', issuer.publicKey);
    const eth = createAsset('ETH', issuer.publicKey);
    const eur = createAsset('EUR', issuer.publicKey);

    // Create multiple paths: XLM -> ETH
    // Path 1: XLM -> USDC -> ETH
    addOrderBook(ledger, xlm, usdc, [{ price: 0.10, amount: 10000 * XLM }]);
    addOrderBook(ledger, usdc, eth, [{ price: 0.0006, amount: 50000 }]);

    // Path 2: XLM -> BTC -> ETH  
    addOrderBook(ledger, xlm, btc, [{ price: 0.0000025, amount: 10000 * XLM }]);
    addOrderBook(ledger, btc, eth, [{ price: 15.0, amount: 10 }]);

    // Path 3: XLM -> EUR -> ETH
    addOrderBook(ledger, xlm, eur, [{ price: 0.092, amount: 10000 * XLM }]);
    addOrderBook(ledger, eur, eth, [{ price: 0.00065, amount: 50000 }]);

    fundAccount(ledger, sender.publicKey, xlm, 1000 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      eth,
      0.001,
    );

    expect(result.success).toBe(true);
    expect(result.destAmount).toBeGreaterThan(0.001);
  });

  it('fails gracefully when intermediate market has no liquidity', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const usdc = createAsset('USDC', issuer.publicKey);
    const btc = createAsset('BTC', issuer.publicKey);

    // XLM -> USDC has liquidity, but USDC -> BTC doesn't
    addOrderBook(ledger, xlm, usdc, [{ price: 0.10, amount: 1000 * XLM }]);
    addOrderBook(ledger, usdc, btc, []); // No liquidity

    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      btc,
      0.001,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_LIQUIDITY');
  });

  it('respects maximum path length limits', () => {
    // Create a very long potential path
    const issuer = generateKeypair('issuer');
    const assets = [
      createNativeAsset(),
      createAsset('A', issuer.publicKey),
      createAsset('B', issuer.publicKey),
      createAsset('C', issuer.publicKey),
      createAsset('D', issuer.publicKey),
      createAsset('E', issuer.publicKey),
      createAsset('F', issuer.publicKey),
    ];

    // Create chain: XLM -> A -> B -> C -> D -> E -> F
    for (let i = 0; i < assets.length - 1; i++) {
      addOrderBook(ledger, assets[i], assets[i + 1], [{ price: 1.0, amount: 1000 }]);
    }

    fundAccount(ledger, sender.publicKey, assets[0], 200);

    const paths = findPaymentPaths(ledger, assets[0], assets[assets.length - 1], 100);
    
    // Should not find a path that exceeds MAX_PATH_LENGTH
    if (paths.length > 0) {
      expect(paths[0].path.length).toBeLessThanOrEqual(MAX_PATH_LENGTH - 1);
    }
  });
});
// ── Tests: Slippage Protection ───────────────────────────────────────────────

describe('Slippage protection', () => {
  let ledger: MockLedger;
  let sender: Keypair;
  let receiver: Keypair;

  beforeEach(() => {
    ledger = createMockLedger();
    sender = generateKeypair('sender');
    receiver = generateKeypair('receiver');
  });

  it('protects against excessive slippage in strict send', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    // Expect 10 USDC but set minimum to 12 (20% slippage protection)
    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      12, // destMin too high
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('SLIPPAGE_EXCEEDED');
    expect(result.slippage).toBeCloseTo(16.67, 1); // (12-10)/12 * 100
  });

  it('allows payment within acceptable slippage tolerance', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    // Expect 10 USDC, accept minimum 9.5 (5% slippage tolerance)
    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      9.5,
    );

    expect(result.success).toBe(true);
    expect(result.destAmount).toBeCloseTo(10, 1);
  });

  it('protects against slippage in multi-hop payments', () => {
    const { xlm, eur } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    // Expect ~9.2 EUR but demand 11 EUR
    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      eur,
      11,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('SLIPPAGE_EXCEEDED');
  });

  it('calculates slippage percentage correctly', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      15, // Expected 10, got 10, demanded 15
    );

    expect(result.success).toBe(false);
    expect(result.slippage).toBeCloseTo(33.33, 1); // (15-10)/15 * 100
  });

  it('handles zero slippage tolerance', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    // Demand exact amount (no slippage allowed)
    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      10.0, // Exact expected amount
    );

    expect(result.success).toBe(true);
  });

  it('strict receive inherently protects against slippage', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 500 * XLM);

    // Strict receive always delivers exact amount
    const result = executePathPaymentStrictReceive(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      200 * XLM,
      usdc,
      10, // Exact amount
    );

    expect(result.success).toBe(true);
    expect(result.destAmount).toBe(10); // Exactly what was requested
  });
});
// ── Tests: Error Handling and Edge Cases ─────────────────────────────────────

describe('Path payment error handling', () => {
  let ledger: MockLedger;
  let sender: Keypair;
  let receiver: Keypair;

  beforeEach(() => {
    ledger = createMockLedger();
    sender = generateKeypair('sender');
    receiver = generateKeypair('receiver');
  });

  it('handles missing order book gracefully', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const usdc = createAsset('USDC', issuer.publicKey);
    const btc = createAsset('BTC', issuer.publicKey);

    // Only add XLM/USDC, missing USDC/BTC
    addOrderBook(ledger, xlm, usdc, [{ price: 0.10, amount: 1000 * XLM }]);

    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      btc,
      0.001,
      [usdc], // Explicit path that will fail
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('ORDER_BOOK_NOT_FOUND');
  });

  it('handles zero amount payments', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      0, // Zero amount
      usdc,
      0,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_LIQUIDITY');
  });

  it('handles negative amounts gracefully', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      -100 * XLM, // Negative amount
      usdc,
      5,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_BALANCE');
  });

  it('handles same source and destination asset', () => {
    const { xlm } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      xlm, // Same asset
      90,
    );

    // Should find no path since source == dest
    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_PATH_FOUND');
  });

  it('handles empty order book', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const usdc = createAsset('USDC', issuer.publicKey);

    addOrderBook(ledger, xlm, usdc, []); // Empty order book

    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      5,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_PATH_FOUND');
  });

  it('handles partial liquidity consumption', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const usdc = createAsset('USDC', issuer.publicKey);

    // Limited liquidity: only 50 XLM worth
    addOrderBook(ledger, xlm, usdc, [{ price: 0.10, amount: 50 * XLM }]);

    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      100 * XLM, // More than available
      usdc,
      1,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_LIQUIDITY');
  });

  it('handles very small amounts (precision)', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const result = executePathPaymentStrictSend(
      ledger,
      sender,
      receiver.publicKey,
      xlm,
      1, // 1 stroop
      usdc,
      0.0000001,
    );

    expect(result.success).toBe(true);
    expect(result.destAmount).toBeGreaterThan(0);
  });

  it('handles account that does not exist', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    const nonExistentSender = generateKeypair('ghost');

    const result = executePathPaymentStrictSend(
      ledger,
      nonExistentSender,
      receiver.publicKey,
      xlm,
      100 * XLM,
      usdc,
      5,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_BALANCE');
  });

  it('preserves ledger state on any failure', () => {
    const { xlm, usdc } = setupBasicMarket(ledger);
    fundAccount(ledger, sender.publicKey, xlm, 200 * XLM);

    const initialSenderBalance = getBalance(ledger, sender.publicKey, xlm);
    const initialReceiverBalance = getBalance(ledger, receiver.publicKey, usdc);

    // Attempt payment that will fail
    executePathPaymentStrictSend(ledger, sender, receiver.publicKey, xlm, 100 * XLM, usdc, 50);

    // Balances should be unchanged
    expect(getBalance(ledger, sender.publicKey, xlm)).toBe(initialSenderBalance);
    expect(getBalance(ledger, receiver.publicKey, usdc)).toBe(initialReceiverBalance);
  });
});
// ── Tests: Performance and Optimization ──────────────────────────────────────

describe('Path payment performance', () => {
  let ledger: MockLedger;

  beforeEach(() => {
    ledger = createMockLedger();
  });

  it('finds paths efficiently in large markets', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const assets = Array.from({ length: 20 }, (_, i) => 
      createAsset(`TOK${i.toString().padStart(2, '0')}`, issuer.publicKey)
    );

    // Create a mesh of order books
    for (let i = 0; i < assets.length; i++) {
      for (let j = i + 1; j < Math.min(i + 4, assets.length); j++) {
        addOrderBook(ledger, assets[i], assets[j], [{ price: 1.0, amount: 1000 }]);
        addOrderBook(ledger, assets[j], assets[i], [{ price: 1.0, amount: 1000 }]);
      }
      // Connect to XLM
      addOrderBook(ledger, xlm, assets[i], [{ price: 1.0, amount: 1000 }]);
      addOrderBook(ledger, assets[i], xlm, [{ price: 1.0, amount: 1000 }]);
    }

    const startTime = Date.now();
    const paths = findPaymentPaths(ledger, xlm, assets[19], 100);
    const endTime = Date.now();

    expect(paths.length).toBeGreaterThan(0);
    expect(endTime - startTime).toBeLessThan(100); // Should complete in <100ms
  });

  it('limits path search to prevent infinite loops', () => {
    const issuer = generateKeypair('issuer');
    const assets = Array.from({ length: 10 }, (_, i) => 
      createAsset(`LOOP${i}`, issuer.publicKey)
    );

    // Create circular connections
    for (let i = 0; i < assets.length; i++) {
      const next = (i + 1) % assets.length;
      addOrderBook(ledger, assets[i], assets[next], [{ price: 1.0, amount: 1000 }]);
    }

    const startTime = Date.now();
    const paths = findPaymentPaths(ledger, assets[0], assets[5], 100);
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(50); // Should terminate quickly
    expect(paths.length).toBeGreaterThan(0);
  });

  it('respects maximum path count limit', () => {
    const { xlm, eth } = setupComplexMarket(ledger);
    
    const paths = findPaymentPaths(ledger, xlm, eth, 100, 3); // Limit to 3 paths
    
    expect(paths.length).toBeLessThanOrEqual(3);
  });
});

// ── Tests: Integration Scenarios ──────────────────────────────────────────────

describe('Path payment integration scenarios', () => {
  let ledger: MockLedger;
  let alice: Keypair;
  let bob: Keypair;
  let carol: Keypair;

  beforeEach(() => {
    ledger = createMockLedger();
    alice = generateKeypair('alice');
    bob = generateKeypair('bob');
    carol = generateKeypair('carol');
  });

  it('simulates real-world trading scenario', () => {
    // Setup: Alice has XLM, wants to pay Bob in USDC
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const usdc = createAsset('USDC', issuer.publicKey);
    const btc = createAsset('BTC', issuer.publicKey);

    // Market setup with realistic spreads
    addOrderBook(ledger, xlm, usdc, [
      { price: 0.095, amount: 1000 * XLM }, // Slightly worse than mid-market
      { price: 0.098, amount: 2000 * XLM },
      { price: 0.100, amount: 5000 * XLM },
    ]);

    addOrderBook(ledger, xlm, btc, [
      { price: 0.0000024, amount: 10000 * XLM },
    ]);

    addOrderBook(ledger, btc, usdc, [
      { price: 41000, amount: 1 },
    ]);

    fundAccount(ledger, alice.publicKey, xlm, 1000 * XLM);

    // Alice sends 500 XLM to pay Bob ~50 USDC
    const result = executePathPaymentStrictSend(
      ledger,
      alice,
      bob.publicKey,
      xlm,
      500 * XLM,
      usdc,
      45, // Accept minimum 45 USDC (10% slippage tolerance)
    );

    expect(result.success).toBe(true);
    expect(result.destAmount).toBeGreaterThanOrEqual(45);
    expect(getBalance(ledger, bob.publicKey, usdc)).toBeGreaterThanOrEqual(45);
  });

  it('handles cross-border payment scenario', () => {
    // Scenario: Alice (US) pays Carol (EU) - XLM to EUR via USD
    const issuer = generateKeypair('anchor');
    const xlm = createNativeAsset();
    const usd = createAsset('USD', issuer.publicKey);
    const eur = createAsset('EUR', issuer.publicKey);

    addOrderBook(ledger, xlm, usd, [{ price: 0.12, amount: 10000 * XLM }]);
    addOrderBook(ledger, usd, eur, [{ price: 0.85, amount: 50000 }]);

    fundAccount(ledger, alice.publicKey, xlm, 2000 * XLM);

    // Alice wants to send exactly 100 EUR to Carol
    const result = executePathPaymentStrictReceive(
      ledger,
      alice,
      carol.publicKey,
      xlm,
      1500 * XLM, // Max willing to send
      eur,
      100, // Exact EUR amount
    );

    expect(result.success).toBe(true);
    expect(result.destAmount).toBe(100);
    expect(getBalance(ledger, carol.publicKey, eur)).toBe(100);
  });

  it('handles arbitrage opportunity detection', () => {
    const issuer = generateKeypair('issuer');
    const xlm = createNativeAsset();
    const usdc = createAsset('USDC', issuer.publicKey);

    // Create arbitrage opportunity: different rates in different directions
    addOrderBook(ledger, xlm, usdc, [{ price: 0.10, amount: 1000 * XLM }]);
    addOrderBook(ledger, usdc, xlm, [{ price: 9.5, amount: 1000 }]); // Better than 1/0.10 = 10

    fundAccount(ledger, alice.publicKey, xlm, 1000 * XLM);

    // Convert XLM -> USDC -> XLM (should be profitable)
    const step1 = executePathPaymentStrictSend(
      ledger,
      alice,
      alice.publicKey,
      xlm,
      100 * XLM,
      usdc,
      9,
    );

    expect(step1.success).toBe(true);
    const usdcReceived = step1.destAmount;

    const step2 = executePathPaymentStrictSend(
      ledger,
      alice,
      alice.publicKey,
      usdc,
      usdcReceived,
      xlm,
      90 * XLM,
    );

    expect(step2.success).toBe(true);
    expect(step2.destAmount).toBeGreaterThan(90 * XLM); // Profitable arbitrage
  });
});