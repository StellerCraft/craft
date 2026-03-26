'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { TIER_CONFIGS } from '@/lib/stripe/pricing';
import type { SubscriptionTier } from '@craft/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PricingClientProps {
  currentTier?: SubscriptionTier | null;
  isLoggedIn: boolean;
}

// ── Data ──────────────────────────────────────────────────────────────────────

const TIERS: SubscriptionTier[] = ['free', 'pro', 'enterprise'];

const TIER_DESCRIPTIONS: Record<SubscriptionTier, string> = {
  free: 'Get started with one deployment and explore the platform.',
  pro: 'Scale your DeFi apps with analytics and custom domains.',
  enterprise: 'Unlimited power for production-grade deployments.',
};

interface MatrixFeature {
  label: string;
  free: string | boolean;
  pro: string | boolean;
  enterprise: string | boolean;
}

const MATRIX_FEATURES: MatrixFeature[] = [
  { label: 'Deployments',        free: '1',         pro: '10',        enterprise: 'Unlimited' },
  { label: 'Analytics',          free: false,        pro: true,        enterprise: true },
  { label: 'Custom domains',     free: false,        pro: '1',         enterprise: 'Unlimited' },
  { label: 'Premium templates',  free: false,        pro: true,        enterprise: true },
  { label: 'Priority support',   free: false,        pro: false,       enterprise: true },
  { label: 'Stellar integration',free: true,         pro: true,        enterprise: true },
  { label: 'Live preview',       free: true,         pro: true,        enterprise: true },
  { label: 'GitHub integration', free: true,         pro: true,        enterprise: true },
];

const FAQS = [
  {
    q: 'Can I upgrade or downgrade at any time?',
    a: 'Yes. Plan changes take effect immediately. If you upgrade mid-cycle you are charged a prorated amount; downgrades apply at the next billing date.',
  },
  {
    q: 'What happens when I hit my deployment limit?',
    a: 'You will be prompted to upgrade. Existing deployments remain active — you just cannot create new ones until you upgrade or remove an existing deployment.',
  },
  {
    q: 'Is there a free trial for Pro or Enterprise?',
    a: 'The Free tier lets you explore the platform with no time limit. Reach out to us if you need a full-feature trial before committing.',
  },
  {
    q: 'How does billing work?',
    a: 'Plans are billed monthly via Stripe. You can cancel at any time and retain access until the end of the billing period.',
  },
  {
    q: 'Do you offer discounts for annual billing?',
    a: 'Annual billing with a 20% discount is coming soon. Sign up for our newsletter to be notified when it launches.',
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`w-5 h-5 flex-shrink-0 ${className}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg
      className="w-5 h-5 flex-shrink-0 text-outline"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function MatrixCell({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') {
    return value ? (
      <CheckIcon className="text-surface-tint mx-auto" />
    ) : (
      <CrossIcon />
    );
  }
  return <span className="text-sm font-medium text-on-surface">{value}</span>;
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  const id = `faq-${q.replace(/\s+/g, '-').toLowerCase().slice(0, 30)}`;

  return (
    <div className="border-b border-outline-variant/30 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="w-full flex items-center justify-between gap-4 py-5 text-left
                   text-on-surface font-medium text-sm focus:outline-none
                   focus:ring-2 focus:ring-surface-tint focus:ring-inset rounded"
      >
        <span>{q}</span>
        <svg
          className={`w-5 h-5 flex-shrink-0 text-on-surface-variant transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div
        id={id}
        role="region"
        aria-labelledby={id}
        className={`overflow-hidden transition-all duration-200 ${open ? 'max-h-96 pb-5' : 'max-h-0'}`}
      >
        <p className="text-sm text-on-surface-variant leading-relaxed">{a}</p>
      </div>
    </div>
  );
}

// ── Tier Card ─────────────────────────────────────────────────────────────────

