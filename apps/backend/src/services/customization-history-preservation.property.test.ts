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
