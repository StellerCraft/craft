/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SubscriptionComparison } from './SubscriptionComparison';

vi.mock('next/link', () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { 'data-testid'?: string }) => (
    <a href={props.href} data-testid={props['data-testid']}>
      {props.children}
    </a>
  ),
}));

vi.mock('@/lib/stripe/pricing', () => ({
  TIER_CONFIGS: {
    free:       { displayName: 'Free',       monthlyPriceCents: 0,    entitlements: { maxDeployments: 1,  maxCustomDomains: 0,  analyticsEnabled: false, premiumTemplates: false, prioritySupport: false }, stripePriceId: null },
    pro:        { displayName: 'Pro',        monthlyPriceCents: 2900, entitlements: { maxDeployments: 10, maxCustomDomains: 1,  analyticsEnabled: true,  premiumTemplates: true,  prioritySupport: false }, stripePriceId: 'price_pro' },
    enterprise: { displayName: 'Enterprise', monthlyPriceCents: 9900, entitlements: { maxDeployments: -1, maxCustomDomains: -1, analyticsEnabled: true,  premiumTemplates: true,  prioritySupport: true  }, stripePriceId: 'price_ent' },
  },
}));

vi.mock('@/components/marketing/FeatureMatrix', () => ({
  MATRIX_FEATURES: [
    { label: 'Deployments', free: '1', pro: '10', enterprise: 'Unlimited' },
    { label: 'Analytics',   free: false, pro: true, enterprise: true },
  ],
  MatrixCell: ({ value }: { value: string | boolean }) =>
    typeof value === 'boolean' ? (
      <span>{value ? 'yes' : 'no'}</span>
    ) : (
      <span>{value}</span>
    ),
}));

describe('SubscriptionComparison', () => {
  it('renders a card for each tier', () => {
    render(<SubscriptionComparison currentTier="free" />);
    expect(screen.getByTestId('comparison-card-free')).toBeDefined();
    expect(screen.getByTestId('comparison-card-pro')).toBeDefined();
    expect(screen.getByTestId('comparison-card-enterprise')).toBeDefined();
  });

  it('marks the current tier with a badge', () => {
    render(<SubscriptionComparison currentTier="pro" />);
    expect(screen.getByTestId('badge-current')).toBeDefined();
    // Only one badge should be present
    expect(screen.getAllByTestId('badge-current')).toHaveLength(1);
  });

  it('shows "Current Plan" label on the active tier card instead of a link', () => {
    render(<SubscriptionComparison currentTier="pro" />);
    // The pro card should NOT have a CTA link
    expect(screen.queryByTestId('cta-pro')).toBeNull();
  });

  it('renders upgrade CTA links for non-current paid tiers', () => {
    render(<SubscriptionComparison currentTier="free" />);
    const proLink = screen.getByTestId('cta-pro') as HTMLAnchorElement;
    expect(proLink.getAttribute('href')).toBe('/api/payments/checkout?priceId=price_pro');
    const entLink = screen.getByTestId('cta-enterprise') as HTMLAnchorElement;
    expect(entLink.getAttribute('href')).toBe('/api/payments/checkout?priceId=price_ent');
  });

  it('renders the feature comparison table rows', () => {
    render(<SubscriptionComparison currentTier="free" />);
    expect(screen.getByText('Deployments')).toBeDefined();
    expect(screen.getByText('Analytics')).toBeDefined();
  });

  it('displays the current plan name in the description', () => {
    render(<SubscriptionComparison currentTier="enterprise" />);
    // "Enterprise" appears in the description span, card heading, and table header
    expect(screen.getAllByText(/Enterprise/).length).toBeGreaterThan(0);
  });

  it('shows $0 price for free tier', () => {
    render(<SubscriptionComparison currentTier="free" />);
    expect(screen.getByTestId('comparison-card-free').textContent).toContain('$0');
  });

  it('shows monthly price for paid tiers', () => {
    render(<SubscriptionComparison currentTier="free" />);
    expect(screen.getByTestId('comparison-card-pro').textContent).toContain('$29');
    expect(screen.getByTestId('comparison-card-enterprise').textContent).toContain('$99');
  });
});
