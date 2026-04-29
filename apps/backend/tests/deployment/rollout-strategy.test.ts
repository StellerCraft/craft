/**
 * Deployment Rollout Strategy Tests
 *
 * Verifies the production rollout strategy primitives that back live deployment
 * updates. These tests intentionally exercise the shared service classes so the
 * update pipeline and rollout strategy stay aligned.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
    BlueGreenSwitcher,
    RolloutEngine,
    type DeploymentVersion,
} from '@/services/rollout-strategy.service';

function makeVersion(id: string, errorRate = 0.001, p99LatencyMs = 120): DeploymentVersion {
    return { id, errorRate, p99LatencyMs };
}

describe('Canary rollout - traffic percentage controls', () => {
    let engine: RolloutEngine;

    beforeEach(() => {
        engine = new RolloutEngine(makeVersion('stable-v1'), makeVersion('canary-v2'));
    });

    it('starts with 0 % canary traffic (pending status)', () => {
        expect(engine.canaryPercent).toBe(0);
        expect(engine.status).toBe('pending');
    });

    it('routes 0 % to canary when percent is 0', () => {
        const counts = engine.simulateTraffic(100);
        expect(counts['canary-v2']).toBe(0);
        expect(counts['stable-v1']).toBe(100);
    });

    it('routes about 10 % to canary at 10 % setting', () => {
        engine.setTrafficPercent(10);
        const counts = engine.simulateTraffic(1_000);
        expect(counts['canary-v2']).toBeGreaterThanOrEqual(80);
        expect(counts['canary-v2']).toBeLessThanOrEqual(120);
        expect(engine.status).toBe('in_progress');
    });

    it('routes about 50 % to canary at 50 % setting', () => {
        engine.setTrafficPercent(50);
        const counts = engine.simulateTraffic(1_000);
        expect(counts['canary-v2']).toBeGreaterThanOrEqual(480);
        expect(counts['canary-v2']).toBeLessThanOrEqual(520);
    });

    it('routes 100 % to canary after promotion', () => {
        engine.promote();
        const counts = engine.simulateTraffic(100);
        expect(counts['canary-v2']).toBe(100);
        expect(engine.status).toBe('promoted');
    });

    it('rejects out-of-range traffic percentages', () => {
        expect(() => engine.setTrafficPercent(-1)).toThrow(RangeError);
        expect(() => engine.setTrafficPercent(101)).toThrow(RangeError);
    });
});

describe('Canary rollout - automatic rollback', () => {
    it('rolls back when candidate error rate exceeds threshold', () => {
        const engine = new RolloutEngine(
            makeVersion('stable-v1'),
            makeVersion('canary-v2', 0.08),
        );
        engine.setTrafficPercent(10);

        expect(engine.evaluateAndMaybeRollback()).toBe(true);
        expect(engine.status).toBe('rolled_back');
        expect(engine.canaryPercent).toBe(0);
    });

    it('rolls back when candidate p99 latency exceeds threshold', () => {
        const engine = new RolloutEngine(
            makeVersion('stable-v1'),
            makeVersion('canary-v2', 0.001, 2_500),
        );
        engine.setTrafficPercent(10);

        expect(engine.evaluateAndMaybeRollback()).toBe(true);
        expect(engine.status).toBe('rolled_back');
    });

    it('does not roll back when candidate is healthy', () => {
        const engine = new RolloutEngine(
            makeVersion('stable-v1'),
            makeVersion('canary-v2', 0.002, 150),
        );
        engine.setTrafficPercent(25);

        expect(engine.evaluateAndMaybeRollback()).toBe(false);
        expect(engine.status).toBe('in_progress');
        expect(engine.canaryPercent).toBe(25);
    });
});

describe('Blue-green deployment - switching', () => {
    it('starts serving traffic from the initial active environment', () => {
        const switcher = new BlueGreenSwitcher(
            makeVersion('blue-v1'),
            makeVersion('green-v2'),
            'blue',
        );

        expect(switcher.activeVersion().id).toBe('blue-v1');
        expect(switcher.active).toBe('blue');
    });

    it('switches to green when green is healthy', () => {
        const switcher = new BlueGreenSwitcher(
            makeVersion('blue-v1'),
            makeVersion('green-v2', 0.001, 100),
            'blue',
        );

        expect(switcher.switchToStandby()).toBe(true);
        expect(switcher.active).toBe('green');
        expect(switcher.standby).toBe('blue');
    });

    it('refuses to switch when standby is unhealthy', () => {
        const switcher = new BlueGreenSwitcher(
            makeVersion('blue-v1'),
            makeVersion('green-v2', 0.1, 3_000),
            'blue',
        );

        expect(switcher.switchToStandby()).toBe(false);
        expect(switcher.active).toBe('blue');
    });

    it('can switch back to blue after green degrades', () => {
        const green = makeVersion('green-v2', 0.001, 100);
        const switcher = new BlueGreenSwitcher(makeVersion('blue-v1'), green, 'blue');

        switcher.switchToStandby();
        green.errorRate = 0.2;

        expect(switcher.switchToStandby()).toBe(true);
        expect(switcher.active).toBe('blue');
    });
});
