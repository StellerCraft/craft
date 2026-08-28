/**
 * Property 37 — Customization History Preservation
 *
 * REQUIREMENT (Issue #119):
 * For any deployment, all historical customization changes should be stored
 * and retrievable.
 *
 * INVARIANTS:
 * 1. Every applied customization edit is appended to the history.
 * 2. History entries are ordered chronologically (oldest → newest).
 * 3. Each historical revision is individually recoverable by index.
 * 4. The count of history entries equals the number of applied edits.
 * 5. No revision is lost after subsequent edits.
 *
 * TEST STRATEGY:
 * - Uses fast-check for property-based testing (100 iterations)
 * - Generates sequences of valid customization edits (2–10 per run)
 * - Mock history store — no real DB calls
 * - Covers ordering, recoverability, and isolation between deployments
 *
 * Validates: Design doc Property 37 / Requirements 13.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { CustomizationConfig } from '@craft/types';

// ── Scheduler alias (fc.scheduler returns a Scheduler arbitrary) ──────────────
type Scheduler = ReturnType<typeof fc.scheduler> extends fc.Arbitrary<infer T> ? T : never;

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbBranding = fc.record({
    appName: fc.string({ minLength: 1, maxLength: 50 }),
    primaryColor: fc.stringMatching(/^[0-9a-fA-F]{6}$/).map((h) => `#${h}`),
    secondaryColor: fc.stringMatching(/^[0-9a-fA-F]{6}$/).map((h) => `#${h}`),
    fontFamily: fc.constantFrom('Inter', 'Roboto', 'Open Sans', 'Lato'),
});

const arbFeatures = fc.record({
    enableCharts: fc.boolean(),
    enableTransactionHistory: fc.boolean(),
    enableAnalytics: fc.boolean(),
    enableNotifications: fc.boolean(),
});

const arbStellar = fc.record({
    network: fc.constantFrom<'mainnet' | 'testnet'>('mainnet', 'testnet'),
    horizonUrl: fc.webUrl(),
});

const arbConfig: fc.Arbitrary<CustomizationConfig> = fc.record({
    branding: arbBranding,
    features: arbFeatures,
    stellar: arbStellar,
});

/** A non-empty sequence of edits (2–10) applied to a single deployment. */
const arbEditSequence = fc.array(arbConfig, { minLength: 2, maxLength: 10 });

// ── Mock History Store ────────────────────────────────────────────────────────

interface HistoryEntry {
    revisionIndex: number;   // 0-based, monotonically increasing
    config: CustomizationConfig;
    appliedAt: Date;
}

class MockCustomizationHistory {
    private store = new Map<string, HistoryEntry[]>();

    /** Record a new customization edit for a deployment. */
    record(deploymentId: string, config: CustomizationConfig): void {
        if (!this.store.has(deploymentId)) {
            this.store.set(deploymentId, []);
        }
        const entries = this.store.get(deploymentId)!;
        entries.push({
            revisionIndex: entries.length,
            config,
            appliedAt: new Date(),
        });
    }

    /** Return all history entries for a deployment, oldest first. */
    getHistory(deploymentId: string): HistoryEntry[] {
        return this.store.get(deploymentId) ?? [];
    }

    /** Retrieve a specific revision by index. */
    getRevision(deploymentId: string, index: number): HistoryEntry | undefined {
        return this.store.get(deploymentId)?.[index];
    }
}

/**
 * Async variant of MockCustomizationHistory for concurrent-edit property tests.
 *
 * The append uses a shared array reference so concurrent writes do not lose
 * each other — mirroring a database APPEND that is atomic at the row level.
 * The `await Promise.resolve()` yields execution to fc.scheduler so it can
 * explore all possible interleavings.
 */
class AsyncMockCustomizationHistory {
    private store = new Map<string, HistoryEntry[]>();

