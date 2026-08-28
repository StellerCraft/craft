'use client';

/**
 * Subscription Management Page
 *
 * Displays the user's current subscription tier, billing cycle, next payment
 * date, and usage against tier limits.  Provides upgrade, downgrade, and
 * cancel actions via the payments API.
 *
 * Route: /app/settings/billing
 */

import React, { useEffect, useState } from 'react';
import { AppShell } from '@/components/app';
import { TierUsageIndicators } from '@/components/app/TierUsageIndicators';
import { UpgradePromptModal } from '@/components/app/UpgradePrompt';
import { TIER_CONFIGS, formatTierPrice } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';
import type { SubscriptionStatus } from '@craft/types';
import type { User, NavItem } from '@/types/navigation';

// ── Shell data ────────────────────────────────────────────────────────────────

const mockUser: User = {
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
  role: 'user',
};

const navItems: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    path: '/app',
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    path: '/app/templates',
  },
  {
    id: 'deployments',
    label: 'Deployments',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    path: '/app/deployments',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    path: '/app/settings/profile',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function tierBadgeClass(tier: SubscriptionTier): string {
  if (tier === 'enterprise') return 'bg-purple-100 text-purple-800';
  if (tier === 'pro') return 'bg-blue-100 text-blue-800';
  return 'bg-surface-container text-on-surface-variant';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: SubscriptionStatus['status'] }) {
  const classes =
    status === 'active'
      ? 'bg-green-100 text-green-800'
      : status === 'past_due'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-red-100 text-red-800';

  return (
    <span
      data-testid="subscription-status-badge"
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${classes}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Fetch subscription on mount
  useEffect(() => {
    fetch('/api/payments/subscription')
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load subscription');
        return r.json();
      })
      .then((data) =>
        setSubscription({
          ...data,
          currentPeriodEnd: new Date(data.currentPeriodEnd),
        })
      )
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch('/api/payments/cancel', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to cancel subscription');
      const data = await res.json();
      setSubscription((prev) =>
        prev
          ? {
              ...prev,
              cancelAtPeriodEnd: data.cancelAtPeriodEnd,
              currentPeriodEnd: new Date(data.currentPeriodEnd),
            }
          : prev
      );
      setCancelConfirmOpen(false);
    } catch (e: unknown) {
      setCancelError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCancelling(false);
    }
  }

  async function handleUpgrade(tier: Exclude<SubscriptionTier, 'free'>) {
    const priceId = TIER_CONFIGS[tier].stripePriceId;
    if (!priceId) return;

    const res = await fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        priceId,
        successUrl: `${window.location.origin}/app/settings/billing?upgraded=1`,
        cancelUrl: `${window.location.origin}/app/settings/billing`,
      }),
    });

    if (!res.ok) {
      setError('Failed to start checkout');
      return;
    }

    const { url } = await res.json();
    window.location.href = url;
  }

  const tier = subscription?.tier ?? 'free';
  const tierConfig = TIER_CONFIGS[tier];

  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[
        { label: 'Home', path: '/app' },
        { label: 'Settings', path: '/app/settings/profile' },
        { label: 'Billing' },
      ]}
      status="operational"
    >
      <div className="p-6 lg:p-8">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Page header */}
          <div>
            <h1 className="text-3xl font-bold font-headline text-on-surface mb-1">
              Billing &amp; Subscription
            </h1>
            <p className="text-on-surface-variant">
              Manage your plan, billing cycle, and usage.
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <div
              role="alert"
              data-testid="billing-error"
              className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div
              data-testid="billing-loading"
              className="animate-pulse space-y-4"
              aria-label="Loading subscription details"
            >
              <div className="h-32 rounded-xl bg-surface-container" />
              <div className="h-24 rounded-xl bg-surface-container" />
            </div>
          )}

          {/* Subscription card */}
          {!loading && subscription && (
            <>
              <section
                aria-label="Current plan"
                className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="text-xl font-bold font-headline text-on-surface mb-1">
                      Current Plan
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        data-testid="current-tier-badge"
                        className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${tierBadgeClass(tier)}`}
                      >
                        {tierConfig.displayName}
                      </span>
                      <StatusBadge status={subscription.status} />
                    </div>
                  </div>

                  {tier !== 'free' && (
                    <p className="text-2xl font-bold text-on-surface">
                      {formatTierPrice(tierConfig.monthlyPriceCents)}
                      <span className="text-sm font-normal text-on-surface-variant">
                        /mo
                      </span>
                    </p>
                  )}
                </div>

                {/* Billing cycle */}
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-on-surface-variant">Billing cycle</dt>
                    <dd
                      data-testid="billing-cycle"
                      className="font-medium text-on-surface mt-0.5"
                    >
                      Monthly
                    </dd>
                  </div>
                  <div>
                    <dt className="text-on-surface-variant">
                      {subscription.cancelAtPeriodEnd
                        ? 'Access until'
                        : 'Next payment'}
                    </dt>
                    <dd
                      data-testid="next-payment-date"
                      className="font-medium text-on-surface mt-0.5"
                    >
                      {formatDate(subscription.currentPeriodEnd)}
                    </dd>
                  </div>
                </dl>

                {/* Cancellation notice */}
                {subscription.cancelAtPeriodEnd && (
                  <p
                    data-testid="cancellation-notice"
                    className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
                  >
                    Your subscription will be cancelled on{' '}
                    <strong>{formatDate(subscription.currentPeriodEnd)}</strong>.
                    You retain access until then.
                  </p>
                )}
              </section>

              {/* Usage */}
              <TierUsageIndicators
                tier={tier}
                activeDeployments={0}
                activeCustomDomains={0}
              />

              {/* Actions */}
              <section
                aria-label="Plan actions"
                className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6 space-y-4"
              >
                <h2 className="text-xl font-bold font-headline text-on-surface">
                  Plan Actions
                </h2>

                <div className="flex flex-wrap gap-3">
                  {/* Upgrade to Pro */}
                  {tier === 'free' && (
                    <button
                      data-testid="upgrade-pro-btn"
                      onClick={() => setUpgradeModalOpen(true)}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-opacity"
                    >
                      Upgrade to Pro
                    </button>
                  )}

                  {/* Upgrade to Enterprise */}
                  {(tier === 'free' || tier === 'pro') && (
                    <button
                      data-testid="upgrade-enterprise-btn"
                      onClick={() => handleUpgrade('enterprise')}
                      className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-medium text-on-surface hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                    >
                      Upgrade to Enterprise
                    </button>
                  )}

                  {/* Downgrade to Free */}
                  {tier !== 'free' && !subscription.cancelAtPeriodEnd && (
                    <button
                      data-testid="downgrade-free-btn"
                      onClick={() => setCancelConfirmOpen(true)}
                      className="rounded-lg border border-outline-variant px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors"
                    >
                      Downgrade to Free
                    </button>
                  )}

                  {/* Cancel subscription */}
                  {tier !== 'free' && !subscription.cancelAtPeriodEnd && (
                    <button
                      data-testid="cancel-subscription-btn"
                      onClick={() => setCancelConfirmOpen(true)}
                      disabled={cancelling}
                      className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:opacity-50 transition-colors"
                    >
                      {cancelling ? 'Cancelling…' : 'Cancel Subscription'}
                    </button>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* Upgrade modal */}
      <UpgradePromptModal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        feature="Pro features"
        requiredTier="pro"
      />

      {/* Cancel confirmation dialog */}
      {cancelConfirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-confirm-title"
          data-testid="cancel-confirm-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2
              id="cancel-confirm-title"
              className="text-lg font-semibold text-gray-900 mb-2"
            >
              Cancel subscription?
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              Your plan will remain active until the end of the current billing
              period. After that, you&apos;ll be moved to the Free tier.
            </p>
            {cancelError && (
              <p
                role="alert"
                data-testid="cancel-error"
                className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                {cancelError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                data-testid="confirm-cancel-btn"
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400"
              >
                {cancelling ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button
                data-testid="dismiss-cancel-btn"
                onClick={() => {
                  setCancelConfirmOpen(false);
                  setCancelError(null);
                }}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                Keep plan
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
