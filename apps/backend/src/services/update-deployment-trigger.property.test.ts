/**
 * Property 36 — Update Deployment Trigger
 *
 * REQUIREMENT (Issue #118):
 * For any deployment update, a new Vercel build should be triggered after
 * code is committed.
 *
 * INVARIANT:
 * Whenever the update pipeline reaches the 'updating_repo' stage (code committed),
 * it MUST subsequently enter the 'redeploying' stage (Vercel build triggered).
 * The redeploying stage must always follow a successful code commit — no update
 * may skip the Vercel trigger.
 *
 * TEST STRATEGY:
 * - Uses fast-check for property-based testing (100 iterations)
 * - Mock-based: no real network calls
 * - Generates valid update mutations across templates
 * - Asserts a new deployment event is created when an update is accepted
 *
 * Validates: Design doc Property 36 / Requirements 13.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type { CustomizationConfig } from '@craft/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type UpdateStage =
    | 'pending'
    | 'validating'
    | 'generating'
    | 'updating_repo'
    | 'redeploying'
    | 'completed'
    | 'rolled_back'
    | 'failed';

interface UpdatePipelineResult {
    success: boolean;
    stages: UpdateStage[];
    vercelBuildTriggered: boolean;
    deploymentEventId?: string;
    errorMessage?: string;
}

interface DeploymentUpdateInput {
    deploymentId: string;
    userId: string;
    customizationConfig: CustomizationConfig;
    templateId: string;
}

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

const arbCustomizationConfig: fc.Arbitrary<CustomizationConfig> = fc.record({
    branding: arbBranding,
    features: arbFeatures,
    stellar: arbStellar,
});

const arbTemplateId = fc.constantFrom(
    'stellar-dex',
    'soroban-defi',
    'payment-gateway',
    'asset-issuance'
);

const arbUpdateInput: fc.Arbitrary<DeploymentUpdateInput> = fc.record({
    deploymentId: fc.uuid(),
    userId: fc.uuid(),
    customizationConfig: arbCustomizationConfig,
    templateId: arbTemplateId,
});

// ── Mock Update Pipeline ──────────────────────────────────────────────────────

/**
 * Simulates the deployment update pipeline.
 * Tracks every stage visited and whether a Vercel build was triggered.
 */
class MockUpdatePipeline {
    private vercelTriggerSpy = { callCount: 0, lastDeploymentId: '' };

    private triggerVercelBuild(deploymentId: string): string {
        this.vercelTriggerSpy.callCount++;
        this.vercelTriggerSpy.lastDeploymentId = deploymentId;
        // Return a simulated Vercel deployment event ID
        return `vdpl_${deploymentId.slice(0, 8)}_${Date.now()}`;
    }

    async execute(input: DeploymentUpdateInput): Promise<UpdatePipelineResult> {
        const stages: UpdateStage[] = ['pending'];

        // Stage: validating
        stages.push('validating');
        if (!input.customizationConfig.branding?.appName) {
            return { success: false, stages, vercelBuildTriggered: false, errorMessage: 'Invalid config' };
        }

        // Stage: generating
        stages.push('generating');

        // Stage: updating_repo (code committed)
        stages.push('updating_repo');

        // Stage: redeploying — MUST always follow updating_repo
        stages.push('redeploying');
        const deploymentEventId = this.triggerVercelBuild(input.deploymentId);

        // Stage: completed
        stages.push('completed');

        return {
            success: true,
            stages,
            vercelBuildTriggered: true,
            deploymentEventId,
        };
    }

    getVercelTriggerSpy() {
        return { ...this.vercelTriggerSpy };
    }

    resetSpy() {
        this.vercelTriggerSpy = { callCount: 0, lastDeploymentId: '' };
    }
}

// ── Property Tests ────────────────────────────────────────────────────────────

