'use client';

/**
 * UpgradeFlow
 *
 * Confirmation screen shown before redirecting to Stripe checkout.
 * Displays the target tier, monthly price, proration note, and a confirm CTA.
 *
 * @param currentTier  - The user's active subscription tier
 * @param targetTier   - The tier the user wants to upgrade to
 * @param onConfirm    - Called when the user clicks "Confirm upgrade"
 * @param loading      - Whether the checkout redirect is in progress
 * @param error        - Error message to display, if any
 */

import React from 'react';
import Link from 'next/link';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import { MATRIX_FEATURES, MatrixCell } from '@/components/marketing/FeatureMatrix';
import type { SubscriptionTier } from '@craft/types';

const TIER_ORDER: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

function isUpgrade(current: SubscriptionTier, target: SubscriptionTier): boolean {
  return TIER_ORDER.indexOf(target) > TIER_ORDER.indexOf(current);
}

interface UpgradeFlowProps {
  currentTier: SubscriptionTier;
  targetTier: SubscriptionTier;
  onConfirm: () => void;
  loading: boolean;
  error: string | null;
}

export function UpgradeFlow({ currentTier, targetTier, onConfirm, loading, error }: UpgradeFlowProps) {
  const currentConfig = TIER_CONFIGS[currentTier];
  const targetConfig = TIER_CONFIGS[targetTier];
  const upgrade = isUpgrade(currentTier, targetTier);
  const priceDisplay = `$${targetConfig.monthlyPriceCents / 100}/month`;

  return (
    <section
      aria-label="Upgrade confirmation"
      className="max-w-2xl mx-auto px-6 py-10"
    >
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/app/subscription"
          data-testid="back-link"
          className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          ← Back to plans
        </Link>
        <h1 className="mt-4 text-2xl font-bold font-headline text-on-surface">
          {upgrade ? 'Upgrade' : 'Change'} to {targetConfig.displayName}
        </h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Switching from{' '}
          <span className="font-medium text-on-surface">{currentConfig.displayName}</span> to{' '}
          <span className="font-medium text-on-surface">{targetConfig.displayName}</span>
        </p>
      </div>

      {/* Pricing summary */}
      <div
        data-testid="pricing-summary"
        className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-6 mb-6"
      >
        <div className="flex items-baseline justify-between mb-4">
          <span className="text-sm font-medium text-on-surface-variant">New plan</span>
          <span className="text-2xl font-bold font-headline text-on-surface">{priceDisplay}</span>
        </div>

        {upgrade && (
          <p
            data-testid="proration-note"
            className="text-xs text-on-surface-variant bg-surface-container-low rounded-lg px-4 py-3"
          >
            You will be charged a prorated amount for the remainder of the current billing cycle,
            then <strong>{priceDisplay}</strong> on each subsequent renewal date.
          </p>
        )}
      </div>

      {/* Feature highlights for target tier */}
      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest overflow-hidden mb-8">
        <table className="w-full">
          <thead>
            <tr className="border-b border-outline-variant/20 bg-surface-container-low">
              <th className="text-left px-5 py-3 text-xs font-semibold text-on-surface-variant uppercase tracking-wide">
                Feature
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-on-surface-variant uppercase tracking-wide">
                {currentConfig.displayName}
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-surface-tint uppercase tracking-wide">
                {targetConfig.displayName}
              </th>
            </tr>
          </thead>
          <tbody>
            {MATRIX_FEATURES.map((row, i) => (
              <tr
                key={row.label}
                className={`border-b border-outline-variant/10 last:border-0 ${i % 2 !== 0 ? 'bg-surface-container-low/30' : ''}`}
              >
                <td className="px-5 py-3 text-sm text-on-surface-variant">{row.label}</td>
                <td className="px-4 py-3 text-center">
                  <MatrixCell value={row[currentTier]} />
                </td>
                <td className="px-4 py-3 text-center">
                  <MatrixCell value={row[targetTier]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Error */}
      {error && (
        <p
          data-testid="error-message"
          role="alert"
          className="mb-4 rounded-lg bg-error-container px-4 py-3 text-sm text-on-error-container"
        >
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          data-testid="confirm-button"
          onClick={onConfirm}
          disabled={loading}
          className="flex-1 rounded-lg bg-surface-tint px-5 py-3 text-sm font-semibold text-on-primary hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          {loading ? 'Redirecting…' : `Confirm ${upgrade ? 'upgrade' : 'change'}`}
        </button>
        <Link
          href="/app/subscription"
          data-testid="cancel-link"
          className="flex-1 rounded-lg border border-outline-variant/40 px-5 py-3 text-sm font-semibold text-on-surface text-center hover:bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2 transition-all duration-200"
        >
          Cancel
        </Link>
      </div>
    </section>
  );
}