function TierCard({
  tier,
  isCurrentPlan,
  isRecommended,
  isLoggedIn,
}: {
  tier: SubscriptionTier;
  isCurrentPlan: boolean;
  isRecommended: boolean;
  isLoggedIn: boolean;
}) {
  const config = TIER_CONFIGS[tier];
  const priceDisplay =
    config.monthlyPriceCents === 0
      ? '$0'
      : `$${config.monthlyPriceCents / 100}`;

  const features: string[] = buildFeatureList(tier);

  const ctaHref = buildCtaHref(tier, isLoggedIn);
  const ctaLabel = buildCtaLabel(tier, isCurrentPlan, isLoggedIn);
  const isPrimary = isRecommended;

  return (
    <div
      data-testid={`tier-card-${tier}`}
      className={`relative flex flex-col rounded-xl border bg-surface-container-lowest p-8 shadow-sm
        ${isPrimary ? 'border-surface-tint ring-1 ring-surface-tint' : 'border-outline-variant/20'}
      `}
    >
      {/* Badges */}
      <div className="flex items-center gap-2 mb-4 min-h-[1.5rem]">
        {isCurrentPlan && (
          <span
            data-testid="badge-current-plan"
            className="inline-flex items-center rounded-full bg-secondary-container px-2.5 py-0.5
                       text-xs font-semibold text-on-secondary-container"
          >
            Current Plan
          </span>
        )}
        {isRecommended && !isCurrentPlan && (
          <span
            data-testid="badge-recommended"
            className="inline-flex items-center rounded-full bg-surface-tint px-2.5 py-0.5
                       text-xs font-semibold text-on-primary"
          >
            Recommended
          </span>
        )}
      </div>

      {/* Plan name & description */}
      <h3 className="text-xl font-bold font-headline text-on-surface mb-1">
        {config.displayName}
      </h3>
      <p className="text-sm text-on-surface-variant mb-6">
        {TIER_DESCRIPTIONS[tier]}
      </p>

      {/* Price */}
      <div className="mb-6">
        <span className="text-4xl font-bold font-headline text-on-surface">{priceDisplay}</span>
        {config.monthlyPriceCents > 0 && (
          <span className="text-sm text-on-surface-variant ml-1">/month</span>
        )}
      </div>

      {/* CTA */}
      {isCurrentPlan ? (
        <span
          className="w-full rounded-lg border border-outline-variant/40 px-4 py-2.5 text-sm
                     font-semibold text-on-surface-variant text-center cursor-default select-none"
          aria-label={`You are on the ${config.displayName} plan`}
        >
          Current Plan
        </span>
      ) : (
        <Link
          href={ctaHref}
          data-testid={`cta-${tier}`}
          className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-center
                      focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2
                      transition-all duration-200
                      ${isPrimary
                        ? 'bg-gradient-primary text-on-primary hover:opacity-90'
                        : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
                      }`}
        >
          {ctaLabel}
        </Link>
      )}

      {/* Feature list */}
      <ul className="mt-8 space-y-3" aria-label={`${config.displayName} plan features`}>
        {features.map((f) => (
          <li key={f} className="flex items-start gap-3 text-sm text-on-surface-variant">
            <CheckIcon className="text-surface-tint mt-0.5" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFeatureList(tier: SubscriptionTier): string[] {
  const e = TIER_CONFIGS[tier].entitlements;
  const list: string[] = [];
  list.push(e.maxDeployments === -1 ? 'Unlimited deployments' : `${e.maxDeployments} deployment${e.maxDeployments !== 1 ? 's' : ''}`);
  if (e.analyticsEnabled) list.push('Deployment analytics');
  list.push(
    e.maxCustomDomains === -1
      ? 'Unlimited custom domains'
      : e.maxCustomDomains === 0
      ? 'No custom domains'
      : `${e.maxCustomDomains} custom domain`
  );
  if (e.premiumTemplates) list.push('Premium templates');
  if (e.prioritySupport) list.push('Priority support');
  list.push('Stellar & Soroban integration');
  list.push('Live preview');
  list.push('GitHub integration');
  return list;
}

function buildCtaHref(tier: SubscriptionTier, isLoggedIn: boolean): string {
  if (tier === 'free') return isLoggedIn ? '/app' : '/signup';
  if (!isLoggedIn) return '/signup';
  const priceId = TIER_CONFIGS[tier].stripePriceId;
  return priceId ? `/api/payments/checkout?priceId=${priceId}` : '/app/billing';
}

function buildCtaLabel(tier: SubscriptionTier, isCurrentPlan: boolean, isLoggedIn: boolean): string {
  if (isCurrentPlan) return 'Current Plan';
  if (tier === 'free') return isLoggedIn ? 'Go to Dashboard' : 'Get Started';
  return isLoggedIn ? 'Upgrade' : 'Get Started';
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PricingClient({ currentTier, isLoggedIn }: PricingClientProps) {
  return (
    <>
      {/* Hero */}
      <section className="pt-24 pb-16 px-6 text-center">
        <p className="text-xs font-bold tracking-[0.2em] text-surface-tint uppercase mb-4">
          Pricing
        </p>
        <h1 className="text-4xl lg:text-5xl font-bold font-headline text-on-surface mb-4">
          Simple, transparent pricing
        </h1>
        <p className="text-lg text-on-surface-variant max-w-2xl mx-auto">
          Start free, scale when you&apos;re ready. No hidden fees, no surprises.
        </p>
      </section>

      {/* Tier Cards */}
      <section
        aria-label="Pricing tiers"
        className="max-w-6xl mx-auto px-6 pb-24 grid grid-cols-1 md:grid-cols-3 gap-8"
      >
        {TIERS.map((tier) => (
          <TierCard
            key={tier}
            tier={tier}
            isCurrentPlan={isLoggedIn && currentTier === tier}
            isRecommended={tier === 'pro'}
            isLoggedIn={isLoggedIn}
          />
        ))}
      </section>

      {/* Feature Matrix */}
      <section aria-label="Feature comparison" className="bg-surface-container-low py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl font-bold font-headline text-on-surface text-center mb-12">
            Compare plans
          </h2>
          <div className="overflow-x-auto rounded-xl border border-outline-variant/20 shadow-sm">
            <table className="w-full min-w-[480px] bg-surface-container-lowest">
              <thead>
                <tr className="border-b border-outline-variant/20">
                  <th className="text-left px-6 py-4 text-sm font-semibold text-on-surface w-1/2">
                    Feature
                  </th>
                  {TIERS.map((t) => (
                    <th
                      key={t}
                      scope="col"
                      className={`px-4 py-4 text-center text-sm font-semibold
                        ${t === 'pro' ? 'text-surface-tint' : 'text-on-surface'}`}
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
                    className={`border-b border-outline-variant/10 last:border-0 ${i % 2 === 0 ? '' : 'bg-surface-container-low/40'}`}
                  >
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{row.label}</td>
                    <td className="px-4 py-4 text-center"><MatrixCell value={row.free} /></td>
                    <td className="px-4 py-4 text-center"><MatrixCell value={row.pro} /></td>
                    <td className="px-4 py-4 text-center"><MatrixCell value={row.enterprise} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section aria-label="Frequently asked questions" className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-2xl font-bold font-headline text-on-surface text-center mb-10">
          Frequently asked questions
        </h2>
        <div
          role="list"
          className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 px-6 shadow-sm"
        >
          {FAQS.map((faq) => (
            <div role="listitem" key={faq.q}>
              <FAQItem q={faq.q} a={faq.a} />
            </div>
          ))}
        </div>
      </section>

      {/* Sticky CTA Banner */}
      <div
        aria-label="Upgrade call to action"
        className="sticky bottom-0 z-40 bg-primary/95 backdrop-blur-sm border-t border-on-primary/10 py-4 px-6"
      >
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm font-medium text-on-primary text-center sm:text-left">
            Ready to scale your DeFi deployments?
          </p>
          <Link
            href={isLoggedIn ? '/app/billing' : '/signup'}
            data-testid="sticky-cta"
            className="shrink-0 rounded-lg bg-on-primary-container px-5 py-2.5 text-sm font-semibold
                       text-on-primary focus:outline-none focus:ring-2 focus:ring-on-primary
                       hover:opacity-90 transition-all duration-200"
          >
            {isLoggedIn ? 'Manage Billing' : 'Get Started Free'}
          </Link>
        </div>
      </div>
    </>
  );
}
