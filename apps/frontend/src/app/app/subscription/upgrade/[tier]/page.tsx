'use client';

/**
 * Subscription Upgrade Page
 *
 * Confirms the target tier with the user, then initiates a Stripe checkout
 * session and redirects to the hosted payment page.
 *
 * Route: /app/subscription/upgrade/[tier]
 *
 * Edge cases:
 * - Invalid tier param → redirect to /app/subscription
 * - Same tier as current → redirect to /app/subscription
 * - Checkout API failure → show inline error, allow retry
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app';
import { UpgradeFlow } from '@/components/app/UpgradeFlow';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';
import type { User, NavItem } from '@/types/navigation';

const VALID_TIERS = new Set<string>(['free', 'pro', 'enterprise']);

const mockUser: User = { id: '1', name: 'John Doe', email: 'john@example.com', role: 'user' };

const navItems: NavItem[] = [
  {
    id: 'home', label: 'Home', path: '/app',
    icon: <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
  },
  {
    id: 'settings', label: 'Settings', path: '/app/settings/profile',
    icon: <svg fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  },
];

export default function UpgradePage({ params }: { params: { tier: string } }) {
  const router = useRouter();
  const [currentTier, setCurrentTier] = useState<SubscriptionTier>('free');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetTier = params.tier as SubscriptionTier;

  // Redirect if the tier param is invalid
  useEffect(() => {
    if (!VALID_TIERS.has(params.tier)) {
      router.replace('/app/subscription');
    }
  }, [params.tier, router]);

  // Fetch the user's current tier
  useEffect(() => {
    fetch('/api/payments/subscription')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.tier) {
          const tier = data.tier as SubscriptionTier;
          // Redirect if already on this tier
          if (tier === targetTier) {
            router.replace('/app/subscription');
            return;
          }
          setCurrentTier(tier);
        }
      })
      .catch(() => {/* fall back to 'free' */});
  }, [targetTier, router]);

  async function handleConfirm() {
    const priceId = TIER_CONFIGS[targetTier]?.stripePriceId;
    if (!priceId) {
      setError('No price configured for this tier.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId,
          successUrl: `${window.location.origin}/app/subscription?upgraded=1`,
          cancelUrl: `${window.location.origin}/app/subscription/upgrade/${targetTier}`,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? 'Failed to start checkout. Please try again.');
      }

      const { url } = await res.json();
      window.location.href = url;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred.');
      setLoading(false);
    }
  }

  if (!VALID_TIERS.has(params.tier)) return null;

  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[
        { label: 'Subscription', path: '/app/subscription' },
        { label: `Upgrade to ${TIER_CONFIGS[targetTier]?.displayName ?? targetTier}` },
      ]}
    >
      <UpgradeFlow
        currentTier={currentTier}
        targetTier={targetTier}
        onConfirm={handleConfirm}
        loading={loading}
        error={error}
      />
    </AppShell>
  );
}
