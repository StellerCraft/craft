/**
 * Tests for DEX price feed VWAP calculation and outlier detection (#791)
 */
import { describe, it, expect, vi } from 'vitest';
import {
    detectOutliers,
    computeEnrichedDexPrice,
    subscribeLedgerPriceFeed,
    verifyOrderBookConsistency,
} from './dex-price-feed';
import type { OrderBookSnapshot, OrderBookLevel, LedgerEventEmitter, OrderBookFetcher, SnapshotWithMeta } from './dex-price-feed';

// ── Helpers ──────────────────────────────────────────────────────────────────

function level(price: string, amount = '100'): OrderBookLevel {
    const [n, d] = price.split('.').length > 1
        ? [parseFloat(price) * 10000000, 10000000]
        : [parseInt(price), 1];
    return { price, amount, price_r: { n, d } };
}

function book(bids: OrderBookLevel[], asks: OrderBookLevel[]): OrderBookSnapshot {
    return { bids, asks };
}

// ── detectOutliers ────────────────────────────────────────────────────────────

describe('detectOutliers', () => {
    it('returns empty array for fewer than 2 levels', () => {
        expect(detectOutliers([])).toEqual([]);
        expect(detectOutliers([level('1.0')])).toEqual([]);
    });

    it('returns empty array when all prices are equal', () => {
        const levels = [level('1.0'), level('1.0'), level('1.0')];
        expect(detectOutliers(levels)).toEqual([]);
    });

    it('flags a price more than 3 standard deviations from the mean', () => {
        // 20-price cluster of 1.0 with one extreme outlier at 10.0
        const levels = Array<OrderBookLevel>(20).fill(level('1.0')).concat([level('10.0')]);
        const outliers = detectOutliers(levels);
        expect(outliers).toContain(10.0);
    });

    it('does not flag prices within 3 standard deviations', () => {
        const levels = [level('1.0'), level('1.1'), level('0.9'), level('1.05'), level('0.95')];
        expect(detectOutliers(levels)).toEqual([]);
    });
});

// ── computeEnrichedDexPrice ───────────────────────────────────────────────────

describe('computeEnrichedDexPrice', () => {
    it('includes both raw DexPriceResult fields and analysis', () => {
        const snapshot = book(
            [level('1.0', '200'), level('0.9', '100')],
            [level('1.1', '150'), level('1.2', '50')],
        );
        const result = computeEnrichedDexPrice(snapshot);

        expect(result.bestBid).toBe(1.0);
        expect(result.bestAsk).toBe(1.1);
        expect(result.bidAnalysis).toBeDefined();
        expect(result.askAnalysis).toBeDefined();
    });

    it('computes VWAP on bid side', () => {
        // bids: 200 @ 1.0, 100 @ 0.9  =>  VWAP = (200*1.0 + 100*0.9) / 300 = 0.967
        const snapshot = book(
            [level('1.0', '200'), level('0.9', '100')],
            [],
        );
        const result = computeEnrichedDexPrice(snapshot);
        const expectedVwap = (200 * 1.0 + 100 * 0.9) / 300;
        expect(result.bidAnalysis.vwap).toBeCloseTo(expectedVwap, 6);
    });

    it('computes VWAP on ask side', () => {
        const snapshot = book([], [level('1.1', '100'), level('1.2', '400')]);
        const result = computeEnrichedDexPrice(snapshot);
        const expectedVwap = (100 * 1.1 + 400 * 1.2) / 500;
        expect(result.askAnalysis.vwap).toBeCloseTo(expectedVwap, 6);
    });

    it('sets hasOutlier true when outlier detected', () => {
        // 20 prices at 1.0 + one extreme outlier at 10.0 (>3σ from mean)
        const bids = Array<OrderBookLevel>(20).fill(level('1.0')).concat([level('10.0')]);
        const snapshot = book(bids, []);
        const result = computeEnrichedDexPrice(snapshot);
        expect(result.bidAnalysis.hasOutlier).toBe(true);
        expect(result.bidAnalysis.outliers).toContain(10.0);
    });

    it('sets hasOutlier false when no outlier', () => {
        const snapshot = book(
            [level('1.0'), level('1.05'), level('0.95')],
            [level('1.1'), level('1.15'), level('1.05')],
        );
        const result = computeEnrichedDexPrice(snapshot);
        expect(result.bidAnalysis.hasOutlier).toBe(false);
        expect(result.askAnalysis.hasOutlier).toBe(false);
    });

    it('handles empty order book', () => {
        const result = computeEnrichedDexPrice(book([], []));
        expect(result.empty).toBe(true);
        expect(result.bidAnalysis.vwap).toBeUndefined();
        expect(result.askAnalysis.vwap).toBeUndefined();
    });
});

