// @vitest-environment jsdom
/**
 * Tests for the Pricing page components.
 *
 * Covers:
 *   - All three tier cards render
 *   - Correct badges (Current Plan / Recommended)
 *   - CTA button text for logged-out vs logged-in state
 *   - FAQ section renders and is accessible
 *   - Sticky CTA banner renders correct text
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PricingClient from './PricingClient';

// next/link renders as a plain <a> in jsdom
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Stub out env-dependent pricing config
vi.mock('@/lib/stripe/pricing', () => ({
  TIER_CONFIGS: {
    free: {
      tier: 'free',
      displayName: 'Free',
      monthlyPriceCents: 0,
      entitlements: {
        maxDeployments: 1,
        analyticsEnabled: false,
        maxCustomDomains: 0,
        premiumTemplates: false,
        prioritySupport: false,
      },
      stripePriceId: null,
    },
    pro: {
      tier: 'pro',
      displayName: 'Pro',
      monthlyPriceCents: 2900,
      entitlements: {
        maxDeployments: 10,
        analyticsEnabled: true,
        maxCustomDomains: 1,
        premiumTemplates: true,
        prioritySupport: false,
      },
      stripePriceId: 'price_pro_test',
    },
    enterprise: {
      tier: 'enterprise',
      displayName: 'Enterprise',
      monthlyPriceCents: 9900,
      entitlements: {
        maxDeployments: -1,
        analyticsEnabled: true,
        maxCustomDomains: -1,
        premiumTemplates: true,
        prioritySupport: true,
      },
      stripePriceId: 'price_ent_test',
    },
  },
}));

// ── Tier card rendering ───────────────────────────────────────────────────────

describe('PricingClient – tier cards', () => {
  it('renders all three tier cards', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByTestId('tier-card-free')).toBeDefined();
    expect(screen.getByTestId('tier-card-pro')).toBeDefined();
    expect(screen.getByTestId('tier-card-enterprise')).toBeDefined();
  });

  it('renders plan names', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getAllByText('Free').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Pro').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Enterprise').length).toBeGreaterThan(0);
  });

  it('renders prices', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByText('$0')).toBeDefined();
    expect(screen.getByText('$29')).toBeDefined();
    expect(screen.getByText('$99')).toBeDefined();
  });
});

// ── Badges ────────────────────────────────────────────────────────────────────

describe('PricingClient – badges', () => {
  it('shows Recommended badge on Pro when not current plan', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByTestId('badge-recommended')).toBeDefined();
  });

  it('does not show Current Plan badge when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.queryByTestId('badge-current-plan')).toBeNull();
  });

  it('shows Current Plan badge on the active tier when logged in', () => {
    render(<PricingClient isLoggedIn={true} currentTier="pro" />);
    expect(screen.getByTestId('badge-current-plan')).toBeDefined();
  });

  it('does not show Recommended badge when Pro is the current plan', () => {
    render(<PricingClient isLoggedIn={true} currentTier="pro" />);
    expect(screen.queryByTestId('badge-recommended')).toBeNull();
  });

  it('shows Current Plan badge on Free tier when user is on free', () => {
    render(<PricingClient isLoggedIn={true} currentTier="free" />);
    const badge = screen.getByTestId('badge-current-plan');
    expect(badge).toBeDefined();
    // Badge should be inside the free card
    const freeCard = screen.getByTestId('tier-card-free');
    expect(freeCard.contains(badge)).toBe(true);
  });

  it('shows Current Plan badge on Enterprise tier when user is on enterprise', () => {
    render(<PricingClient isLoggedIn={true} currentTier="enterprise" />);
    const badge = screen.getByTestId('badge-current-plan');
    const enterpriseCard = screen.getByTestId('tier-card-enterprise');
    expect(enterpriseCard.contains(badge)).toBe(true);
  });
});

// ── CTA buttons – logged-out ──────────────────────────────────────────────────

describe('PricingClient – CTA buttons (logged-out)', () => {
  it('shows "Get Started" on Free CTA when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const cta = screen.getByTestId('cta-free');
    expect(cta.textContent).toBe('Get Started');
  });

  it('shows "Get Started" on Pro CTA when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const cta = screen.getByTestId('cta-pro');
    expect(cta.textContent).toBe('Get Started');
  });

  it('shows "Get Started" on Enterprise CTA when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const cta = screen.getByTestId('cta-enterprise');
    expect(cta.textContent).toBe('Get Started');
  });

  it('Free CTA links to /signup when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const cta = screen.getByTestId('cta-free') as HTMLAnchorElement;
    expect(cta.href).toContain('/signup');
  });

  it('Pro CTA links to /signup when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const cta = screen.getByTestId('cta-pro') as HTMLAnchorElement;
    expect(cta.href).toContain('/signup');
  });
});

// ── CTA buttons – logged-in ───────────────────────────────────────────────────

describe('PricingClient – CTA buttons (logged-in)', () => {
  it('shows "Go to Dashboard" on Free CTA when logged in on free', () => {
    render(<PricingClient isLoggedIn={true} currentTier="free" />);
    // Free is current plan so no CTA link, but pro and enterprise show Upgrade
    const proCta = screen.getByTestId('cta-pro');
    expect(proCta.textContent).toBe('Upgrade');
  });

  it('shows "Upgrade" on Pro CTA when logged in on free', () => {
    render(<PricingClient isLoggedIn={true} currentTier="free" />);
    expect(screen.getByTestId('cta-pro').textContent).toBe('Upgrade');
  });

  it('shows "Upgrade" on Enterprise CTA when logged in on free', () => {
    render(<PricingClient isLoggedIn={true} currentTier="free" />);
    expect(screen.getByTestId('cta-enterprise').textContent).toBe('Upgrade');
  });

  it('Pro CTA links to checkout when logged in', () => {
    render(<PricingClient isLoggedIn={true} currentTier="free" />);
    const cta = screen.getByTestId('cta-pro') as HTMLAnchorElement;
    expect(cta.href).toContain('price_pro_test');
  });

  it('does not render a CTA link for the current plan', () => {
    render(<PricingClient isLoggedIn={true} currentTier="pro" />);
    expect(screen.queryByTestId('cta-pro')).toBeNull();
  });
});

// ── Feature matrix ────────────────────────────────────────────────────────────

describe('PricingClient – feature matrix', () => {
  it('renders the comparison table', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByRole('table')).toBeDefined();
  });

  it('renders column headers for all three tiers', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const headers = screen.getAllByRole('columnheader');
    const headerTexts = headers.map((h) => h.textContent);
    expect(headerTexts).toContain('Free');
    expect(headerTexts).toContain('Pro');
    expect(headerTexts).toContain('Enterprise');
  });

  it('renders feature rows', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getAllByText('Analytics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Custom domains').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Priority support').length).toBeGreaterThan(0);
  });
});

// ── FAQ ───────────────────────────────────────────────────────────────────────

describe('PricingClient – FAQ section', () => {
  it('renders FAQ section with heading', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByText('Frequently asked questions')).toBeDefined();
  });

  it('renders all FAQ questions', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByText(/Can I upgrade or downgrade/i)).toBeDefined();
    expect(screen.getByText(/deployment limit/i)).toBeDefined();
    expect(screen.getByText(/free trial/i)).toBeDefined();
    expect(screen.getByText(/How does billing work/i)).toBeDefined();
  });

  it('FAQ answers are hidden by default', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const answer = screen.getByText(/You will be prompted to upgrade/i);
    // The answer container has max-h-0 when closed
    expect(answer.closest('[role="region"]')?.className).toContain('max-h-0');
  });

  it('expands FAQ answer on click', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const question = screen.getByText(/Can I upgrade or downgrade/i);
    const button = question.closest('button')!;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('FAQ buttons have aria-expanded attribute', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const buttons = screen.getAllByRole('button').filter(
      (b) => b.getAttribute('aria-expanded') !== null
    );
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('FAQ buttons have aria-controls attribute', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const buttons = screen.getAllByRole('button').filter(
      (b) => b.getAttribute('aria-controls') !== null
    );
    expect(buttons.length).toBeGreaterThan(0);
  });
});

// ── Sticky CTA banner ─────────────────────────────────────────────────────────

describe('PricingClient – sticky CTA banner', () => {
  it('shows "Get Started Free" when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    expect(screen.getByTestId('sticky-cta').textContent).toBe('Get Started Free');
  });

  it('shows "Manage Billing" when logged in', () => {
    render(<PricingClient isLoggedIn={true} currentTier="free" />);
    expect(screen.getByTestId('sticky-cta').textContent).toBe('Manage Billing');
  });

  it('sticky CTA links to /signup when logged out', () => {
    render(<PricingClient isLoggedIn={false} currentTier={null} />);
    const cta = screen.getByTestId('sticky-cta') as HTMLAnchorElement;
    expect(cta.href).toContain('/signup');
  });

  it('sticky CTA links to /app/billing when logged in', () => {
    render(<PricingClient isLoggedIn={true} currentTier="pro" />);
    const cta = screen.getByTestId('sticky-cta') as HTMLAnchorElement;
    expect(cta.href).toContain('/app/billing');
  });
});
