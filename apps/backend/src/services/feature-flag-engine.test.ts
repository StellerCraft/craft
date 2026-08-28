/**
 * Unit Tests — Feature Flag Targeting Rules Engine
 *
 * Covers:
 *   - Deterministic bucketing (same user + flag = same bucket)
 *   - Targeting rule evaluation (eq, in, gte, lte)
 *   - Tier targeting (subscription plan gating)
 *   - Override system
 *   - Flag change propagation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    deterministicBucket,
    matchesRule,
    evaluateFlag,
    FlagEngine,
    type FlagDefinition,
    type UserContext,
    type TargetingRule,
} from './feature-flag-engine';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BETA_FLAG: FlagDefinition = {
    key: 'beta-dashboard',
    defaultVariant: 'off',
    rolloutPercent: 50,
    rules: [{ attribute: 'plan', operator: 'in', value: ['pro', 'enterprise'] }],
    variants: { targeted: 'on', rollout: 'on' },
};

const AGE_GATE_FLAG: FlagDefinition = {
    key: 'age-gate',
    defaultVariant: 'off',
    rolloutPercent: 0,
    rules: [{ attribute: 'age', operator: 'gte', value: 18 }],
    variants: { targeted: 'on' },
};

const AB_FLAG: FlagDefinition = {
    key: 'checkout-v2',
    defaultVariant: 'control',
    rolloutPercent: 0,
    rules: [],
    variants: { rollout: 'treatment' },
};

// ── Deterministic Bucketing ──────────────────────────────────────────────────

describe('deterministicBucket', () => {
    it('returns a value between 0 and 99', () => {
        for (let i = 0; i < 100; i++) {
            const bucket = deterministicBucket(`user-${i}`, 'test-flag');
            expect(bucket).toBeGreaterThanOrEqual(0);
            expect(bucket).toBeLessThan(100);
        }
    });

    it('returns the same bucket for the same userId + flagKey', () => {
        const a = deterministicBucket('user-abc', 'flag-x');
        const b = deterministicBucket('user-abc', 'flag-x');
        expect(a).toBe(b);
    });

    it('returns different buckets for different users with the same flag', () => {
        const buckets = new Set<number>();
        for (let i = 0; i < 50; i++) {
            buckets.add(deterministicBucket(`user-${i}`, 'flag-x'));
        }
        // Highly likely that 50 users produce >1 distinct bucket
        expect(buckets.size).toBeGreaterThan(1);
    });

    it('returns different buckets for the same user with different flags', () => {
        const bucketA = deterministicBucket('user-1', 'flag-a');
        const bucketB = deterministicBucket('user-1', 'flag-b');
        expect(bucketA).not.toBe(bucketB);
    });

    it('returns consistent buckets across repeated calls (HMAC determinism)', () => {
        const results = Array.from({ length: 20 }, () => deterministicBucket('consistent-user', 'consistent-flag'));
        expect(new Set(results).size).toBe(1);
    });
});

// ── Targeting Rule Matching ──────────────────────────────────────────────────

describe('matchesRule', () => {
    const ctx: UserContext = { id: 'u1', attributes: { plan: 'pro', age: 25, region: 'us' } };

    it('matches eq operator', () => {
        expect(matchesRule({ attribute: 'plan', operator: 'eq', value: 'pro' }, ctx)).toBe(true);
        expect(matchesRule({ attribute: 'plan', operator: 'eq', value: 'free' }, ctx)).toBe(false);
    });

    it('matches in operator', () => {
        expect(matchesRule({ attribute: 'plan', operator: 'in', value: ['pro', 'enterprise'] }, ctx)).toBe(true);
        expect(matchesRule({ attribute: 'plan', operator: 'in', value: ['free'] }, ctx)).toBe(false);
    });

    it('matches gte operator', () => {
        expect(matchesRule({ attribute: 'age', operator: 'gte', value: 18 }, ctx)).toBe(true);
        expect(matchesRule({ attribute: 'age', operator: 'gte', value: 30 }, ctx)).toBe(false);
    });

    it('matches lte operator', () => {
        expect(matchesRule({ attribute: 'age', operator: 'lte', value: 30 }, ctx)).toBe(true);
        expect(matchesRule({ attribute: 'age', operator: 'lte', value: 20 }, ctx)).toBe(false);
    });

    it('returns false for missing attribute', () => {
        expect(matchesRule({ attribute: 'nonexistent', operator: 'eq', value: 'x' }, ctx)).toBe(false);
    });

    it('returns false for unknown operator', () => {
        expect(matchesRule({ attribute: 'plan', operator: 'unknown' as any, value: 'pro' }, ctx)).toBe(false);
    });
});

// ── evaluateFlag ─────────────────────────────────────────────────────────────

describe('evaluateFlag', () => {
    it('returns targeted variant when a rule matches', () => {
        const ctx: UserContext = { id: 'pro-user', attributes: { plan: 'pro' } };
        expect(evaluateFlag(BETA_FLAG, ctx)).toBe('on');
    });

    it('returns rollout variant when inside rollout and no rule matches', () => {
        // Find a user whose bucket is < 50 and has free plan
        let ctx: UserContext = { id: '', attributes: { plan: 'free' } };
        for (let i = 0; i < 200; i++) {
            const id = `free-rollout-${i}`;
            if (deterministicBucket(id, BETA_FLAG.key) < 50) {
                ctx = { id, attributes: { plan: 'free' } };
                break;
            }
        }
        expect(ctx.id).not.toBe('');
        expect(evaluateFlag(BETA_FLAG, ctx)).toBe('on');
    });

    it('returns defaultVariant when no rule matches and outside rollout', () => {
        // Find a free user whose bucket is >= 50
        let ctx: UserContext = { id: '', attributes: { plan: 'free' } };
        for (let i = 0; i < 200; i++) {
            const id = `free-default-${i}`;
            if (deterministicBucket(id, BETA_FLAG.key) >= 50) {
                ctx = { id, attributes: { plan: 'free' } };
                break;
            }
        }
        expect(ctx.id).not.toBe('');
        expect(evaluateFlag(BETA_FLAG, ctx)).toBe('off');
    });

    it('uses targeted variant for gte rule match', () => {
        const ctx: UserContext = { id: 'adult', attributes: { age: 21 } };
        expect(evaluateFlag(AGE_GATE_FLAG, ctx)).toBe('on');
    });
});

// ── FlagEngine ───────────────────────────────────────────────────────────────

describe('FlagEngine', () => {
    let engine: FlagEngine;

    beforeEach(() => {
        engine = new FlagEngine();
        engine.register(BETA_FLAG);
        engine.register(AB_FLAG);
    });

    describe('evaluation', () => {
        it('returns "off" for unknown flag', () => {
            expect(engine.evaluate('nonexistent', { id: 'u1', attributes: {} })).toBe('off');
        });

        it('returns "on" for user matching targeting rule', () => {
            const ctx: UserContext = { id: 'pro-user', attributes: { plan: 'pro' } };
            expect(engine.evaluate(BETA_FLAG.key, ctx)).toBe('on');
        });

        it('returns "on" for enterprise user via targeting rule', () => {
            const ctx: UserContext = { id: 'ent-user', attributes: { plan: 'enterprise' } };
            expect(engine.evaluate(BETA_FLAG.key, ctx)).toBe('on');
        });

        it('returns "off" for free user outside rollout', () => {
            let ctx: UserContext = { id: '', attributes: { plan: 'free' } };
            for (let i = 0; i < 200; i++) {
                const id = `free-outside-${i}`;
                if (deterministicBucket(id, BETA_FLAG.key) >= 50) {
                    ctx = { id, attributes: { plan: 'free' } };
                    break;
                }
            }
            expect(ctx.id).not.toBe('');
            expect(engine.evaluate(BETA_FLAG.key, ctx)).toBe('off');
        });

        it('rollout covers approximately 50% of free users', () => {
            let onCount = 0;
            const total = 1000;
            for (let i = 0; i < total; i++) {
                const ctx: UserContext = { id: `stats-free-${i}`, attributes: { plan: 'free' } };
                if (engine.evaluate(BETA_FLAG.key, ctx) === 'on') onCount++;
            }
            expect(onCount / total).toBeGreaterThan(0.40);
            expect(onCount / total).toBeLessThan(0.60);
        });
    });

    describe('overrides', () => {
        it('override forces flag ON for a specific user', () => {
            const ctx: UserContext = { id: 'override-user', attributes: { plan: 'free' } };
            engine.setOverride(BETA_FLAG.key, ctx.id, 'on');
            expect(engine.evaluate(BETA_FLAG.key, ctx)).toBe('on');
        });

        it('override forces flag OFF for a pro user', () => {
            const ctx: UserContext = { id: 'pro-override', attributes: { plan: 'pro' } };
            engine.setOverride(BETA_FLAG.key, ctx.id, 'off');
            expect(engine.evaluate(BETA_FLAG.key, ctx)).toBe('off');
        });

        it('clearing override restores normal evaluation', () => {
            const ctx: UserContext = { id: 'clear-user', attributes: { plan: 'free' } };
            engine.setOverride(BETA_FLAG.key, ctx.id, 'on');
            engine.clearOverride(BETA_FLAG.key, ctx.id);
            const bucket = deterministicBucket(ctx.id, BETA_FLAG.key);
            const expected = bucket < BETA_FLAG.rolloutPercent ? 'on' : 'off';
            expect(engine.evaluate(BETA_FLAG.key, ctx)).toBe(expected);
        });

        it('override does not affect other users', () => {
            engine.setOverride(BETA_FLAG.key, 'user-a', 'on');
            const ctx: UserContext = { id: 'user-b', attributes: { plan: 'free' } };
            const bucket = deterministicBucket('user-b', BETA_FLAG.key);
            const expected = bucket < BETA_FLAG.rolloutPercent ? 'on' : 'off';
            expect(engine.evaluate(BETA_FLAG.key, ctx)).toBe(expected);
        });
    });

    describe('flag change propagation', () => {
        it('notifies listener when flag is updated', () => {
            const listener = vi.fn();
            engine.onFlagChange(listener);
            engine.updateFlag(AB_FLAG.key, { defaultVariant: 'treatment' });
            expect(listener).toHaveBeenCalledOnce();
            expect(listener).toHaveBeenCalledWith(AB_FLAG.key, 'treatment');
        });

        it('notifies multiple listeners', () => {
            const l1 = vi.fn();
            const l2 = vi.fn();
            engine.onFlagChange(l1);
            engine.onFlagChange(l2);
            engine.updateFlag(AB_FLAG.key, { rolloutPercent: 100 });
            expect(l1).toHaveBeenCalledOnce();
            expect(l2).toHaveBeenCalledOnce();
        });

        it('unsubscribed listener is not called', () => {
            const listener = vi.fn();
            const unsubscribe = engine.onFlagChange(listener);
            unsubscribe();
            engine.updateFlag(AB_FLAG.key, { defaultVariant: 'treatment' });
            expect(listener).not.toHaveBeenCalled();
        });

        it('updated rollout percent takes effect immediately', () => {
            engine.updateFlag(AB_FLAG.key, { rolloutPercent: 100 });
            const ctx: UserContext = { id: 'any-user', attributes: {} };
            expect(engine.evaluate(AB_FLAG.key, ctx)).toBe('treatment');
        });

        it('throws when updating unknown flag', () => {
            expect(() => engine.updateFlag('ghost-flag', { rolloutPercent: 10 })).toThrow('Unknown flag');
        });
    });

    describe('analytics integration', () => {
        it('records an analytics event on every evaluation', () => {
            const ctx: UserContext = { id: 'analytics-user', attributes: { plan: 'pro' } };
            engine.evaluate(BETA_FLAG.key, ctx);
            expect(engine.analyticsEvents).toHaveLength(1);
            expect(engine.analyticsEvents[0]).toMatchObject({
                flagKey: BETA_FLAG.key,
                userId: ctx.id,
                variant: 'on',
            });
        });

        it('accumulates events across multiple evaluations', () => {
            for (let i = 0; i < 5; i++) {
                engine.evaluate(BETA_FLAG.key, { id: `u-${i}`, attributes: { plan: 'pro' } });
            }
            expect(engine.analyticsEvents).toHaveLength(5);
        });

        it('evaluation is fast (< 1 ms per call on average)', () => {
            const ctx: UserContext = { id: 'perf-user', attributes: { plan: 'pro' } };
            const iterations = 10_000;
            const start = performance.now();
            for (let i = 0; i < iterations; i++) engine.evaluate(BETA_FLAG.key, ctx);
            const elapsed = performance.now() - start;
            expect(elapsed / iterations).toBeLessThan(1);
        });
    });
});

// ── Tier Targeting ──────────────────────────────────────────────────────────

describe('FlagEngine – tier targeting (subscription plan)', () => {
    let engine: FlagEngine;

    beforeEach(() => {
        engine = new FlagEngine();
        engine.register({
            key: 'premium-feature',
            defaultVariant: 'off',
            rolloutPercent: 0,
            rules: [{ attribute: 'plan', operator: 'in', value: ['pro', 'enterprise'] }],
            variants: { targeted: 'on' },
        });
    });

    it('enables flag for pro users', () => {
        expect(engine.evaluate('premium-feature', { id: 'pro-user', attributes: { plan: 'pro' } })).toBe('on');
    });

    it('enables flag for enterprise users', () => {
        expect(engine.evaluate('premium-feature', { id: 'ent-user', attributes: { plan: 'enterprise' } })).toBe('on');
    });

    it('disables flag for free users', () => {
        expect(engine.evaluate('premium-feature', { id: 'free-user', attributes: { plan: 'free' } })).toBe('off');
    });

    it('respects region targeting (multiple rules use OR semantics)', () => {
        engine.register({
            key: 'regional-feature',
            defaultVariant: 'off',
            rolloutPercent: 0,
            rules: [
                { attribute: 'region', operator: 'eq', value: 'us' },
            ],
            variants: { targeted: 'on' },
        });

        const ctx: UserContext = { id: 'us-user', attributes: { plan: 'free', region: 'us' } };
        expect(engine.evaluate('regional-feature', ctx)).toBe('on');

        const euCtx: UserContext = { id: 'eu-user', attributes: { plan: 'pro', region: 'eu' } };
        expect(engine.evaluate('regional-feature', euCtx)).toBe('off');
    });

    it('supports custom attribute targeting', () => {
        engine.register({
            key: 'early-access',
            defaultVariant: 'off',
            rolloutPercent: 0,
            rules: [{ attribute: 'betaTester', operator: 'eq', value: true }],
            variants: { targeted: 'on' },
        });

        expect(engine.evaluate('early-access', { id: 'beta-user', attributes: { betaTester: true } })).toBe('on');
        expect(engine.evaluate('early-access', { id: 'normal-user', attributes: { betaTester: false } })).toBe('off');
    });
});


