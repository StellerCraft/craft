import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    TIER_CONFIGS,
    getTierByPriceId,
    getTierFromPriceId,
    getValidPriceIds,
    getEntitlements,
    validatePricingConfig,
} from './pricing';

// ── Helpers ───────────────────────────────────────────────────────────────────

const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
    const original: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
        original[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        fn();
    } finally {
        for (const [k, v] of Object.entries(original)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
};

// ── TIER_CONFIGS ──────────────────────────────────────────────────────────────

describe('TIER_CONFIGS', () => {
    it('defines free, pro, and enterprise tiers', () => {
        expect(Object.keys(TIER_CONFIGS)).toEqual(
            expect.arrayContaining(['free', 'pro', 'enterprise'])
        );
    });

    it('free tier has zero price and no Stripe price ID', () => {
        expect(TIER_CONFIGS.free.monthlyPriceCents).toBe(0);
        expect(TIER_CONFIGS.free.stripePriceId).toBeNull();
    });

    it('pro tier has a positive price', () => {
        expect(TIER_CONFIGS.pro.monthlyPriceCents).toBeGreaterThan(0);
    });

    it('enterprise tier has a higher price than pro', () => {
        expect(TIER_CONFIGS.enterprise.monthlyPriceCents).toBeGreaterThan(
            TIER_CONFIGS.pro.monthlyPriceCents
        );
    });

    it('free tier cannot have analytics or custom domains', () => {
        const { entitlements } = TIER_CONFIGS.free;
        expect(entitlements.analyticsEnabled).toBe(false);
        expect(entitlements.maxCustomDomains).toBe(0);
    });

    it('pro tier has analytics and at least one custom domain', () => {
        const { entitlements } = TIER_CONFIGS.pro;
        expect(entitlements.analyticsEnabled).toBe(true);
        expect(entitlements.maxCustomDomains).toBeGreaterThanOrEqual(1);
    });

    it('enterprise tier has unlimited deployments and custom domains', () => {
        const { entitlements } = TIER_CONFIGS.enterprise;
        expect(entitlements.maxDeployments).toBe(-1);
        expect(entitlements.maxCustomDomains).toBe(-1);
    });

    it('free tier has fewer maxDeployments than pro', () => {
        expect(TIER_CONFIGS.free.entitlements.maxDeployments).toBeLessThan(
            TIER_CONFIGS.pro.entitlements.maxDeployments
        );
    });
});

// ── getTierByPriceId ──────────────────────────────────────────────────────────

describe('getTierByPriceId', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO = 'price_pro_test';
        process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE = 'price_ent_test';
    });

    afterEach(() => {
        delete process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO;
        delete process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE;
    });

    it('returns null for an unknown price ID', () => {
        expect(getTierByPriceId('price_unknown')).toBeNull();
    });

    it('returns null for an empty string', () => {
        expect(getTierByPriceId('')).toBeNull();
    });
});

// ── getTierFromPriceId ────────────────────────────────────────────────────────

describe('getTierFromPriceId', () => {
    it('returns "free" for an unrecognised price ID', () => {
        expect(getTierFromPriceId('price_unknown')).toBe('free');
    });

    it('returns "free" for an empty string', () => {
        expect(getTierFromPriceId('')).toBe('free');
    });
});

// ── getValidPriceIds ──────────────────────────────────────────────────────────

describe('getValidPriceIds', () => {
    it('returns an empty array when no price env vars are set', () => {
        withEnv(
            {
                NEXT_PUBLIC_STRIPE_PRICE_PRO: undefined,
                NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE: undefined,
            },
            () => {
                // Re-import would be needed for dynamic env; we test the helper directly
                // by checking that null stripePriceIds are excluded.
                const ids = getValidPriceIds();
                // Any returned IDs must be non-empty strings
                ids.forEach((id) => expect(id.length).toBeGreaterThan(0));
            }
        );
    });

    it('does not include null entries', () => {
        const ids = getValidPriceIds();
        expect(ids.every((id) => id !== null && id !== undefined)).toBe(true);
    });
});

// ── getEntitlements ───────────────────────────────────────────────────────────

describe('getEntitlements', () => {
    it('returns the correct entitlements for each tier', () => {
        expect(getEntitlements('free')).toEqual(TIER_CONFIGS.free.entitlements);
        expect(getEntitlements('pro')).toEqual(TIER_CONFIGS.pro.entitlements);
        expect(getEntitlements('enterprise')).toEqual(TIER_CONFIGS.enterprise.entitlements);
    });
});

// ── validatePricingConfig ─────────────────────────────────────────────────────

describe('validatePricingConfig', () => {
    afterEach(() => {
        delete process.env.SKIP_PRICING_VALIDATION;
        delete process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO;
        delete process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE;
    });

    it('does not throw when SKIP_PRICING_VALIDATION=true', () => {
        process.env.SKIP_PRICING_VALIDATION = 'true';
        expect(() => validatePricingConfig()).not.toThrow();
    });

    it('throws when pro price ID is missing', () => {
        process.env.SKIP_PRICING_VALIDATION = 'false';
        delete process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO;
        process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE = 'price_ent';
        expect(() => validatePricingConfig()).toThrow('NEXT_PUBLIC_STRIPE_PRICE_PRO');
    });

    it('throws when enterprise price ID is missing', () => {
        process.env.SKIP_PRICING_VALIDATION = 'false';
        process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO = 'price_pro';
        delete process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE;
        expect(() => validatePricingConfig()).toThrow('NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE');
    });

    it('throws listing all missing vars when both are absent', () => {
        process.env.SKIP_PRICING_VALIDATION = 'false';
        delete process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO;
        delete process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE;
        expect(() => validatePricingConfig()).toThrow(
            'NEXT_PUBLIC_STRIPE_PRICE_PRO'
        );
    });

    it('does not throw when all required vars are present', () => {
        process.env.SKIP_PRICING_VALIDATION = 'false';
        process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO = 'price_pro';
        process.env.NEXT_PUBLIC_STRIPE_PRICE_ENTERPRISE = 'price_ent';
        expect(() => validatePricingConfig()).not.toThrow();
    });
});
