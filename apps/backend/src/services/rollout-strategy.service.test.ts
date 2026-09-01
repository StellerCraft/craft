import { describe, it, expect } from 'vitest';
import {
    RolloutEngine,
    BlueGreenSwitcher,
    ROLLBACK_ERROR_RATE_THRESHOLD,
    ROLLBACK_LATENCY_THRESHOLD_MS,
    type DeploymentVersion,
} from './rollout-strategy.service';

const HEALTHY_STABLE: DeploymentVersion = {
    id: 'stable-v1',
    errorRate: 0.01,
    p99LatencyMs: 200,
};

const HEALTHY_CANDIDATE: DeploymentVersion = {
    id: 'candidate-v2',
    errorRate: 0.02,
    p99LatencyMs: 300,
};

describe('RolloutEngine — setTrafficPercent boundary values', () => {
    it('accepts 0 as a valid lower boundary', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        engine.setTrafficPercent(0);
        expect(engine.canaryPercent).toBe(0);
        expect(engine.status).toBe('pending');
    });

    it('accepts 100 as a valid upper boundary', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        engine.setTrafficPercent(100);
        expect(engine.canaryPercent).toBe(100);
        expect(engine.status).toBe('promoted');
    });

    it('throws RangeError for negative percent', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        expect(() => engine.setTrafficPercent(-1)).toThrow(RangeError);
        expect(() => engine.setTrafficPercent(-0.001)).toThrow(RangeError);
    });

    it('throws RangeError for percent > 100', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        expect(() => engine.setTrafficPercent(101)).toThrow(RangeError);
        expect(() => engine.setTrafficPercent(100.001)).toThrow(RangeError);
    });

    it('sets status to in_progress for a mid-range value', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        engine.setTrafficPercent(50);
        expect(engine.status).toBe('in_progress');
    });
});

describe('RolloutEngine — evaluateAndMaybeRollback at thresholds', () => {
    it('rolls back when error rate is exactly at threshold (>=)', () => {
        const candidate: DeploymentVersion = {
            id: 'candidate-at-threshold',
            errorRate: ROLLBACK_ERROR_RATE_THRESHOLD,
            p99LatencyMs: 100,
        };
        const engine = new RolloutEngine(HEALTHY_STABLE, candidate);
        engine.setTrafficPercent(50);

        expect(engine.evaluateAndMaybeRollback()).toBe(true);
        expect(engine.status).toBe('rolled_back');
        expect(engine.canaryPercent).toBe(0);
    });

    it('does NOT roll back when error rate is just below threshold', () => {
        const candidate: DeploymentVersion = {
            id: 'candidate-below-threshold',
            errorRate: ROLLBACK_ERROR_RATE_THRESHOLD - 0.0001,
            p99LatencyMs: 100,
        };
        const engine = new RolloutEngine(HEALTHY_STABLE, candidate);
        engine.setTrafficPercent(50);

        expect(engine.evaluateAndMaybeRollback()).toBe(false);
        expect(engine.status).toBe('in_progress');
    });

    it('rolls back when p99 latency exceeds threshold (>)', () => {
        const candidate: DeploymentVersion = {
            id: 'candidate-over-latency',
            errorRate: 0.01,
            p99LatencyMs: ROLLBACK_LATENCY_THRESHOLD_MS + 1,
        };
        const engine = new RolloutEngine(HEALTHY_STABLE, candidate);
        engine.setTrafficPercent(50);

        expect(engine.evaluateAndMaybeRollback()).toBe(true);
        expect(engine.status).toBe('rolled_back');
    });

    it('does NOT roll back when p99 latency is exactly at threshold (<=)', () => {
        const candidate: DeploymentVersion = {
            id: 'candidate-at-latency',
            errorRate: 0.01,
            p99LatencyMs: ROLLBACK_LATENCY_THRESHOLD_MS,
        };
        const engine = new RolloutEngine(HEALTHY_STABLE, candidate);
        engine.setTrafficPercent(50);

        expect(engine.evaluateAndMaybeRollback()).toBe(false);
        expect(engine.status).toBe('in_progress');
    });

    it('does not roll back when candidate is healthy', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        engine.setTrafficPercent(75);

        expect(engine.evaluateAndMaybeRollback()).toBe(false);
        expect(engine.status).toBe('in_progress');
        expect(engine.canaryPercent).toBe(75);
    });
});

describe('BlueGreenSwitcher — switchToStandby', () => {
    it('switches to standby when standby version is healthy', () => {
        const switcher = new BlueGreenSwitcher(HEALTHY_STABLE, HEALTHY_CANDIDATE, 'blue');
        expect(switcher.active).toBe('blue');

        const result = switcher.switchToStandby();

        expect(result).toBe(true);
        expect(switcher.active).toBe('green');
        expect(switcher.standby).toBe('blue');
    });

    it('does NOT switch when standby version is unhealthy (high error rate)', () => {
        const unhealthyCandidate: DeploymentVersion = {
            id: 'candidate-unhealthy',
            errorRate: ROLLBACK_ERROR_RATE_THRESHOLD,
            p99LatencyMs: 100,
        };
        const switcher = new BlueGreenSwitcher(HEALTHY_STABLE, unhealthyCandidate, 'blue');

        const result = switcher.switchToStandby();

        expect(result).toBe(false);
        expect(switcher.active).toBe('blue');
    });

    it('does NOT switch when standby version exceeds latency threshold', () => {
        const slowCandidate: DeploymentVersion = {
            id: 'candidate-slow',
            errorRate: 0.01,
            p99LatencyMs: ROLLBACK_LATENCY_THRESHOLD_MS + 1,
        };
        const switcher = new BlueGreenSwitcher(HEALTHY_STABLE, slowCandidate, 'blue');

        const result = switcher.switchToStandby();

        expect(result).toBe(false);
        expect(switcher.active).toBe('blue');
    });

    it('activeVersion and standbyVersion reflect the initial color', () => {
        const switcher = new BlueGreenSwitcher(HEALTHY_STABLE, HEALTHY_CANDIDATE, 'green');
        expect(switcher.active).toBe('green');
        expect(switcher.activeVersion()).toBe(HEALTHY_CANDIDATE);
        expect(switcher.standbyVersion()).toBe(HEALTHY_STABLE);
    });

    it('after switching, activeVersion returns the previous standby', () => {
        const switcher = new BlueGreenSwitcher(HEALTHY_STABLE, HEALTHY_CANDIDATE, 'blue');
        switcher.switchToStandby();

        expect(switcher.activeVersion()).toBe(HEALTHY_CANDIDATE);
        expect(switcher.standbyVersion()).toBe(HEALTHY_STABLE);
    });
});
