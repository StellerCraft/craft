/**
 * @vitest-environment jsdom
 *
 * Boundary coverage for TierUsageIndicators' normal / warning / critical
 * thresholds (issue #1333).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TierUsageIndicators,
  getUsageInfo,
  WARNING_THRESHOLD_PERCENT,
  type UsageState,
} from './TierUsageIndicators';

const entitlements = vi.hoisted(() => ({ maxDeployments: 100, maxCustomDomains: 100 }));

vi.mock('@/lib/stripe/pricing', () => ({
  TIER_CONFIGS: {
    free: { displayName: 'Free' },
    pro: { displayName: 'Pro' },
    enterprise: { displayName: 'Enterprise' },
  },
  getEntitlements: () => ({ ...entitlements }),
}));

describe('getUsageInfo', () => {
  it('uses an 80% warning threshold', () => {
    expect(WARNING_THRESHOLD_PERCENT).toBe(80);
  });

  describe('warning threshold boundaries (limit = 100)', () => {
    it.each<[number, UsageState, number]>([
      [0, 'normal', 0],
      [79, 'normal', 79],
      [80, 'warning', 80],
      [81, 'warning', 81],
      [99, 'warning', 99],
      [100, 'critical', 100],
    ])('used %i → %s at %i%%', (used, state, percent) => {
      expect(getUsageInfo(used, 100)).toEqual({ used, limit: 100, percent, state });
    });
  });

  it('applies rounding before comparing against the threshold', () => {
    // 79.4% rounds down → normal; 79.5% rounds up to 80% → warning.
    expect(getUsageInfo(794, 1000)).toMatchObject({ percent: 79, state: 'normal' });
    expect(getUsageInfo(795, 1000)).toMatchObject({ percent: 80, state: 'warning' });
  });

  it('crosses the threshold at the same point for small limits', () => {
    expect(getUsageInfo(7, 10)).toMatchObject({ percent: 70, state: 'normal' });
    expect(getUsageInfo(8, 10)).toMatchObject({ percent: 80, state: 'warning' });
    expect(getUsageInfo(10, 10)).toMatchObject({ percent: 100, state: 'critical' });
  });

  it('reports critical and caps percent at 100 when usage exceeds the limit', () => {
    expect(getUsageInfo(150, 100)).toEqual({ used: 150, limit: 100, percent: 100, state: 'critical' });
    expect(getUsageInfo(11, 10)).toMatchObject({ percent: 100, state: 'critical' });
  });

  it('treats limit -1 as unlimited regardless of usage', () => {
    for (const used of [0, 1, 80, 10_000]) {
      expect(getUsageInfo(used, -1)).toEqual({ used, limit: -1, percent: 0, state: 'normal' });
    }
  });

  describe('limit 0 (zero allowance)', () => {
    it('never produces a non-finite or out-of-range percent', () => {
      for (const used of [0, 1, 5]) {
        const { percent } = getUsageInfo(used, 0);
        expect(Number.isFinite(percent)).toBe(true);
        expect(percent).toBeGreaterThanOrEqual(0);
        expect(percent).toBeLessThanOrEqual(100);
      }
    });

    it('reports critical once any usage is recorded against a zero allowance', () => {
      expect(getUsageInfo(1, 0).state).toBe('critical');
    });
  });

  it('clamps negative usage to zero', () => {
    expect(getUsageInfo(-5, 100)).toEqual({ used: 0, limit: 100, percent: 0, state: 'normal' });
  });
});

/** Captures the parts of the rendered deployments indicator that vary by state. */
function renderedDeploymentIndicator() {
  const bar = screen.getByRole('progressbar', { name: 'Deployments usage' });
  const fill = bar.firstElementChild as HTMLElement;
  const counter = screen.getByTestId('deployments-usage').querySelector('p.text-xs') as HTMLElement;
  return {
    counterText: counter.textContent,
    counterClass: counter.className,
    fillClass: fill.className,
    fillWidth: fill.style.width,
    ariaValueNow: bar.getAttribute('aria-valuenow'),
    ariaValueMax: bar.getAttribute('aria-valuemax'),
    warning: screen.queryByTestId('deployments-warning')?.textContent ?? null,
    critical: screen.queryByTestId('deployments-critical')?.textContent ?? null,
  };
}

describe('TierUsageIndicators rendered state', () => {
  beforeEach(() => {
    entitlements.maxDeployments = 100;
    entitlements.maxCustomDomains = 0;
  });

  it('renders the normal state just below the threshold (79%)', () => {
    render(<TierUsageIndicators tier="pro" activeDeployments={79} activeCustomDomains={0} />);
    expect(renderedDeploymentIndicator()).toEqual({
      counterText: '79 / 100',
      counterClass: 'text-xs text-on-surface-variant',
      fillClass: 'h-2 rounded-full transition-all bg-primary',
      fillWidth: '79%',
      ariaValueNow: '79',
      ariaValueMax: '100',
      warning: null,
      critical: null,
    });
  });

  it('renders the warning state at the threshold (80%)', () => {
    render(<TierUsageIndicators tier="pro" activeDeployments={80} activeCustomDomains={0} />);
    expect(renderedDeploymentIndicator()).toEqual({
      counterText: '80 / 100',
      counterClass: 'text-xs text-surface-tint',
      fillClass: 'h-2 rounded-full transition-all bg-surface-tint',
      fillWidth: '80%',
      ariaValueNow: '80',
      ariaValueMax: '100',
      warning: 'Approaching deployments limit.',
      critical: null,
    });
  });

  it('renders the critical state at the limit (100%)', () => {
    render(<TierUsageIndicators tier="pro" activeDeployments={100} activeCustomDomains={0} />);
    expect(renderedDeploymentIndicator()).toEqual({
      counterText: '100 / 100',
      counterClass: 'text-xs text-error',
      fillClass: 'h-2 rounded-full transition-all bg-error',
      fillWidth: '100%',
      ariaValueNow: '100',
      ariaValueMax: '100',
      warning: null,
      critical: 'Deployments limit reached.',
    });
  });

  it('renders the critical state with a capped bar when over the limit', () => {
    render(<TierUsageIndicators tier="pro" activeDeployments={130} activeCustomDomains={0} />);
    expect(renderedDeploymentIndicator()).toEqual({
      counterText: '130 / 100',
      counterClass: 'text-xs text-error',
      fillClass: 'h-2 rounded-full transition-all bg-error',
      fillWidth: '100%',
      ariaValueNow: '100',
      ariaValueMax: '100',
      warning: null,
      critical: 'Deployments limit reached.',
    });
  });

  it('renders the unlimited indicator for limit -1', () => {
    entitlements.maxDeployments = -1;
    render(<TierUsageIndicators tier="enterprise" activeDeployments={42} activeCustomDomains={0} />);

    const unlimited = screen.getByTestId('deployments-usage-unlimited');
    expect(unlimited.textContent).toContain('42 used / Unlimited');
    expect(screen.queryByRole('progressbar', { name: 'Deployments usage' })).toBeNull();
    expect(screen.queryByTestId('deployments-warning')).toBeNull();
    expect(screen.queryByTestId('deployments-critical')).toBeNull();
  });

  it('hides the domains indicator for a zero domain allowance', () => {
    render(<TierUsageIndicators tier="free" activeDeployments={0} activeCustomDomains={0} />);
    expect(screen.queryByRole('progressbar', { name: 'Domains usage' })).toBeNull();
  });
});
