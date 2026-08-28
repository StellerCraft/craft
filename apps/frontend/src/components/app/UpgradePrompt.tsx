/**
 * UpgradePrompt — modal and banner components shown when a user hits a tier limit.
 *
 * Usage:
 *   <UpgradePromptBanner feature="custom domains" requiredTier="pro" />
 *   <UpgradePromptModal open={open} onClose={…} feature="deployments" requiredTier="pro" />
 */

'use client';

import React from 'react';
import type { SubscriptionTier } from '@craft/types';
import { TIER_CONFIGS, formatTierPrice } from '@/lib/stripe/pricing';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpgradePromptProps {
  /** Human-readable name of the locked feature, e.g. "custom domains". */
  feature: string;
  /** Minimum tier required to unlock the feature. */
  requiredTier: Exclude<SubscriptionTier, 'free'>;
}

export interface UpgradePromptModalProps extends UpgradePromptProps {
  open: boolean;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function checkoutHref(tier: Exclude<SubscriptionTier, 'free'>): string {
  return `/app/settings/billing?upgrade=${tier}`;
}

function tierLabel(tier: Exclude<SubscriptionTier, 'free'>): string {
  return TIER_CONFIGS[tier].displayName;
}

// ── UpgradePromptBanner ───────────────────────────────────────────────────────

/**
 * Inline banner displayed in-context when a feature is unavailable on the
 * current tier.  Renders a short message and a link to the checkout flow.
 */
export function UpgradePromptBanner({ feature, requiredTier }: UpgradePromptProps) {
  return (
    <div
      role="alert"
      aria-label={`Upgrade required to use ${feature}`}
      data-testid="upgrade-prompt-banner"
      className="flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span>
        <strong>{feature}</strong> is available on the{' '}
        <strong>{tierLabel(requiredTier)}</strong> plan and above.
      </span>
      <a
        href={checkoutHref(requiredTier)}
        className="shrink-0 rounded bg-amber-500 px-3 py-1 font-medium text-white hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-400"
        aria-label={`Upgrade to ${tierLabel(requiredTier)}`}
      >
        Upgrade
      </a>
    </div>
  );
}

// ── UpgradePromptModal ────────────────────────────────────────────────────────

/**
 * Full-screen modal shown when a user attempts an action that exceeds their
 * current tier.  Includes a tier comparison table and a direct link to checkout.
 */
export function UpgradePromptModal({
  open,
  onClose,
  feature,
  requiredTier,
}: UpgradePromptModalProps) {
  if (!open) return null;

  const config = TIER_CONFIGS[requiredTier];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-modal-title"
      data-testid="upgrade-prompt-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <h2
            id="upgrade-modal-title"
            className="text-lg font-semibold text-gray-900"
          >
            Upgrade to {config.displayName}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close upgrade prompt"
            className="rounded p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <p className="mb-4 text-sm text-gray-600">
          <strong>{feature}</strong> requires the{' '}
          <strong>{config.displayName}</strong> plan.
        </p>

        {/* Feature highlights */}
        <ul className="mb-6 space-y-2 text-sm text-gray-700">
          <li>✓ Up to {config.entitlements.maxDeployments === -1 ? 'unlimited' : config.entitlements.maxDeployments} deployments</li>
          {config.entitlements.analyticsEnabled && <li>✓ Deployment analytics</li>}
          {config.entitlements.maxCustomDomains !== 0 && (
            <li>
              ✓{' '}
              {config.entitlements.maxCustomDomains === -1
                ? 'Unlimited'
                : config.entitlements.maxCustomDomains}{' '}
              custom domain{config.entitlements.maxCustomDomains !== 1 ? 's' : ''}
            </li>
          )}
          {config.entitlements.premiumTemplates && <li>✓ Premium templates</li>}
          {config.entitlements.prioritySupport && <li>✓ Priority support</li>}
        </ul>

        {/* CTA */}
        <a
          href={checkoutHref(requiredTier)}
          className="block w-full rounded-lg bg-indigo-600 py-2 text-center font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          aria-label={`Upgrade to ${config.displayName}`}
        >
          Upgrade to {config.displayName} — {formatTierPrice(config.monthlyPriceCents)}/mo
        </a>

        <button
          onClick={onClose}
          className="mt-3 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