// ── verifyOrderBookConsistency ─────────────────────────────────────────────────

describe('verifyOrderBookConsistency', () => {
    function snapshot(bids: OrderBookLevel[], asks: OrderBookLevel[], ledgerSeq: number): SnapshotWithMeta {
        return {
            snapshot: { bids, asks },
            ledgerSequence: ledgerSeq,
        };
    }

    it('defaults to primary snapshot when primary has no mid-price (empty book) (#1129)', () => {
        const primarySnapshot = snapshot([], [], 1000);
        const secondarySnapshot = snapshot(
            [level('1.0', '100')],
            [level('1.1', '100')],
            1001,
        );

        const result = verifyOrderBookConsistency(primarySnapshot, secondarySnapshot);

        expect(result.consistent).toBe(true);
        expect(result.divergencePercent).toBeUndefined();
        expect(result.selectedSnapshot).toBe(primarySnapshot.snapshot);
        expect(result.reason).toContain('Cannot compute mid-price');
    });

    it('defaults to primary snapshot when secondary has no mid-price (empty book) (#1129)', () => {
        const primarySnapshot = snapshot(
            [level('1.0', '100')],
            [level('1.1', '100')],
            1000,
        );
        const secondarySnapshot = snapshot([], [], 1001);

        const result = verifyOrderBookConsistency(primarySnapshot, secondarySnapshot);

        expect(result.consistent).toBe(true);
        expect(result.divergencePercent).toBeUndefined();
        expect(result.selectedSnapshot).toBe(primarySnapshot.snapshot);
        expect(result.reason).toContain('Cannot compute mid-price');
    });

    it('reports zero divergence when both endpoints are within tolerance', () => {
        const primarySnapshot = snapshot(
            [level('1.0', '100')],
            [level('1.1', '100')],
            1000,
        );
        const secondarySnapshot = snapshot(
            [level('1.001', '100')],
            [level('1.099', '100')],
            1001,
        );

        const result = verifyOrderBookConsistency(primarySnapshot, secondarySnapshot);

        expect(result.consistent).toBe(true);
        expect(result.divergencePercent).toBeDefined();
        expect(result.divergencePercent!).toBeLessThan(1);
        expect(result.selectedSnapshot).toBe(primarySnapshot.snapshot);
    });
});

// ── subscribeLedgerPriceFeed ──────────────────────────────────────────────────

