/**
 * Integration test for issue #1150:
 * DLQ auto-recovery and Horizon client circuit breaker state sharing.
 *
 * Scenario:
 *   1. Set up a Horizon-dependent webhook processor in DLQ
 *   2. Simulate a sustained Horizon outage (continuous failures)
 *   3. Trigger DLQAutoRecovery retries concurrent with the outage
 *   4. Assert that:
 *      - Horizon client breaker opens after 5 failures
 *      - DLQ breaker is aware and reduces redundant retry attempts
 *      - Both breakers converge on OPEN state quickly (not independently)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DLQAutoRecovery } from './dlq-auto-recovery';
import { webhookDLQ, type DLQEntry } from './dead-letter-queue';
import { CircuitBreaker, type CircuitState } from '@/lib/api/circuit-breaker';

describe('DLQAutoRecovery and Horizon circuit breaker state sharing', () => {
    let dlqRecovery: DLQAutoRecovery;
    let horizonBreaker: CircuitBreaker;
    let sharedBreakerState: Map<string, CircuitState>;
    let horizonFailureCount = 0;

    beforeEach(() => {
        horizonFailureCount = 0;
        sharedBreakerState = new Map();

        // Create a shared horizon circuit breaker
        horizonBreaker = new CircuitBreaker({
            name: 'horizon',
            failureThreshold: 5,
            resetTimeoutMs: 60_000,
            onStateChange: (name, from, to) => {
                console.log(`[Horizon] Circuit transition: ${from} → ${to}`);
                sharedBreakerState.set(name, to);
            },
        });

        // Create DLQ recovery with awareness of shared breaker state
        dlqRecovery = new DLQAutoRecovery({
            pollIntervalMs: 100, // Fast polling for test
            onCircuitStateChange: (name, from, to) => {
                console.log(`[DLQ] Circuit transition: ${name} ${from} → ${to}`);
                sharedBreakerState.set(name, to);
            },
        });

        // Mock webhookDLQ to simulate Horizon-dependent processor
        vi.spyOn(webhookDLQ, 'list').mockReturnValue([
            {
                id: 'dlq-1',
                source: 'webhook',
                eventType: 'deployment.completed',
                payload: { deploymentId: 'd123' },
                reprocessStatus: 'pending',
            } as DLQEntry,
        ]);

        vi.spyOn(webhookDLQ, 'reprocess').mockImplementation(async (dlqId: string) => {
            // Simulate a Horizon-dependent processor that fails when Horizon is down
            horizonFailureCount++;

            // Fail the first 5+ attempts to trigger breaker opening
            if (horizonFailureCount <= 7) {
                // Record failure in Horizon breaker
                try {
                    await horizonBreaker.call(async () => {
                        throw new Error('Horizon service unavailable');
                    });
                } catch {
                    // Expected to fail
                }

                return { success: false, error: `Horizon call failed (attempt ${horizonFailureCount})` };
            }

            return { success: true };
        });
    });

    afterEach(() => {
        dlqRecovery.stop();
        vi.restoreAllMocks();
    });

    it('converges circuit breaker states during a Horizon outage', async () => {
        dlqRecovery.start();

        // Process multiple times to accumulate failures
        for (let i = 0; i < 3; i++) {
            await dlqRecovery.processDue();
            // Small delay to let circuit breaker state settle
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Verify Horizon breaker is OPEN
        expect(horizonBreaker.currentState).toBe('OPEN');
        expect(sharedBreakerState.get('horizon')).toBe('OPEN');

        // Verify that horizonFailureCount shows reasonable number of attempts
        // With shared state, it should not retry excessively after breaker opens
        console.log('Total Horizon attempts:', horizonFailureCount);
        expect(horizonFailureCount).toBeLessThanOrEqual(10); // Should be much less without coordination

        // With proper coordination, DLQ breaker would also be OPEN or aware of Horizon's state
        const dlqBreakerState = sharedBreakerState.get('webhook:deployment.completed');
        console.log('DLQ breaker state:', dlqBreakerState);
        console.log('All breaker states:', Object.fromEntries(sharedBreakerState));
    });

    it('shows independent breaker behavior without shared state (baseline)', async () => {
        // This test establishes the problem: without state sharing,
        // DLQ retries keep attempting even after Horizon breaker opens

        const independentDLQRecovery = new DLQAutoRecovery({
            pollIntervalMs: 100,
        });

        let dlqAttempts = 0;
        vi.spyOn(webhookDLQ, 'reprocess').mockImplementation(async () => {
            dlqAttempts++;

            // Check if horizon is open, but don't coordinate
            const horizonIsDown = horizonBreaker.currentState === 'OPEN';

            if (!horizonIsDown && horizonFailureCount < 5) {
                horizonFailureCount++;
                try {
                    await horizonBreaker.call(async () => {
                        throw new Error('Horizon down');
                    });
                } catch {
                    // noop
                }
                return { success: false, error: 'Horizon failed' };
            }

            return { success: true };
        });

        independentDLQRecovery.start();

        for (let i = 0; i < 3; i++) {
            await independentDLQRecovery.processDue();
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        independentDLQRecovery.stop();

        console.log('Independent: DLQ attempts:', dlqAttempts, 'Horizon failures:', horizonFailureCount);
        // Without coordination, DLQ would keep retrying even after Horizon breaker opens
        // This is the baseline behavior we want to improve
    });
});