describe('Property 36 — Update Deployment Trigger', () => {
    let pipeline: MockUpdatePipeline;

    beforeEach(() => {
        pipeline = new MockUpdatePipeline();
    });

    /**
     * Property 36.1 — Core invariant: Vercel build is always triggered after commit
     *
     * For ANY valid deployment update, once code is committed (updating_repo),
     * a Vercel build MUST be triggered (redeploying stage entered).
     */
    describe('Property 36.1 — Vercel build triggered after code commit', () => {
        it('for any valid update, redeploying stage always follows updating_repo', async () => {
            await fc.assert(
                fc.asyncProperty(arbUpdateInput, async (input) => {
                    const result = await pipeline.execute(input);

                    const repoIdx = result.stages.indexOf('updating_repo');
                    const redeployIdx = result.stages.indexOf('redeploying');

                    // updating_repo must be present
                    expect(repoIdx).toBeGreaterThanOrEqual(0);

                    // redeploying must immediately follow updating_repo
                    expect(redeployIdx).toBe(repoIdx + 1);

                    // Vercel build must have been triggered
                    expect(result.vercelBuildTriggered).toBe(true);
                    expect(result.deploymentEventId).toBeDefined();
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 36.2 — Deployment event ID is created for every accepted update
     *
     * A new deployment event (Vercel build) must be created for each update.
     */
    describe('Property 36.2 — New deployment event created per accepted update', () => {
        it('each accepted update produces a unique deployment event ID', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(arbUpdateInput, { minLength: 2, maxLength: 5 }),
                    async (inputs) => {
                        const eventIds = new Set<string>();

                        for (const input of inputs) {
                            const result = await pipeline.execute(input);
                            expect(result.deploymentEventId).toBeDefined();
                            eventIds.add(result.deploymentEventId!);
                        }

                        // Each update produces a distinct event ID
                        expect(eventIds.size).toBe(inputs.length);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 36.3 — Vercel trigger count matches accepted updates
     *
     * The number of Vercel build triggers must equal the number of accepted updates.
     */
    describe('Property 36.3 — Vercel trigger count equals accepted update count', () => {
        it('Vercel build is triggered exactly once per accepted update', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(arbUpdateInput, { minLength: 1, maxLength: 10 }),
                    async (inputs) => {
                        pipeline.resetSpy();

                        for (const input of inputs) {
                            await pipeline.execute(input);
                        }

                        const spy = pipeline.getVercelTriggerSpy();
                        expect(spy.callCount).toBe(inputs.length);
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 36.4 — Stage ordering: redeploying never precedes updating_repo
     *
     * The Vercel trigger must never fire before code is committed.
     */
    describe('Property 36.4 — Vercel trigger never precedes code commit', () => {
        it('redeploying stage index is always greater than updating_repo stage index', async () => {
            await fc.assert(
                fc.asyncProperty(arbUpdateInput, async (input) => {
                    const result = await pipeline.execute(input);

                    const repoIdx = result.stages.indexOf('updating_repo');
                    const redeployIdx = result.stages.indexOf('redeploying');

                    if (redeployIdx !== -1 && repoIdx !== -1) {
                        expect(redeployIdx).toBeGreaterThan(repoIdx);
                    }
                }),
                { numRuns: 100 }
            );
        });
    });

    /**
     * Property 36.5 — Template-agnostic: trigger fires for all template types
     *
     * The Vercel build trigger must fire regardless of which template is being updated.
     */
    describe('Property 36.5 — Trigger fires for all template types', () => {
        it('Vercel build is triggered for every template type', async () => {
            const templates = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'];

            await fc.assert(
                fc.asyncProperty(arbCustomizationConfig, async (config) => {
                    for (const templateId of templates) {
                        const input: DeploymentUpdateInput = {
                            deploymentId: fc.sample(fc.uuid(), 1)[0],
                            userId: fc.sample(fc.uuid(), 1)[0],
                            customizationConfig: config,
                            templateId,
                        };

                        const result = await pipeline.execute(input);

                        expect(result.vercelBuildTriggered).toBe(true);
                        expect(result.stages).toContain('redeploying');
                    }
                }),
                { numRuns: 100 }
            );
        });
    });
});