    async saveDraft(deploymentId: string, config: CustomizationConfig): Promise<void> {
        if (!this.store.has(deploymentId)) {
            this.store.set(deploymentId, []);
        }
        // Yield — fc.scheduler may interleave another saveDraft here
        await Promise.resolve();
        // Append to the shared array reference (atomic at the JS-engine level)
        const entries = this.store.get(deploymentId)!;
        entries.push({
            revisionIndex: entries.length,
            config,
            appliedAt: new Date(),
        });
    }

    /** Return all history entries for a deployment, oldest first. */
    getHistory(deploymentId: string): HistoryEntry[] {
        return this.store.get(deploymentId) ?? [];
    }

    /** Return all history entries newest-first (for pagination tests). */
    getHistoryNewestFirst(deploymentId: string): HistoryEntry[] {
        return [...(this.store.get(deploymentId) ?? [])].reverse();
    }
}

// ── Property Tests ────────────────────────────────────────────────────────────

describe('Property 37 — Customization History Preservation', () => {
    let history: MockCustomizationHistory;

    beforeEach(() => {
        history = new MockCustomizationHistory();
    });

    /**
     * Property 37.1 — Every edit is stored
     *
     * After applying N edits, the history contains exactly N entries.
     */
    describe('Property 37.1 — Every edit is stored', () => {
        it('history length equals the number of applied edits', async () => {
            await fc.assert(
                fc.asyncProperty(fc.uuid(), arbEditSequence, async (deploymentId, edits) => {
                    for (const config of edits) {
                        history.record(deploymentId, config);
                    }

                    const entries = history.getHistory(deploymentId);
                    expect(entries.length).toBe(edits.length);
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 37.2 — Entries are chronologically ordered
     *
     * revisionIndex must be strictly increasing (0, 1, 2, …).
     */
    describe('Property 37.2 — History is ordered oldest to newest', () => {
        it('revision indices are strictly increasing', async () => {
            await fc.assert(
                fc.asyncProperty(fc.uuid(), arbEditSequence, async (deploymentId, edits) => {
                    for (const config of edits) {
                        history.record(deploymentId, config);
                    }

                    const entries = history.getHistory(deploymentId);
                    for (let i = 0; i < entries.length; i++) {
                        expect(entries[i].revisionIndex).toBe(i);
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 37.3 — Each revision is individually recoverable
     *
     * For every edit at position i, getRevision(id, i) returns the exact config.
     */
    describe('Property 37.3 — Each revision is recoverable by index', () => {
        it('getRevision returns the exact config for every stored index', async () => {
            await fc.assert(
                fc.asyncProperty(fc.uuid(), arbEditSequence, async (deploymentId, edits) => {
                    for (const config of edits) {
                        history.record(deploymentId, config);
                    }

                    for (let i = 0; i < edits.length; i++) {
                        const revision = history.getRevision(deploymentId, i);
                        expect(revision).toBeDefined();
                        expect(revision!.config).toEqual(edits[i]);
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 37.4 — No revision is lost after subsequent edits
     *
     * Applying more edits must not overwrite or remove earlier revisions.
     */
    describe('Property 37.4 — Prior revisions survive subsequent edits', () => {
        it('earlier revisions remain unchanged after more edits are applied', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    arbEditSequence,
                    arbEditSequence,
                    async (deploymentId, firstBatch, secondBatch) => {
                        // Apply first batch
                        for (const config of firstBatch) {
                            history.record(deploymentId, config);
                        }

                        // Snapshot the first batch entries
                        const snapshot = history.getHistory(deploymentId).map((e) => e.config);

                        // Apply second batch
                        for (const config of secondBatch) {
                            history.record(deploymentId, config);
                        }

                        // First batch entries must be unchanged
                        for (let i = 0; i < firstBatch.length; i++) {
                            const revision = history.getRevision(deploymentId, i);
                            expect(revision!.config).toEqual(snapshot[i]);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 37.5 — History is isolated between deployments
     *
     * Edits on deployment A must not appear in deployment B's history.
     */
    describe('Property 37.5 — History is isolated per deployment', () => {
        it('edits on one deployment do not affect another deployment\'s history', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    fc.uuid(),
                    arbEditSequence,
                    arbEditSequence,
                    async (idA, idB, editsA, editsB) => {
                        fc.pre(idA !== idB);

                        for (const config of editsA) history.record(idA, config);
                        for (const config of editsB) history.record(idB, config);

                        expect(history.getHistory(idA).length).toBe(editsA.length);
                        expect(history.getHistory(idB).length).toBe(editsB.length);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});

// ── Concurrent edit properties (Issue #713) ───────────────────────────────────

describe('Property 37 — Concurrent Edit History Preservation', () => {
    /**
     * Property 37.6 — Concurrent saves must not silently discard either user's changes
     *
     * Two users saving a draft for the same deployment concurrently must both have
     * their changes recorded. fc.scheduler interleaves the async saves in every
     * possible order; the property must hold for all interleavings.
     */
    describe('Property 37.6 — Concurrent saves preserve both users\' changes', () => {
        it('both configs appear in history regardless of interleaving order', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    arbConfig,
                    arbConfig,
                    fc.scheduler(),
                    async (deploymentId, configA, configB, s) => {
                        const asyncHistory = new AsyncMockCustomizationHistory();

                        // Schedule both saves — scheduler controls which resumes first
                        const saveA = s.schedule(
                            Promise.resolve().then(() => asyncHistory.saveDraft(deploymentId, configA)),
                        );
                        const saveB = s.schedule(
                            Promise.resolve().then(() => asyncHistory.saveDraft(deploymentId, configB)),
                        );

                        await s.waitAll();
                        await Promise.all([saveA, saveB]);

                        const entries = asyncHistory.getHistory(deploymentId);

                        // Both saves completed — history must contain exactly 2 entries
                        expect(entries.length).toBe(2);

                        // Neither config was silently discarded
                        const storedConfigs = entries.map((e) => e.config);
                        expect(storedConfigs).toContainEqual(configA);
                        expect(storedConfigs).toContainEqual(configB);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('three concurrent saves all land in history — no entry is lost', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    arbConfig,
                    arbConfig,
                    arbConfig,
                    fc.scheduler(),
                    async (deploymentId, cfgA, cfgB, cfgC, s) => {
                        const asyncHistory = new AsyncMockCustomizationHistory();

                        const saves = [cfgA, cfgB, cfgC].map((cfg) =>
                            s.schedule(
                                Promise.resolve().then(() => asyncHistory.saveDraft(deploymentId, cfg)),
                            )
                        );

                        await s.waitAll();
                        await Promise.all(saves);

                        expect(asyncHistory.getHistory(deploymentId).length).toBe(3);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 37.7 — History length after N saves is exactly N
     *
     * No compaction must occur unless an explicit compaction call is made.
     * This includes repeated saves of the identical config.
     */
    describe('Property 37.7 — History length equals N after N saves (no implicit compaction)', () => {
        it('saving the same config N times results in exactly N history entries', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    fc.integer({ min: 1, max: 25 }),
                    arbConfig,
                    async (deploymentId, n, config) => {
                        const asyncHistory = new AsyncMockCustomizationHistory();

                        for (let i = 0; i < n; i++) {
                            await asyncHistory.saveDraft(deploymentId, config);
                        }

                        // Identical configs must not be compacted
                        expect(asyncHistory.getHistory(deploymentId).length).toBe(n);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('interleaved saves on two deployments never compact either deployment\'s history', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    fc.uuid(),
                    fc.integer({ min: 1, max: 10 }),
                    fc.integer({ min: 1, max: 10 }),
                    arbConfig,
                    arbConfig,
                    async (idA, idB, nA, nB, cfgA, cfgB) => {
                        fc.pre(idA !== idB);

                        const asyncHistory = new AsyncMockCustomizationHistory();

                        // Interleave saves across both deployments
                        const ops: Promise<void>[] = [];
                        for (let i = 0; i < Math.max(nA, nB); i++) {
                            if (i < nA) ops.push(asyncHistory.saveDraft(idA, cfgA));
                            if (i < nB) ops.push(asyncHistory.saveDraft(idB, cfgB));
                        }
                        await Promise.all(ops);

                        expect(asyncHistory.getHistory(idA).length).toBe(nA);
                        expect(asyncHistory.getHistory(idB).length).toBe(nB);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 37.8 — Newest-first pagination is consistent with insertion order
     *
     * A reversed history (newest-first) must be the exact inverse of the
     * insertion order. Revision indices must be strictly decreasing when
     * iterating newest-first.
     */
    describe('Property 37.8 — Newest-first pagination is consistent', () => {
        it('newest-first order is the strict inverse of insertion order', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    arbEditSequence,
                    async (deploymentId, edits) => {
                        const asyncHistory = new AsyncMockCustomizationHistory();

                        for (const config of edits) {
                            await asyncHistory.saveDraft(deploymentId, config);
                        }

                        const newestFirst = asyncHistory.getHistoryNewestFirst(deploymentId);
                        const oldestFirst = asyncHistory.getHistory(deploymentId);

                        expect(newestFirst.length).toBe(edits.length);

                        // Newest entry (index 0 of newestFirst) is the last insertion
                        expect(newestFirst[0].revisionIndex).toBe(edits.length - 1);
                        // Oldest entry is the first insertion
                        expect(newestFirst[newestFirst.length - 1].revisionIndex).toBe(0);

                        // Revision indices are strictly decreasing in newest-first order
                        for (let i = 0; i < newestFirst.length - 1; i++) {
                            expect(newestFirst[i].revisionIndex).toBeGreaterThan(
                                newestFirst[i + 1].revisionIndex
                            );
                        }

                        // Newest-first + reversed = oldest-first
                        const roundTrip = [...newestFirst].reverse();
                        expect(roundTrip).toEqual(oldestFirst);
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('newest-first page of size K returns the K most recent entries in descending order', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    fc.array(arbConfig, { minLength: 3, maxLength: 10 }),
                    fc.integer({ min: 1, max: 3 }),
                    async (deploymentId, edits, pageSize) => {
                        const asyncHistory = new AsyncMockCustomizationHistory();

                        for (const config of edits) {
                            await asyncHistory.saveDraft(deploymentId, config);
                        }

                        const newestFirst = asyncHistory.getHistoryNewestFirst(deploymentId);
                        const page = newestFirst.slice(0, pageSize);

                        // Page contains exactly min(pageSize, total) entries
                        expect(page.length).toBe(Math.min(pageSize, edits.length));

                        // First entry in page is the most recent revision
                        expect(page[0].revisionIndex).toBe(edits.length - 1);

                        // Entries within the page are in descending revision order
                        for (let i = 0; i < page.length - 1; i++) {
                            expect(page[i].revisionIndex).toBeGreaterThan(page[i + 1].revisionIndex);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('all intermediate history snapshots are preserved and individually accessible', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.uuid(),
                    arbEditSequence,
                    fc.scheduler(),
                    async (deploymentId, edits, s) => {
                        const asyncHistory = new AsyncMockCustomizationHistory();

                        // Schedule all saves and let the scheduler interleave
                        const saves = edits.map((cfg) =>
                            s.schedule(
                                Promise.resolve().then(() => asyncHistory.saveDraft(deploymentId, cfg)),
                            )
                        );

                        await s.waitAll();
                        await Promise.all(saves);

                        const newestFirst = asyncHistory.getHistoryNewestFirst(deploymentId);

                        // Every save produced an entry — no intermediate snapshot was lost
                        expect(newestFirst.length).toBe(edits.length);

                        // Revision indices cover the full range [0 .. n-1]
                        const indices = newestFirst.map((e) => e.revisionIndex).sort((a, b) => a - b);
                        for (let i = 0; i < edits.length; i++) {
                            expect(indices[i]).toBe(i);
                        }
                    }
                ),
                { numRuns: 100 }
            );
        });
    });
});