describe('subscribeLedgerPriceFeed', () => {
    function makeEmitter() {
        const handlers = new Set<(l: { sequence: number }) => void>();
        const emitter: LedgerEventEmitter = {
            on: (_event, handler) => { handlers.add(handler as (l: { sequence: number }) => void); },
            off: (_event, handler) => { handlers.delete(handler as (l: { sequence: number }) => void); },
        };
        const emit = (seq: number) => handlers.forEach(h => h({ sequence: seq }));
        return { emitter, emit, handlers };
    }

    it('calls onUpdate with enriched price after each ledger close', async () => {
        const { emitter, emit } = makeEmitter();
        const snapshot: OrderBookSnapshot = book([level('1.0', '100')], [level('1.1', '100')]);
        const fetcher: OrderBookFetcher = { fetch: vi.fn().mockResolvedValue(snapshot) };
        const onUpdate = vi.fn();

        subscribeLedgerPriceFeed(emitter, fetcher, onUpdate);
        emit(1000);
        await new Promise(r => setTimeout(r, 10));

        expect(fetcher.fetch).toHaveBeenCalledOnce();
        expect(onUpdate).toHaveBeenCalledOnce();
        expect(onUpdate.mock.calls[0][0]).toHaveProperty('bidAnalysis');
    });

    it('returns an unsubscribe function that stops updates', async () => {
        const { emitter, emit } = makeEmitter();
        const snapshot: OrderBookSnapshot = book([], []);
        const fetcher: OrderBookFetcher = { fetch: vi.fn().mockResolvedValue(snapshot) };
        const onUpdate = vi.fn();

        const unsubscribe = subscribeLedgerPriceFeed(emitter, fetcher, onUpdate);
        unsubscribe();
        emit(1001);
        await new Promise(r => setTimeout(r, 10));

        expect(onUpdate).not.toHaveBeenCalled();
    });

    it('survives a fetch error without crashing', async () => {
        const { emitter, emit } = makeEmitter();
        const fetcher: OrderBookFetcher = { fetch: vi.fn().mockRejectedValue(new Error('network')) };
        const onUpdate = vi.fn();

        subscribeLedgerPriceFeed(emitter, fetcher, onUpdate);
        emit(1002);
        await new Promise(r => setTimeout(r, 10));

        expect(onUpdate).not.toHaveBeenCalled();
    });

    it('triggers on every ledger close', async () => {
        const { emitter, emit } = makeEmitter();
        const snapshot: OrderBookSnapshot = book([], []);
        const fetcher: OrderBookFetcher = { fetch: vi.fn().mockResolvedValue(snapshot) };
        const onUpdate = vi.fn();

        subscribeLedgerPriceFeed(emitter, fetcher, onUpdate);
        emit(1000);
        emit(1001);
        emit(1002);
        await new Promise(r => setTimeout(r, 20));

        expect(onUpdate).toHaveBeenCalledTimes(3);
    });

    it('surfaces a sustained fetch failure through onError on every ledger while staying subscribed (#1116)', async () => {
        const { emitter, emit, handlers } = makeEmitter();
        const failure = new Error('expired credentials');
        const fetcher: OrderBookFetcher = { fetch: vi.fn().mockRejectedValue(failure) };
        const onUpdate = vi.fn();
        const onError = vi.fn();

        const unsubscribe = subscribeLedgerPriceFeed(emitter, fetcher, onUpdate, onError);

        emit(2000);
        emit(2001);
        emit(2002);
        await new Promise(r => setTimeout(r, 20));

        // Observability: onError fired once per failed ledger with the error + triggering event.
        expect(onError).toHaveBeenCalledTimes(3);
        expect(onError.mock.calls[0][0]).toBe(failure);
        expect(onError.mock.calls[0][1]).toEqual({ sequence: 2000 });
        expect(onError.mock.calls[2][1]).toEqual({ sequence: 2002 });

        // Resilience unchanged: no price updates, subscription still active.
        expect(onUpdate).not.toHaveBeenCalled();
        expect(handlers.size).toBe(1);

        unsubscribe();
    });

    it('does not require an onError callback (#1116)', async () => {
        const { emitter, emit } = makeEmitter();
        const fetcher: OrderBookFetcher = { fetch: vi.fn().mockRejectedValue(new Error('network')) };
        const onUpdate = vi.fn();

        expect(() => subscribeLedgerPriceFeed(emitter, fetcher, onUpdate)).not.toThrow();
        emit(3000);
        await new Promise(r => setTimeout(r, 10));

        expect(onUpdate).not.toHaveBeenCalled();
    });
});

// ── #1109 – self-masking outlier regression test ─────────────────────────────

describe('detectOutliers – self-masking regression (#1109)', () => {
    it('detects a single extreme outlier that would have masked itself under naive mean/stdDev', () => {
        // Classic self-masking scenario: one extreme value inflates the classical
        // stdDev enough that the outlier's own |price - mean| < 3 * stdDev,
        // causing the naive test to miss it.  The MAD-based test must flag it.
        //
        // Cluster: 6 prices tightly around 1.00 (± 0.05), plus one spike at 50.0
        const clusterPrices = ['1.00', '1.02', '0.98', '1.01', '0.99', '1.03'];
        const levels = clusterPrices.map((p) => level(p)).concat([level('50.0')]);

        const outliers = detectOutliers(levels);

        // The MAD-based test must identify 50.0 as an outlier.
        expect(outliers).toContain(50.0);
    });

    it('does not flag tightly-clustered prices as outliers', () => {
        // All prices within ±5 % of each other — nothing should be flagged.
        const levels = ['1.00', '1.01', '0.99', '1.02', '0.98', '1.005'].map((p) => level(p));

        const outliers = detectOutliers(levels);

        expect(outliers).toHaveLength(0);
    });

    it('computeEnrichedDexPrice sets hasOutlier=true for self-masking outlier scenario', () => {
        const clusterLevels = ['1.00', '1.02', '0.98', '1.01', '0.99', '1.03'].map((p) => level(p));
        const spikedLevels = clusterLevels.concat([level('50.0')]);

        const snapshot: OrderBookSnapshot = { bids: spikedLevels, asks: [] };
        const result = computeEnrichedDexPrice(snapshot);

        expect(result.bidAnalysis.hasOutlier).toBe(true);
        expect(result.bidAnalysis.outliers).toContain(50.0);
    });
});