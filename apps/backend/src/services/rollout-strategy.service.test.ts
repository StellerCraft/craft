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

describe('RolloutEngine — configurable rollback thresholds', () => {
    it('defaults to the module-level thresholds when none are supplied', () => {
        const candidate: DeploymentVersion = { ...HEALTHY_CANDIDATE, errorRate: ROLLBACK_ERROR_RATE_THRESHOLD };
        const engine = new RolloutEngine(HEALTHY_STABLE, candidate);
        engine.setTrafficPercent(50);

        expect(engine.evaluateAndMaybeRollback()).toBe(true);
    });

    it('rolls back on a caller-supplied stricter error-rate threshold', () => {
        // 0.03 would be healthy against the default 0.05 threshold, but not against 0.02.
        const candidate: DeploymentVersion = { ...HEALTHY_CANDIDATE, errorRate: 0.03, p99LatencyMs: 100 };
        const engine = new RolloutEngine(HEALTHY_STABLE, candidate, { errorRateThreshold: 0.02 });
        engine.setTrafficPercent(50);

        expect(engine.evaluateAndMaybeRollback()).toBe(true);
    });

    it('tolerates a caller-supplied looser latency threshold', () => {
        // 3000ms would trip the default 2000ms threshold, but not a 5000ms override.
        const candidate: DeploymentVersion = { ...HEALTHY_CANDIDATE, errorRate: 0.001, p99LatencyMs: 3_000 };
        const engine = new RolloutEngine(HEALTHY_STABLE, candidate, { latencyThresholdMs: 5_000 });
        engine.setTrafficPercent(50);

        expect(engine.evaluateAndMaybeRollback()).toBe(false);
    });

    it('rejects a zero or negative error-rate threshold override', () => {
        expect(() => new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE, { errorRateThreshold: 0 })).toThrow(RangeError);
        expect(() => new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE, { errorRateThreshold: -0.01 })).toThrow(RangeError);
    });

    it('rejects a zero or negative latency threshold override', () => {
        expect(() => new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE, { latencyThresholdMs: 0 })).toThrow(RangeError);
        expect(() => new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE, { latencyThresholdMs: -100 })).toThrow(RangeError);
    });

    it('does not mutate the shared module-level constants', () => {
        expect(() => new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE, { errorRateThreshold: 0.5, latencyThresholdMs: 9_000 })).not.toThrow();
        expect(ROLLBACK_ERROR_RATE_THRESHOLD).toBe(0.05);
        expect(ROLLBACK_LATENCY_THRESHOLD_MS).toBe(2_000);
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
