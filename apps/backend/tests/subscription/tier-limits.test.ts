/**
 * Subscription Tier Limit Tests
 *
 * Comprehensive tests for subscription tier enforcement:
 * - Deployment limits for each tier
 * - Custom domain restrictions
 * - Feature access by tier
 * - Upgrade prompts
 * - Tier limit edge cases
 *
 * Run: vitest run tests/subscription/tier-limits.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';

interface TierLimits {
  maxDeployments: number;
  maxCustomDomains: number;
  analyticsEnabled: boolean;
  supportLevel: 'community' | 'email' | 'priority' | 'dedicated';
  features: string[];
}

interface UserSubscription {
  userId: string;
  tier: SubscriptionTier;
  deploymentCount: number;
  customDomainCount: number;
  createdAt: Date;
}

interface FeatureAccess {
  feature: string;
  enabled: boolean;
  tier: SubscriptionTier;
}

interface UpgradePrompt {
  feature: string;
  currentTier: SubscriptionTier;
  requiredTier: SubscriptionTier;
  message: string;
}

class SubscriptionTierManager {
  private tierLimits: Record<SubscriptionTier, TierLimits> = {
    free: {
      maxDeployments: 1,
      maxCustomDomains: 0,
      analyticsEnabled: false,
      supportLevel: 'community',
      features: ['basic_deployment', 'testnet_only'],
    },
    starter: {
      maxDeployments: 3,
      maxCustomDomains: 1,
      analyticsEnabled: true,
      supportLevel: 'email',
      features: ['basic_deployment', 'testnet_only', 'analytics', 'email_support'],
    },
    pro: {
      maxDeployments: 10,
      maxCustomDomains: 5,
      analyticsEnabled: true,
      supportLevel: 'priority',
      features: [
        'basic_deployment',
        'mainnet_support',
        'analytics',
        'priority_support',
        'custom_branding',
        'api_access',
      ],
    },
    enterprise: {
      maxDeployments: -1, // unlimited
      maxCustomDomains: -1,
      analyticsEnabled: true,
      supportLevel: 'dedicated',
      features: [
        'basic_deployment',
        'mainnet_support',
        'analytics',
        'dedicated_support',
        'custom_branding',
        'api_access',
        'sso',
        'audit_logs',
      ],
    },
  };

  private subscriptions: Map<string, UserSubscription> = new Map();

  /**
   * Create subscription for user
   */
  createSubscription(userId: string, tier: SubscriptionTier): UserSubscription {
    const subscription: UserSubscription = {
      userId,
      tier,
      deploymentCount: 0,
      customDomainCount: 0,
      createdAt: new Date(),
    };

    this.subscriptions.set(userId, subscription);
    return subscription;
  }

  /**
   * Get tier limits
   */
  getTierLimits(tier: SubscriptionTier): TierLimits {
    return this.tierLimits[tier];
  }

  /**
   * Check if deployment limit reached
   */
  canCreateDeployment(userId: string): { allowed: boolean; reason?: string } {
    const subscription = this.subscriptions.get(userId);
    if (!subscription) {
      return { allowed: false, reason: 'Subscription not found' };
    }

    const limits = this.tierLimits[subscription.tier];
    if (limits.maxDeployments === -1) {
      return { allowed: true };
    }

    if (subscription.deploymentCount >= limits.maxDeployments) {
      return {
        allowed: false,
        reason: `Deployment limit (${limits.maxDeployments}) reached for ${subscription.tier} tier`,
      };
    }

    return { allowed: true };
  }

  /**
   * Create deployment
   */
  createDeployment(userId: string): { success: boolean; error?: string } {
    const canCreate = this.canCreateDeployment(userId);
    if (!canCreate.allowed) {
      return { success: false, error: canCreate.reason };
    }

    const subscription = this.subscriptions.get(userId);
    if (subscription) {
      subscription.deploymentCount++;
    }

    return { success: true };
  }

  /**
   * Check if custom domain limit reached
   */
  canAddCustomDomain(userId: string): { allowed: boolean; reason?: string } {
    const subscription = this.subscriptions.get(userId);
    if (!subscription) {
      return { allowed: false, reason: 'Subscription not found' };
    }

    const limits = this.tierLimits[subscription.tier];
    if (limits.maxCustomDomains === -1) {
      return { allowed: true };
    }

    if (subscription.customDomainCount >= limits.maxCustomDomains) {
      return {
        allowed: false,
        reason: `Custom domain limit (${limits.maxCustomDomains}) reached for ${subscription.tier} tier`,
      };
    }

    return { allowed: true };
  }

  /**
   * Add custom domain
   */
  addCustomDomain(userId: string): { success: boolean; error?: string } {
    const canAdd = this.canAddCustomDomain(userId);
    if (!canAdd.allowed) {
      return { success: false, error: canAdd.reason };
    }

    const subscription = this.subscriptions.get(userId);
    if (subscription) {
      subscription.customDomainCount++;
    }

    return { success: true };
  }

  /**
   * Check feature access
   */
  hasFeatureAccess(userId: string, feature: string): FeatureAccess {
    const subscription = this.subscriptions.get(userId);
    if (!subscription) {
      return { feature, enabled: false, tier: 'free' };
    }

    const limits = this.tierLimits[subscription.tier];
    const enabled = limits.features.includes(feature);

    return { feature, enabled, tier: subscription.tier };
  }

  /**
   * Get upgrade prompt
   */
  getUpgradePrompt(userId: string, feature: string): UpgradePrompt | null {
    const subscription = this.subscriptions.get(userId);
    if (!subscription) {
      return null;
    }

    const access = this.hasFeatureAccess(userId, feature);
    if (access.enabled) {
      return null;
    }

    // Find minimum tier that has this feature
    let requiredTier: SubscriptionTier = 'enterprise';
    for (const [tier, limits] of Object.entries(this.tierLimits)) {
      if (limits.features.includes(feature)) {
        requiredTier = tier as SubscriptionTier;
        break;
      }
    }

    return {
      feature,
      currentTier: subscription.tier,
      requiredTier,
      message: `Upgrade to ${requiredTier} tier to access ${feature}`,
    };
  }

  /**
   * Get user subscription
   */
  getSubscription(userId: string): UserSubscription | undefined {
    return this.subscriptions.get(userId);
  }

  /**
   * Upgrade subscription
   */
  upgradeSubscription(userId: string, newTier: SubscriptionTier): { success: boolean; error?: string } {
    const subscription = this.subscriptions.get(userId);
    if (!subscription) {
      return { success: false, error: 'Subscription not found' };
    }

    const tierOrder: SubscriptionTier[] = ['free', 'starter', 'pro', 'enterprise'];
    const currentIndex = tierOrder.indexOf(subscription.tier);
    const newIndex = tierOrder.indexOf(newTier);

    if (newIndex <= currentIndex) {
      return { success: false, error: 'Can only upgrade to higher tiers' };
    }

    subscription.tier = newTier;
    return { success: true };
  }

  /**
   * Clear subscriptions for testing
   */
  clearSubscriptions(): void {
    this.subscriptions.clear();
  }
}

