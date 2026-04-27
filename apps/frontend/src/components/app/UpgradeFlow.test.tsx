/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { UpgradeFlow } from './UpgradeFlow';

vi.mock('next/link', () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { 'data-testid'?: string }) => (
    <a href={props.href} data-testid={props['data-testid']}>{props.children}</a>
  ),
}));

vi.mock('@/lib/stripe/pricing', () => ({
  TIER_CONFIGS: {
    free:       { displayName: 'Free',       monthlyPriceCents: 0,    stripePriceId: null },
    pro:        { displayName: 'Pro',        monthlyPriceCents: 2900, stripePriceId: 'price_pro' },
    enterprise: { displayName: 'Enterprise', monthlyPriceCents: 9900, stripePriceId: 'price_ent' },
  },
}));

vi.mock('@/components/marketing/FeatureMatrix', () => ({
  MATRIX_FEATURES: [
    { label: 'Deployments', free: '1', pro: '10', enterprise: 'Unlimited' },
    { label: 'Analytics',   free: false, pro: true, enterprise: true },
  ],
  MatrixCell: ({ value }: { value: string | boolean }) => (
    <span>{typeof value === 'boolean' ? (value ? 'yes' : 'no') : value}</span>
  ),
}));

const noop = () => {};

describe('UpgradeFlow', () => {
  it('renders the target tier name in the heading', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={false} error={null} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Pro');
  });

  it('shows the target tier monthly price', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={false} error={null} />);
    expect(screen.getByTestId('pricing-summary').textContent).toContain('$29');
  });

  it('shows proration note for upgrades', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={false} error={null} />);
    expect(screen.getByTestId('proration-note')).toBeDefined();
  });

  it('does not show proration note for downgrades', () => {
    render(<UpgradeFlow currentTier="enterprise" targetTier="free" onConfirm={noop} loading={false} error={null} />);
    expect(screen.queryByTestId('proration-note')).toBeNull();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={onConfirm} loading={false} error={null} />);
    fireEvent.click(screen.getByTestId('confirm-button'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('disables confirm button while loading', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={true} error={null} />);
    expect((screen.getByTestId('confirm-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows loading text on confirm button while loading', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={true} error={null} />);
    expect(screen.getByTestId('confirm-button').textContent).toContain('Redirecting');
  });

  it('displays an error message when error is set', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={false} error="Something went wrong" />);
    expect(screen.getByTestId('error-message').textContent).toContain('Something went wrong');
  });

  it('does not render error message when error is null', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={false} error={null} />);
    expect(screen.queryByTestId('error-message')).toBeNull();
  });

  it('cancel link points to /app/subscription', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={false} error={null} />);
    expect((screen.getByTestId('cancel-link') as HTMLAnchorElement).getAttribute('href')).toBe('/app/subscription');
  });

  it('renders feature comparison table rows', () => {
    render(<UpgradeFlow currentTier="free" targetTier="pro" onConfirm={noop} loading={false} error={null} />);
    expect(screen.getByText('Deployments')).toBeDefined();
    expect(screen.getByText('Analytics')).toBeDefined();
  });
});
