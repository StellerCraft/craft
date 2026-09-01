/**
 * Stellar DEX Price Feed — Order Book Price Computation (Issue #091)
 *
 * Computes price metrics from Stellar Horizon DEX order book snapshots.
 * All functions are pure and stateless; no network calls are made here.
 *
 * ## Price metrics returned
 * - bestBid / bestAsk: top-of-book prices (highest bid, lowest ask)
 * - midPrice: arithmetic mean of bestBid and bestAsk
 * - spread: absolute difference (bestAsk − bestBid)
 * - spreadPercent: spread as a percentage of midPrice
 *
 * ## Edge-case handling
 * | Condition           | Behaviour                                       |
 * |---------------------|-------------------------------------------------|
 * | Empty order book    | midPrice, spread, spreadPercent all undefined   |
 * | Bids only           | bestAsk, midPrice, spread, spreadPercent undefined |
 * | Asks only           | bestBid, midPrice, spread, spreadPercent undefined |
 * | Crossed book        | midPrice computed, `crossed: true` flag set     |
 */

// ── Input types (mirror Horizon order book API) ───────────────────────────────

export interface OrderBookLevel {
    /** Price as a decimal string, e.g. "0.5000000" */
    price: string;
    /** Volume at this price level as a decimal string */
    amount: string;
    /** Rational representation { n, d } where price = n / d */
    price_r: { n: number; d: number };
}

