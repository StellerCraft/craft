/**
 * @vitest-environment jsdom
 *
 * Tests for the subscription management page at /app/settings/billing.
 *
 * Strategy: mock fetch, @/lib/stripe/pricing, and child components that have
 * their own test suites (AppShell, TierUsageIndicators, UpgradePromptModal) so
 * this suite focuses on the page's own logic: data fetching, rendering tier
 * info, billing dates, and action buttons.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BillingPage from './page';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/stripe/pricing', () => ({
  TIER_CONFIGS: {
    free: {
      tier: 'free',
      displayName: 'Free',
      monthlyPriceCents: 0,
      stripePriceId: null,
      entitlements: { maxDeployments: 1, maxCustomDomains: 0, analyticsEnabled: false, premiumTemplates: false, prioritySupport: false },
    },
    pro: {
      tier: 'pro',
      displayName: 'Pro',
      monthlyPriceCents: 2900,
      stripePriceId: 'price_pro',
      entitlements: { maxDeployments: 10, maxCustomDomains: 1, analyticsEnabled: true, premiumTemplates: true, prioritySupport: false },
    },
    enterprise: {
      tier: 'enterprise',
      displayName: 'Enterprise',
      monthlyPriceCents: 9900,
      stripePriceId: 'price_enterprise',
      entitlements: { maxDeployments: -1, maxCustomDomains: -1, analyticsEnabled: true, premiumTemplates: true, prioritySupport: true },
    },
  },
  getEntitlements: (tier: string) => {
    const map: Record<string, { maxDeployments: number; maxCustomDomains: number }> = {
      free: { maxDeployments: 1, maxCustomDomains: 0 },
      pro: { maxDeployments: 10, maxCustomDomains: 1 },
      enterprise: { maxDeployments: -1, maxCustomDomains: -1 },
    };
    return map[tier] ?? map.free;
  },
}));

// Stub heavy shell components to keep tests fast
vi.mock('@/components/app', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/app/TierUsageIndicators', () => ({
  TierUsageIndicators: ({ tier }: { tier: string }) => (
    <div data-testid="tier-usage-indicators" data-tier={tier} />
  ),
}));

vi.mock('@/components/app/UpgradePrompt', () => ({
  UpgradePromptModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="upgrade-modal">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const PERIOD_END = '2026-05-23T00:00:00.000Z';

function mockFetch(responses: Record<string, unknown>) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const key = Object.keys(responses).find((k) => url.includes(k));
    if (!key) throw new Error(`Unexpected fetch: ${url}`);
    return {
      ok: true,
      json: async () => responses[key],
    } as Response;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BillingPage', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('loading state', () => {
    it('shows loading skeleton while fetching', () => {
      // Never resolve so we stay in loading state
      vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => {}));
      render(<BillingPage />);
      expect(screen.getByTestId('billing-loading')).toBeDefined();
    });
  });

  describe('free tier', () => {
    beforeEach(() => {
      mockFetch({
        '/api/payments/subscription': {
          tier: 'free',
          status: 'active',
          currentPeriodEnd: PERIOD_END,
          cancelAtPeriodEnd: false,
        },
      });
    });

    it('renders the Free tier badge', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('current-tier-badge'));
      expect(screen.getByTestId('current-tier-badge').textContent).toBe('Free');
    });

    it('shows active status badge', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('subscription-status-badge'));
      expect(screen.getByTestId('subscription-status-badge').textContent).toBe('active');
    });

    it('shows billing cycle as Monthly', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('billing-cycle'));
      expect(screen.getByTestId('billing-cycle').textContent).toBe('Monthly');
    });

    it('shows next payment date', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('next-payment-date'));
      expect(screen.getByTestId('next-payment-date').textContent).toContain('2026');
    });

    it('shows upgrade to Pro button', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('upgrade-pro-btn'));
    });

    it('shows upgrade to Enterprise button', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('upgrade-enterprise-btn'));
    });

    it('does not show cancel button on free tier', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('current-tier-badge'));
      expect(screen.queryByTestId('cancel-subscription-btn')).toBeNull();
    });

    it('opens upgrade modal when Upgrade to Pro is clicked', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('upgrade-pro-btn'));
      fireEvent.click(screen.getByTestId('upgrade-pro-btn'));
      expect(screen.getByTestId('upgrade-modal')).toBeDefined();
    });

    it('passes tier to TierUsageIndicators', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('tier-usage-indicators'));
      expect(screen.getByTestId('tier-usage-indicators').getAttribute('data-tier')).toBe('free');
    });
  });

  describe('pro tier', () => {
    beforeEach(() => {
      mockFetch({
        '/api/payments/subscription': {
          tier: 'pro',
          status: 'active',
          currentPeriodEnd: PERIOD_END,
          cancelAtPeriodEnd: false,
        },
      });
    });

    it('renders the Pro tier badge', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('current-tier-badge'));
      expect(screen.getByTestId('current-tier-badge').textContent).toBe('Pro');
    });

    it('shows monthly price', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByText('$29'));
    });

    it('shows cancel subscription button', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('cancel-subscription-btn'));
    });

    it('shows downgrade to free button', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('downgrade-free-btn'));
    });

    it('does not show upgrade to Pro button', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('current-tier-badge'));
      expect(screen.queryByTestId('upgrade-pro-btn')).toBeNull();
    });

    it('opens cancel confirmation dialog', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('cancel-subscription-btn'));
      fireEvent.click(screen.getByTestId('cancel-subscription-btn'));
      expect(screen.getByTestId('cancel-confirm-dialog')).toBeDefined();
    });

    it('dismisses cancel dialog when Keep plan is clicked', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('cancel-subscription-btn'));
      fireEvent.click(screen.getByTestId('cancel-subscription-btn'));
      fireEvent.click(screen.getByTestId('dismiss-cancel-btn'));
      expect(screen.queryByTestId('cancel-confirm-dialog')).toBeNull();
    });

    it('calls cancel API and shows cancellation notice', async () => {
      const fetchSpy = mockFetch({
        '/api/payments/subscription': {
          tier: 'pro',
          status: 'active',
          currentPeriodEnd: PERIOD_END,
          cancelAtPeriodEnd: false,
        },
        '/api/payments/cancel': {
          cancelAtPeriodEnd: true,
          currentPeriodEnd: PERIOD_END,
        },
      });

      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('cancel-subscription-btn'));
      fireEvent.click(screen.getByTestId('cancel-subscription-btn'));
      fireEvent.click(screen.getByTestId('confirm-cancel-btn'));

      await waitFor(() => screen.getByTestId('cancellation-notice'));
      expect(fetchSpy).toHaveBeenCalledWith('/api/payments/cancel', expect.objectContaining({ method: 'POST' }));
    });

    it('keeps the confirm dialog open with an inline error when cancellation fails', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/api/payments/cancel')) {
          return { ok: false } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            tier: 'pro',
            status: 'active',
            currentPeriodEnd: PERIOD_END,
            cancelAtPeriodEnd: false,
          }),
        } as Response;
      });

      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('cancel-subscription-btn'));
      fireEvent.click(screen.getByTestId('cancel-subscription-btn'));
      fireEvent.click(screen.getByTestId('confirm-cancel-btn'));

      await waitFor(() => screen.getByTestId('cancel-error'));
      expect(screen.getByTestId('cancel-confirm-dialog')).toBeDefined();
      expect(screen.getByTestId('cancel-error').textContent).toContain('Failed to cancel subscription');
      expect(screen.getByTestId('confirm-cancel-btn').hasAttribute('disabled')).toBe(false);
      expect(screen.queryByTestId('cancellation-notice')).toBeNull();
    });
  });

  describe('cancelled subscription', () => {
    beforeEach(() => {
      mockFetch({
        '/api/payments/subscription': {
          tier: 'pro',
          status: 'active',
          currentPeriodEnd: PERIOD_END,
          cancelAtPeriodEnd: true,
        },
      });
    });

    it('shows cancellation notice', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('cancellation-notice'));
    });

    it('hides cancel button when already cancelled', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('current-tier-badge'));
      expect(screen.queryByTestId('cancel-subscription-btn')).toBeNull();
    });

    it('shows access-until label instead of next payment', async () => {
      render(<BillingPage />);
      await waitFor(() => screen.getByText('Access until'));
    });
  });

  describe('error state', () => {
    it('shows error banner when fetch fails', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
      render(<BillingPage />);
      await waitFor(() => screen.getByTestId('billing-error'));
      expect(screen.getByTestId('billing-error').textContent).toContain('Network error');
    });
  });
});
