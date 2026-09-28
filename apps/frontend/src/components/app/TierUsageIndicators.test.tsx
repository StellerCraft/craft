/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TierUsageIndicators, getUsageInfo } from './TierUsageIndicators';

vi.mock('@/lib/stripe/pricing', () => ({
  TIER_CONFIGS: {
    free: { displayName: 'Free' },
    pro: { displayName: 'Pro' },
    enterprise: { displayName: 'Enterprise' },
  },
  getEntitlements: (tier: 'free' | 'pro' | 'enterprise') => {
    if (tier === 'free') {
      return { maxDeployments: 1, maxCustomDomains: 0 };
    }
    if (tier === 'pro') {
      return { maxDeployments: 10, maxCustomDomains: 1 };
    }
    return { maxDeployments: -1, maxCustomDomains: -1 };
  },
}));

describe('TierUsageIndicators', () => {
  it('renders deployment progress for all tiers', () => {
    render(
      <TierUsageIndicators
        tier="free"
        activeDeployments={1}
        activeCustomDomains={0}
      />
    );

    expect(screen.getByLabelText('Deployments usage')).toBeDefined();
  });

  it('shows domain usage for pro and enterprise tiers only', () => {
    const { rerender } = render(
      <TierUsageIndicators
        tier="free"
        activeDeployments={0}
        activeCustomDomains={0}
      />
    );

    expect(screen.queryByLabelText('Domains usage')).toBeNull();
    expect(screen.getByTestId('domains-usage-unavailable')).toBeDefined();

    rerender(
      <TierUsageIndicators
        tier="pro"
        activeDeployments={1}
        activeCustomDomains={1}
      />
    );

    expect(screen.getByLabelText('Domains usage')).toBeDefined();
  });

  it('shows warning state when usage is approaching deployment limit', () => {
    render(
      <TierUsageIndicators
        tier="pro"
        activeDeployments={8}
        activeCustomDomains={0}
      />
    );

    expect(screen.getByTestId('deployments-warning')).toBeDefined();
  });

  it('shows critical state when limit is reached', () => {
    render(
      <TierUsageIndicators
        tier="pro"
        activeDeployments={10}
        activeCustomDomains={1}
      />
    );

    expect(screen.getByTestId('deployments-critical')).toBeDefined();
    expect(screen.getByTestId('domains-critical')).toBeDefined();
  });

  it('shows unlimited indicators for enterprise tier', () => {
    render(
      <TierUsageIndicators
        tier="enterprise"
        activeDeployments={32}
        activeCustomDomains={6}
      />
    );

    expect(screen.getByTestId('deployments-usage-unlimited')).toBeDefined();
    expect(screen.getByTestId('domains-usage-unlimited')).toBeDefined();
  });

  it('renders a zero-allowance limit as "not available on your tier" rather than 0 of 1', () => {
    render(
      <TierUsageIndicators
        tier="free"
        activeDeployments={0}
        activeCustomDomains={0}
      />
    );

    const unavailable = screen.getByTestId('domains-usage-unavailable');
    expect(unavailable.textContent).toContain('not available on your current tier');
    expect(unavailable.textContent).not.toContain('0 / 1');
    expect(screen.queryByTestId('domains-usage')).toBeNull();
    expect(screen.queryByTestId('domains-usage-unlimited')).toBeNull();
  });

  describe('getUsageInfo', () => {
    it('treats limit === 0 as an explicit unavailable state', () => {
      expect(getUsageInfo(0, 0)).toEqual({ used: 0, limit: 0, percent: 0, state: 'unavailable' });
    });

    it('keeps limit === -1 as unlimited', () => {
      expect(getUsageInfo(5, -1)).toEqual({ used: 5, limit: -1, percent: 0, state: 'normal' });
    });

    it('computes a normal positive-limit case', () => {
      expect(getUsageInfo(2, 10)).toEqual({ used: 2, limit: 10, percent: 20, state: 'normal' });
    });

    it('still clamps an invalid limit instead of dividing by zero', () => {
      expect(getUsageInfo(0, Number.NaN).limit).toBe(1);
      expect(getUsageInfo(0, -5).limit).toBe(1);
    });
  });
});
