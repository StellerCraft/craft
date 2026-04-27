'use client';

/**
 * Subscription Comparison Page
 *
 * Authenticated route that shows a side-by-side comparison of all subscription
 * tiers, highlights the user's current plan, and provides upgrade/downgrade CTAs.
 *
 * Route: /app/subscription
 */

import React, { useEffect, useState } from 'react';
import { AppShell } from '@/components/app';
import { SubscriptionComparison } from '@/components/app/SubscriptionComparison';
import type { SubscriptionTier } from '@craft/types';
import type { User, NavItem } from '@/types/navigation';

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

export default function SubscriptionPage() {
  const [currentTier, setCurrentTier] = useState<SubscriptionTier>('free');

  useEffect(() => {
    fetch('/api/payments/subscription')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.tier) setCurrentTier(data.tier as SubscriptionTier);
      })
      .catch(() => {/* fall back to 'free' */});
  }, []);

  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[
        { label: 'Settings', path: '/app/settings/profile' },
        { label: 'Subscription' },
      ]}
    >
      <SubscriptionComparison currentTier={currentTier} />
    </AppShell>
  );
}
