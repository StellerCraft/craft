import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RolloutEngine, type DeploymentVersion } from './rollout-strategy.service';

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

describe('RolloutEngine — evaluateFlagWithCache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the evaluator result on cache miss', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        const evaluator = vi.fn().mockReturnValue(true);

        const result = engine.evaluateFlagWithCache('user-1', 'flag-a', evaluator);

        expect(result).toBe(true);
        expect(evaluator).toHaveBeenCalledTimes(1);
    });

    it('returns cached result on cache hit within TTL', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        const evaluator = vi.fn().mockReturnValue(true);

        engine.evaluateFlagWithCache('user-1', 'flag-a', evaluator);
        const result = engine.evaluateFlagWithCache('user-1', 'flag-a', evaluator);

        expect(result).toBe(true);
        expect(evaluator).toHaveBeenCalledTimes(1);
    });

    it('re-evaluates after TTL expires', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        const evaluator = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);

        vi.setSystemTime(0);
        const first = engine.evaluateFlagWithCache('user-1', 'flag-a', evaluator);
        expect(first).toBe(true);

        vi.setSystemTime(6_000);
        const second = engine.evaluateFlagWithCache('user-1', 'flag-a', evaluator);
        expect(second).toBe(false);

        expect(evaluator).toHaveBeenCalledTimes(2);
    });

    it('caches different flag keys independently', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        const evaluatorA = vi.fn().mockReturnValue(true);
        const evaluatorB = vi.fn().mockReturnValue(false);

        expect(engine.evaluateFlagWithCache('user-1', 'flag-a', evaluatorA)).toBe(true);
        expect(engine.evaluateFlagWithCache('user-1', 'flag-b', evaluatorB)).toBe(false);

        expect(evaluatorA).toHaveBeenCalledTimes(1);
        expect(evaluatorB).toHaveBeenCalledTimes(1);
    });

    it('caches different user IDs independently', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        const evaluator1 = vi.fn().mockReturnValue(true);
        const evaluator2 = vi.fn().mockReturnValue(false);

        expect(engine.evaluateFlagWithCache('user-1', 'flag-a', evaluator1)).toBe(true);
        expect(engine.evaluateFlagWithCache('user-2', 'flag-a', evaluator2)).toBe(false);
    });

    it('evicts oldest entry when cache exceeds MAX_FLAG_CACHE_ENTRIES', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);

        for (let i = 0; i < 10_001; i++) {
            engine.evaluateFlagWithCache(`user-${i}`, 'flag-a', () => true);
        }

        const evaluator = vi.fn().mockReturnValue(false);
        const result = engine.evaluateFlagWithCache('user-0', 'flag-a', evaluator);

        expect(result).toBe(false);
        expect(evaluator).toHaveBeenCalledTimes(1);
    });
});

describe('RolloutEngine — clearFlagCache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears cache for a specific flagKey', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        const evaluatorA = vi.fn().mockReturnValue(true);
        const evaluatorB = vi.fn().mockReturnValue(false);

        engine.evaluateFlagWithCache('user-1', 'flag-a', evaluatorA);
        engine.evaluateFlagWithCache('user-1', 'flag-b', evaluatorB);

        engine.clearFlagCache('flag-a');

        const resultA = engine.evaluateFlagWithCache('user-1', 'flag-a', evaluatorA);
        const resultB = engine.evaluateFlagWithCache('user-1', 'flag-b', evaluatorB);

        expect(resultA).toBe(true);
        expect(evaluatorA).toHaveBeenCalledTimes(2);

        expect(resultB).toBe(false);
        expect(evaluatorB).toHaveBeenCalledTimes(1);
    });

    it('clears all cache entries when no flagKey is provided', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        const evaluatorA = vi.fn().mockReturnValue(true);
        const evaluatorB = vi.fn().mockReturnValue(false);

        engine.evaluateFlagWithCache('user-1', 'flag-a', evaluatorA);
        engine.evaluateFlagWithCache('user-1', 'flag-b', evaluatorB);

        engine.clearFlagCache();

        const resultA = engine.evaluateFlagWithCache('user-1', 'flag-a', evaluatorA);
        const resultB = engine.evaluateFlagWithCache('user-1', 'flag-b', evaluatorB);

        expect(resultA).toBe(true);
        expect(evaluatorA).toHaveBeenCalledTimes(2);
        expect(resultB).toBe(false);
        expect(evaluatorB).toHaveBeenCalledTimes(2);
    });

    it('clearFlagCache does not throw when cache is empty', () => {
        const engine = new RolloutEngine(HEALTHY_STABLE, HEALTHY_CANDIDATE);
        expect(() => engine.clearFlagCache()).not.toThrow();
        expect(() => engine.clearFlagCache('nonexistent-flag')).not.toThrow();
    });
});
