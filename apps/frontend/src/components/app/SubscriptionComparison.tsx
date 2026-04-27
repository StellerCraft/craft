'use client';

/**
 * SubscriptionComparison
 *
 * Renders a full-page tier comparison table for authenticated users.
 * Highlights the current plan and surfaces upgrade CTAs for each paid tier.
 *
 * @param currentTier - The user's active subscription tier
 */

import React from 'react';
import Link from 'next/link';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import { MATRIX_FEATURES, MatrixCell } from '@/components/marketing/FeatureMatrix';
import type { SubscriptionTier } from '@craft/types';

const TIERS: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

function buildCtaHref(tier: SubscriptionTier): string {
  if (tier === 'free') return '/app';
  const priceId = TIER_CONFIGS[tier].stripePriceId;
  return priceId ? `/api/payments/checkout?priceId=${priceId}` : '/app/settings/billing';
}

function buildCtaLabel(tier: SubscriptionTier, isCurrentTier: boolean): string {
  if (isCurrentTier) return 'Current Plan';
  if (tier === 'free') return 'Downgrade';
  return 'Upgrade';
}

/**
 * Subscription tier comparison table for authenticated users.
 * Shows features, limits, pricing, and CTA buttons per tier.
 */
export function SubscriptionComparison({ currentTier }: { currentTier: SubscriptionTier }) {
  return (
    <section aria-label="Subscription tier comparison" className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold font-headline text-on-surface mb-2">Compare Plans</h1>
      <p className="text-sm text-on-surface-variant mb-8">
        You are currently on the{' '}
        <span className="font-semibold text-on-surface">{TIER_CONFIGS[currentTier].displayName}</span> plan.
      </p>

      {/* Tier header cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {TIERS.map((tier) => {
          const config = TIER_CONFIGS[tier];
          const isCurrent = tier === currentTier;
          const ctaHref = buildCtaHref(tier);
          const ctaLabel = buildCtaLabel(tier, isCurrent);
          const priceDisplay =
            config.monthlyPriceCents === 0 ? '$0' : `$${config.monthlyPriceCents / 100}`;

          return (
            <div
              key={tier}
              data-testid={`comparison-card-${tier}`}
              className={`rounded-xl border p-5 flex flex-col gap-3 ${
                isCurrent
                  ? 'border-surface-tint ring-1 ring-surface-tint bg-surface-container-lowest'
                  : 'border-outline-variant/20 bg-surface-container-lowest'
              }`}
            >
              {isCurrent && (
                <span
                  data-testid="badge-current"
                  className="self-start inline-flex items-center rounded-full bg-secondary-container px-2.5 py-0.5 text-xs font-semibold text-on-secondary-container"
                >
                  Current Plan
                </span>
              )}
              <h2 className="text-lg font-bold font-headline text-on-surface">{config.displayName}</h2>
              <div>
                <span className="text-3xl font-bold font-headline text-on-surface">{priceDisplay}</span>
                {config.monthlyPriceCents > 0 && (
                  <span className="text-xs text-on-surface-variant ml-1">/month</span>
                )}
              </div>
              {isCurrent ? (
                <span className="w-full rounded-lg border border-outline-variant/40 px-4 py-2 text-sm font-semibold text-on-surface-variant text-center cursor-default select-none">
                  {ctaLabel}
                </span>
              ) : (
                <Link
                  href={ctaHref}
                  data-testid={`cta-${tier}`}
                  className="w-full rounded-lg bg-surface-tint px-4 py-2 text-sm font-semibold text-on-primary text-center hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2 transition-all duration-200"
                >
                  {ctaLabel}
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Feature comparison table */}
      <div className="overflow-x-auto rounded-xl border border-outline-variant/20 shadow-sm">
        <table className="w-full min-w-[480px] bg-surface-container-lowest">
          <thead>
            <tr className="border-b border-outline-variant/20">
              <th className="text-left px-6 py-4 text-sm font-semibold text-on-surface w-1/2">Feature</th>
              {TIERS.map((t) => (
                <th
                  key={t}
                  scope="col"
                  className={`px-4 py-4 text-center text-sm font-semibold ${
                    t === currentTier ? 'text-surface-tint' : 'text-on-surface'
                  }`}
                >
                  {TIER_CONFIGS[t].displayName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_FEATURES.map((row, i) => (
              <tr
                key={row.label}
                className={`border-b border-outline-variant/10 last:border-0 ${
                  i % 2 !== 0 ? 'bg-surface-container-low/40' : ''
                }`}
              >
                <td className="px-6 py-4 text-sm text-on-surface-variant">{row.label}</td>
                <td className="px-4 py-4 text-center">
                  <MatrixCell value={row.free} />
                </td>
                <td className="px-4 py-4 text-center">
                  <MatrixCell value={row.pro} />
                </td>
                <td className="px-4 py-4 text-center">
                  <MatrixCell value={row.enterprise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