export interface OrderBookSnapshot {
    /** Bids sorted descending by price (best bid first). */
    bids: OrderBookLevel[];
    /** Asks sorted ascending by price (best ask first). */
    asks: OrderBookLevel[];
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface DexPriceResult {
    /** Highest bid price (undefined when no bids). */
    bestBid: number | undefined;
    /** Lowest ask price (undefined when no asks). */
    bestAsk: number | undefined;
    /**
     * Arithmetic mid-price = (bestBid + bestAsk) / 2.
     * Defined only when both sides are present.
     */
    midPrice: number | undefined;
    /**
     * Absolute spread = bestAsk − bestBid.
     * Defined only when both sides are present.
     */
    spread: number | undefined;
    /**
     * Spread as a percentage of midPrice.
     * Defined only when both sides are present and midPrice > 0.
     */
    spreadPercent: number | undefined;
    /** true when bestBid >= bestAsk (invalid/crossed market). */
    crossed: boolean;
    /** true when both bids and asks arrays are empty. */
    empty: boolean;
}

// ── Price tolerance ───────────────────────────────────────────────────────────

/**
 * Maximum relative deviation allowed when asserting price accuracy in tests.
 * Value of 1e-6 (1 part per million) covers floating-point rounding across
 * the seven decimal places used by Horizon's fixed-point format.
 */
export const PRICE_TOLERANCE = 1e-6;

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Compute price metrics from a Stellar DEX order book snapshot.
 *
 * @param book - An order book snapshot (bids + asks arrays)
 * @returns Computed price metrics; fields that cannot be derived are `undefined`
 *
 * @example
 * ```typescript
 * const book = await server.orderbook(selling, buying).call();
 * const price = computeDexPrice(book);
 * if (!price.empty) {
 *   console.log('Mid price:', price.midPrice);
 * }
 * ```
 */
export function computeDexPrice(book: OrderBookSnapshot): DexPriceResult {
    const bestBid = topPrice(book.bids);
    const bestAsk = topPrice(book.asks);
    const empty = bestBid === undefined && bestAsk === undefined;
    const crossed = bestBid !== undefined && bestAsk !== undefined && bestBid >= bestAsk;

    let midPrice: number | undefined;
    let spread: number | undefined;
    let spreadPercent: number | undefined;

    if (bestBid !== undefined && bestAsk !== undefined) {
        midPrice = (bestBid + bestAsk) / 2;
        spread = bestAsk - bestBid;
        spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : undefined;
    }

    return { bestBid, bestAsk, midPrice, spread, spreadPercent, crossed, empty };
}

/**
 * Compute the volume-weighted average price (VWAP) for one side of the book
 * up to a given depth (in quote asset volume).
 *
 * @param levels - Sorted price levels (bids desc, asks asc)
 * @param maxVolume - Maximum base-asset volume to consume (unbounded when omitted)
 * @returns VWAP across consumed levels, or `undefined` when levels is empty
 */
export function computeVwap(levels: OrderBookLevel[], maxVolume?: number): number | undefined {
    if (levels.length === 0) return undefined;

    let weightedSum = 0;
    let totalVolume = 0;
    const limit = maxVolume ?? Infinity;

    for (const level of levels) {
        const price = parseFloat(level.price);
        const amount = parseFloat(level.amount);
        if (!isFinite(price) || !isFinite(amount) || amount <= 0) continue;

        const consumed = Math.min(amount, limit - totalVolume);
        weightedSum += price * consumed;
        totalVolume += consumed;
        if (totalVolume >= limit) break;
    }

    return totalVolume > 0 ? weightedSum / totalVolume : undefined;
}

/**
 * Assert that two prices are within `PRICE_TOLERANCE` relative error.
 * Useful in snapshot tests to account for floating-point rounding.
 */
export function assertPriceClose(actual: number, expected: number, tolerance = PRICE_TOLERANCE): void {
    const relErr = Math.abs(actual - expected) / (Math.abs(expected) || 1);
    if (relErr > tolerance) {
        throw new Error(
            `Price assertion failed: actual=${actual}, expected=${expected}, relErr=${relErr.toExponential(3)}`,
        );
    }
}

// ── Multi-endpoint consistency verification (#781) ────────────────────────────

/** Maximum relative price divergence (%) allowed between two Horizon endpoints. */
export const CONSISTENCY_TOLERANCE_PERCENT = 1.0;

export interface SnapshotWithMeta {
    /** The order book snapshot from this endpoint. */
    snapshot: OrderBookSnapshot;
    /** Ledger sequence number at the time the snapshot was taken. */
    ledgerSequence: number;
}

export interface ConsistencyResult {
    /** true when the two endpoints agree within {@link CONSISTENCY_TOLERANCE_PERCENT}. */
    consistent: boolean;
    /** Percentage divergence between mid-prices; undefined when a mid-price cannot be computed. */
    divergencePercent: number | undefined;
    /** The snapshot to use: primary when consistent or when primary is more recent; otherwise secondary. */
    selectedSnapshot: OrderBookSnapshot;
    /** Human-readable explanation of why this snapshot was selected. */
    reason: string;
}

/**
 * Compare two order book snapshots from different Horizon endpoints and detect
 * stale data caused by network splits.
 *
 * Algorithm:
 * 1. Compute mid-price for each snapshot.
 * 2. Calculate relative divergence = |p1 − p2| / avg(p1, p2) × 100.
 * 3. If divergence ≤ {@link CONSISTENCY_TOLERANCE_PERCENT} (1%), return primary.
 * 4. Otherwise log a violation via `onViolation` and return the snapshot with
 *    the higher ledger sequence (more recent data wins).
 *
 * @param primary - Snapshot from the primary Horizon endpoint.
 * @param secondary - Snapshot from the secondary Horizon endpoint.
 * @param onViolation - Optional callback invoked with a description when
 *   divergence exceeds the tolerance (use for analytics / logging).
 */
export function verifyOrderBookConsistency(
    primary: SnapshotWithMeta,
    secondary: SnapshotWithMeta,
    onViolation?: (message: string) => void,
): ConsistencyResult {
    const primaryPrice = computeDexPrice(primary.snapshot);
    const secondaryPrice = computeDexPrice(secondary.snapshot);

    if (
        primaryPrice.midPrice === undefined ||
        secondaryPrice.midPrice === undefined
    ) {
        return {
            consistent: true,
            divergencePercent: undefined,
            selectedSnapshot: primary.snapshot,
            reason: 'Cannot compute mid-price for one or both endpoints; defaulting to primary',
        };
    }

    const avg = (primaryPrice.midPrice + secondaryPrice.midPrice) / 2;
    const divergencePercent =
        avg > 0
            ? (Math.abs(primaryPrice.midPrice - secondaryPrice.midPrice) / avg) * 100
            : 0;

    if (divergencePercent <= CONSISTENCY_TOLERANCE_PERCENT) {
        return {
            consistent: true,
            divergencePercent,
            selectedSnapshot: primary.snapshot,
            reason: 'Endpoints within tolerance; using primary snapshot',
        };
    }

    const msg =
        `Order book consistency violation: ${divergencePercent.toFixed(4)}% divergence ` +
        `exceeds ${CONSISTENCY_TOLERANCE_PERCENT}% tolerance ` +
        `(primary ledger ${primary.ledgerSequence}, secondary ledger ${secondary.ledgerSequence})`;
    onViolation?.(msg);

    const useSecondary = secondary.ledgerSequence > primary.ledgerSequence;
    return {
        consistent: false,
        divergencePercent,
        selectedSnapshot: useSecondary ? secondary.snapshot : primary.snapshot,
        reason: useSecondary
            ? `Selected secondary (ledger ${secondary.ledgerSequence} > ${primary.ledgerSequence})`
            : `Selected primary (ledger ${primary.ledgerSequence} >= ${secondary.ledgerSequence})`,
    };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function topPrice(levels: OrderBookLevel[]): number | undefined {
    if (levels.length === 0) return undefined;
    const p = parseFloat(levels[0].price);
    return isFinite(p) ? p : undefined;
}

// ---------------------------------------------------------------------------
// VWAP Outlier Detection (#791)
// ---------------------------------------------------------------------------

export interface VwapOutlierResult {
    /** VWAP across all order book levels on this side. */
    vwap: number | undefined;
    /** Best (top-of-book) price for this side. */
    bestPrice: number | undefined;
    /** Prices flagged as anomalous (> 3 σ from the mean). */
    outliers: number[];
    /** Whether any outlier was detected. */
    hasOutlier: boolean;
}

export interface EnrichedDexPriceResult extends DexPriceResult {
    /** VWAP and outlier info for the bid side. */
    bidAnalysis: VwapOutlierResult;
    /** VWAP and outlier info for the ask side. */
    askAnalysis: VwapOutlierResult;
}

/**
 * Detect outlier prices in a list of order book levels using a robust
 * median / median-absolute-deviation (MAD) statistic.
 *
 * Unlike a naive population mean/stdDev test, a single extreme value cannot
 * inflate the detection threshold and thereby mask its own detection
 * (the so-called "self-masking" flaw of the classical 3-sigma test).
 *
 * A price is classified as an outlier when
 *   |price − median| > 3 × (MAD / 0.6745)
 * where the 0.6745 factor makes the normalised MAD a consistent estimator of
 * the standard deviation for a Gaussian distribution (same scale as the
 * classical 3-sigma rule for well-behaved data).
 *
 * When MAD = 0 (i.e. more than half the values share the same price) but the
 * data is not all identical, the function falls back to the mean absolute
 * deviation (MAD_mean) as the spread estimator so that lone extreme values
 * are still correctly flagged in "majority-tie" distributions.
 *
 * @param levels - Order book price levels
 * @returns Array of outlier price values (empty when none detected)
 */
export function detectOutliers(levels: OrderBookLevel[]): number[] {
    const prices = levels
        .map((l) => parseFloat(l.price))
        .filter((p) => isFinite(p));

    if (prices.length < 2) return [];

    // Compute median
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
        sorted.length % 2 === 1
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;

    // Compute MAD (median of absolute deviations from the median)
    const deviations = prices.map((p) => Math.abs(p - median));
    const sortedDev = [...deviations].sort((a, b) => a - b);
    const madMid = Math.floor(sortedDev.length / 2);
    const mad =
        sortedDev.length % 2 === 1
            ? sortedDev[madMid]
            : (sortedDev[madMid - 1] + sortedDev[madMid]) / 2;

    // Normalise MAD to the same scale as a standard deviation (Gaussian assumption)
    let normalisedMad = mad / 0.6745;

    if (normalisedMad === 0) {
        // MAD is zero when more than half the values share the same price.
        // Check whether all values are identical — if so, nothing is an outlier.
        if (sorted[0] === sorted[sorted.length - 1]) return [];

        // Fall back to the mean absolute deviation so lone extreme values are
        // still detected in majority-tie distributions (e.g. 20 × 1.0 + 1 × 10).
        const meanAbsDev =
            deviations.reduce((s, d) => s + d, 0) / deviations.length;
        normalisedMad = meanAbsDev / 0.6745;

        // If the fallback is still zero (can't happen given the all-equal check
        // above, but guard defensively), nothing is an outlier.
        if (normalisedMad === 0) return [];
    }

    return prices.filter((p) => Math.abs(p - median) > 3 * normalisedMad);
}

/**
 * Analyse one side of the order book: compute VWAP and detect outliers.
 */
function analyseSide(levels: OrderBookLevel[]): VwapOutlierResult {
    const vwap = computeVwap(levels);
    const bestPrice = topPrice(levels);
    const outliers = detectOutliers(levels);
    return { vwap, bestPrice, outliers, hasOutlier: outliers.length > 0 };
}

/**
 * Compute enriched price metrics including per-side VWAP and outlier detection.
 *
 * @param book - Order book snapshot
 * @returns Base `DexPriceResult` fields plus `bidAnalysis` and `askAnalysis`
 */
export function computeEnrichedDexPrice(book: OrderBookSnapshot): EnrichedDexPriceResult {
    return {
        ...computeDexPrice(book),
        bidAnalysis: analyseSide(book.bids),
        askAnalysis: analyseSide(book.asks),
    };
}

// ---------------------------------------------------------------------------
// Ledger-close triggered price feed (#791)
// ---------------------------------------------------------------------------

export type PriceFeedUpdateHandler = (result: EnrichedDexPriceResult) => void;

export interface LedgerEvent {
    sequence: number;
}

export interface LedgerEventEmitter {
    on(event: 'ledger', handler: (ledger: LedgerEvent) => void): void;
    off(event: 'ledger', handler: (ledger: LedgerEvent) => void): void;
}

export interface OrderBookFetcher {
    fetch(): Promise<OrderBookSnapshot>;
}

/**
 * Subscribe to ledger-close events and call `onUpdate` with a freshly
 * computed `EnrichedDexPriceResult` on every new ledger.
 *
 * A single failing `fetcher.fetch()` never tears the subscription down — the
 * stream stays alive and keeps trying on the next ledger. That resilience,
 * however, previously made a *persistent* failure (expired credentials, a
 * renamed Horizon endpoint, a network partition) indistinguishable from a quiet
 * market: the subscription stops producing updates while remaining technically
 * active, with nothing logged. Pass `onError` to observe and alert on sustained
 * failures; it is invoked once per failed ledger event with the thrown error and
 * the triggering `LedgerEvent`, and its own exceptions are ignored so a broken
 * handler cannot break the feed.
 *
 * @param emitter  - Source of `'ledger'` events (e.g. Horizon SSE stream)
 * @param fetcher  - Fetches the current order book snapshot on demand
 * @param onUpdate - Called with the enriched price result after each ledger
 * @param onError  - Optional; called with `(error, ledger)` each time a per-ledger
 *                   fetch fails. Does not change the resilience behaviour — the
 *                   subscription stays alive regardless.
 * @returns Unsubscribe function – call it to stop receiving updates
 */
export function subscribeLedgerPriceFeed(
    emitter: LedgerEventEmitter,
    fetcher: OrderBookFetcher,
    onUpdate: PriceFeedUpdateHandler,
    onError?: (error: unknown, ledger: LedgerEvent) => void,
): () => void {
    const handler = async (ledger: LedgerEvent) => {
        try {
            const book = await fetcher.fetch();
            onUpdate(computeEnrichedDexPrice(book));
        } catch (error) {
            // Swallow individual fetch errors; the stream stays alive.
            // Surface them through onError so callers can alert on sustained failures.
            try {
                onError?.(error, ledger);
            } catch {
                // A misbehaving error handler must not break the feed.
            }
        }
    };

    emitter.on('ledger', handler);
    return () => emitter.off('ledger', handler);
}