describe('Subscription Tier Limits', () => {
  let tierManager: SubscriptionTierManager;
  const userId = 'user_test123';

  beforeEach(() => {
    tierManager = new SubscriptionTierManager();
  });

  describe('Deployment Limits', () => {
    it('should enforce free tier deployment limit', () => {
      tierManager.createSubscription(userId, 'free');

      const result1 = tierManager.createDeployment(userId);
      expect(result1.success).toBe(true);

      const result2 = tierManager.createDeployment(userId);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('limit');
    });

    it('should enforce starter tier deployment limit', () => {
      tierManager.createSubscription(userId, 'starter');

      for (let i = 0; i < 3; i++) {
        const result = tierManager.createDeployment(userId);
        expect(result.success).toBe(true);
      }

      const result = tierManager.createDeployment(userId);
      expect(result.success).toBe(false);
    });

    it('should enforce pro tier deployment limit', () => {
      tierManager.createSubscription(userId, 'pro');

      for (let i = 0; i < 10; i++) {
        const result = tierManager.createDeployment(userId);
        expect(result.success).toBe(true);
      }

      const result = tierManager.createDeployment(userId);
      expect(result.success).toBe(false);
    });

    it('should allow unlimited deployments for enterprise tier', () => {
      tierManager.createSubscription(userId, 'enterprise');

      for (let i = 0; i < 50; i++) {
        const result = tierManager.createDeployment(userId);
        expect(result.success).toBe(true);
      }
    });

    it('should check deployment limits before creation', () => {
      tierManager.createSubscription(userId, 'free');

      const canCreate1 = tierManager.canCreateDeployment(userId);
      expect(canCreate1.allowed).toBe(true);

      tierManager.createDeployment(userId);

      const canCreate2 = tierManager.canCreateDeployment(userId);
      expect(canCreate2.allowed).toBe(false);
    });
  });

  describe('Custom Domain Restrictions', () => {
    it('should prevent custom domains on free tier', () => {
      tierManager.createSubscription(userId, 'free');

      const result = tierManager.addCustomDomain(userId);
      expect(result.success).toBe(false);
      expect(result.error).toContain('limit');
    });

    it('should allow one custom domain on starter tier', () => {
      tierManager.createSubscription(userId, 'starter');

      const result1 = tierManager.addCustomDomain(userId);
      expect(result1.success).toBe(true);

      const result2 = tierManager.addCustomDomain(userId);
      expect(result2.success).toBe(false);
    });

    it('should allow multiple custom domains on pro tier', () => {
      tierManager.createSubscription(userId, 'pro');

      for (let i = 0; i < 5; i++) {
        const result = tierManager.addCustomDomain(userId);
        expect(result.success).toBe(true);
      }

      const result = tierManager.addCustomDomain(userId);
      expect(result.success).toBe(false);
    });

    it('should allow unlimited custom domains on enterprise tier', () => {
      tierManager.createSubscription(userId, 'enterprise');

      for (let i = 0; i < 20; i++) {
        const result = tierManager.addCustomDomain(userId);
        expect(result.success).toBe(true);
      }
    });

    it('should check custom domain limits before addition', () => {
      tierManager.createSubscription(userId, 'starter');

      const canAdd1 = tierManager.canAddCustomDomain(userId);
      expect(canAdd1.allowed).toBe(true);

      tierManager.addCustomDomain(userId);

      const canAdd2 = tierManager.canAddCustomDomain(userId);
      expect(canAdd2.allowed).toBe(false);
    });
  });

  describe('Feature Access by Tier', () => {
    it('should restrict analytics to paid tiers', () => {
      tierManager.createSubscription(userId, 'free');
      const freeAccess = tierManager.hasFeatureAccess(userId, 'analytics');
      expect(freeAccess.enabled).toBe(false);

      tierManager.createSubscription(userId, 'starter');
      const starterAccess = tierManager.hasFeatureAccess(userId, 'analytics');
      expect(starterAccess.enabled).toBe(true);
    });

    it('should restrict mainnet support to pro and enterprise', () => {
      tierManager.createSubscription(userId, 'free');
      const freeAccess = tierManager.hasFeatureAccess(userId, 'mainnet_support');
      expect(freeAccess.enabled).toBe(false);

      tierManager.createSubscription(userId, 'pro');
      const proAccess = tierManager.hasFeatureAccess(userId, 'mainnet_support');
      expect(proAccess.enabled).toBe(true);
    });

    it('should restrict SSO to enterprise tier', () => {
      const tiers: SubscriptionTier[] = ['free', 'starter', 'pro'];

      tiers.forEach((tier) => {
        tierManager.createSubscription(userId, tier);
        const access = tierManager.hasFeatureAccess(userId, 'sso');
        expect(access.enabled).toBe(false);
      });

      tierManager.createSubscription(userId, 'enterprise');
      const enterpriseAccess = tierManager.hasFeatureAccess(userId, 'sso');
      expect(enterpriseAccess.enabled).toBe(true);
    });

    it('should provide all features for enterprise tier', () => {
      tierManager.createSubscription(userId, 'enterprise');
      const limits = tierManager.getTierLimits('enterprise');

      const features = [
        'basic_deployment',
        'mainnet_support',
        'analytics',
        'dedicated_support',
        'custom_branding',
        'api_access',
        'sso',
        'audit_logs',
      ];

      features.forEach((feature) => {
        const access = tierManager.hasFeatureAccess(userId, feature);
        expect(access.enabled).toBe(true);
      });
    });
  });

  describe('Upgrade Prompts', () => {
    it('should show upgrade prompt for restricted features', () => {
      tierManager.createSubscription(userId, 'free');

      const prompt = tierManager.getUpgradePrompt(userId, 'analytics');
      expect(prompt).not.toBeNull();
      expect(prompt?.currentTier).toBe('free');
      expect(prompt?.requiredTier).toBe('starter');
      expect(prompt?.message).toContain('Upgrade');
    });

    it('should not show upgrade prompt for available features', () => {
      tierManager.createSubscription(userId, 'pro');

      const prompt = tierManager.getUpgradePrompt(userId, 'analytics');
      expect(prompt).toBeNull();
    });

    it('should show correct upgrade path', () => {
      tierManager.createSubscription(userId, 'starter');

      const prompt = tierManager.getUpgradePrompt(userId, 'mainnet_support');
      expect(prompt?.requiredTier).toBe('pro');
    });

    it('should include feature name in upgrade message', () => {
      tierManager.createSubscription(userId, 'free');

      const prompt = tierManager.getUpgradePrompt(userId, 'api_access');
      expect(prompt?.message).toContain('api_access');
    });
  });

  describe('Tier Limit Edge Cases', () => {
    it('should handle subscription not found', () => {
      const result = tierManager.canCreateDeployment('nonexistent_user');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should not allow downgrade', () => {
      tierManager.createSubscription(userId, 'pro');

      const result = tierManager.upgradeSubscription(userId, 'starter');
      expect(result.success).toBe(false);
      expect(result.error).toContain('higher');
    });

    it('should allow upgrade to higher tier', () => {
      tierManager.createSubscription(userId, 'free');

      const result = tierManager.upgradeSubscription(userId, 'pro');
      expect(result.success).toBe(true);

      const subscription = tierManager.getSubscription(userId);
      expect(subscription?.tier).toBe('pro');
    });

    it('should reset limits after upgrade', () => {
      tierManager.createSubscription(userId, 'free');
      tierManager.createDeployment(userId);

      const canCreateBefore = tierManager.canCreateDeployment(userId);
      expect(canCreateBefore.allowed).toBe(false);

      tierManager.upgradeSubscription(userId, 'starter');

      const canCreateAfter = tierManager.canCreateDeployment(userId);
      expect(canCreateAfter.allowed).toBe(true);
    });

    it('should handle multiple deployments and domains', () => {
      tierManager.createSubscription(userId, 'pro');

      for (let i = 0; i < 5; i++) {
        const deployResult = tierManager.createDeployment(userId);
        expect(deployResult.success).toBe(true);

        const domainResult = tierManager.addCustomDomain(userId);
        expect(domainResult.success).toBe(true);
      }

      const subscription = tierManager.getSubscription(userId);
      expect(subscription?.deploymentCount).toBe(5);
      expect(subscription?.customDomainCount).toBe(5);
    });

    it('should enforce limits independently', () => {
      tierManager.createSubscription(userId, 'starter');

      // Reach deployment limit
      tierManager.createDeployment(userId);
      tierManager.createDeployment(userId);
      tierManager.createDeployment(userId);

      const deploymentLimitReached = tierManager.canCreateDeployment(userId);
      expect(deploymentLimitReached.allowed).toBe(false);

      // Should still be able to add custom domain
      const canAddDomain = tierManager.canAddCustomDomain(userId);
      expect(canAddDomain.allowed).toBe(true);
    });
  });

  describe('Tier Limits Configuration', () => {
    it('should have correct free tier limits', () => {
      const limits = tierManager.getTierLimits('free');
      expect(limits.maxDeployments).toBe(1);
      expect(limits.maxCustomDomains).toBe(0);
      expect(limits.analyticsEnabled).toBe(false);
      expect(limits.supportLevel).toBe('community');
    });

    it('should have correct starter tier limits', () => {
      const limits = tierManager.getTierLimits('starter');
      expect(limits.maxDeployments).toBe(3);
      expect(limits.maxCustomDomains).toBe(1);
      expect(limits.analyticsEnabled).toBe(true);
      expect(limits.supportLevel).toBe('email');
    });

    it('should have correct pro tier limits', () => {
      const limits = tierManager.getTierLimits('pro');
      expect(limits.maxDeployments).toBe(10);
      expect(limits.maxCustomDomains).toBe(5);
      expect(limits.analyticsEnabled).toBe(true);
      expect(limits.supportLevel).toBe('priority');
    });

    it('should have unlimited enterprise tier limits', () => {
      const limits = tierManager.getTierLimits('enterprise');
      expect(limits.maxDeployments).toBe(-1);
      expect(limits.maxCustomDomains).toBe(-1);
      expect(limits.analyticsEnabled).toBe(true);
      expect(limits.supportLevel).toBe('dedicated');
    });
  });
});
