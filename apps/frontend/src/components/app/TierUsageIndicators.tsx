import type { SubscriptionTier } from '@craft/types';
import { getEntitlements, TIER_CONFIGS } from '@/lib/stripe/pricing';

interface TierUsageIndicatorsProps {
  tier: SubscriptionTier;
  activeDeployments: number;
  activeCustomDomains: number;
}

export type UsageState = 'normal' | 'warning' | 'critical' | 'unavailable';

export interface UsageInfo {
  used: number;
  limit: number;
  percent: number;
  state: UsageState;
}

export const WARNING_THRESHOLD_PERCENT = 80;

export function getUsageInfo(used: number, limit: number): UsageInfo {
export type UsageState = 'normal' | 'warning' | 'critical' | 'unavailable';
  if (limit === -1) {
    return { used, limit, percent: 0, state: 'normal' };
  }

  const safeUsed = Math.max(0, used);

  // 0 is a valid limit meaning the tier has no allowance for this resource.
  // Report it explicitly rather than clamping it into a misleading "x of 1".
  if (limit === 0) {
    return { used: safeUsed, limit: 0, percent: 0, state: 'unavailable' };
  }

  // Guard only against genuinely invalid limits (negative, NaN, fractional < 1).
  const safeLimit = Number.isFinite(limit) ? Math.max(1, limit) : 1;
  const rawPercent = (safeUsed / safeLimit) * 100;
  const percent = Math.min(100, Math.round(rawPercent));

  if (safeUsed >= safeLimit) {
    return { used: safeUsed, limit: safeLimit, percent, state: 'critical' };
  }

  if (percent >= WARNING_THRESHOLD_PERCENT) {
    return { used: safeUsed, limit: safeLimit, percent, state: 'warning' };
  }

  return { used: safeUsed, limit: safeLimit, percent, state: 'normal' };
}

function usageTone(state: UsageState): string {
  if (state === 'critical') return 'text-error';
  if (state === 'warning') return 'text-surface-tint';
  return 'text-on-surface-variant';
}

function barTone(state: UsageState): string {
  if (state === 'critical') return 'bg-error';
  if (state === 'warning') return 'bg-surface-tint';
  return 'bg-primary';
}

function UsageProgress({ label, info }: { label: string; info: UsageInfo }) {
  if (info.state === 'unavailable') {
    return (
      <div
        className="space-y-2 opacity-60"
        aria-disabled="true"
        data-testid={`${label.toLowerCase()}-usage-unavailable`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-on-surface-variant">{label}</p>
          <p className="text-xs text-on-surface-variant">Not included</p>
        </div>
        <div className="h-2 rounded-full bg-surface-container" aria-hidden="true" />
        <p className="text-xs text-on-surface-variant">
          {label} are not available on your current tier.
        </p>
      </div>
    );
  }

  if (info.limit === -1) {
    return (
      <div className="space-y-2" data-testid={`${label.toLowerCase()}-usage-unlimited`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-on-surface">{label}</p>
          <p className="text-xs text-on-surface-variant">{info.used} used / Unlimited</p>
        </div>
        <div className="h-2 rounded-full bg-surface-container" aria-hidden="true">
          <div className="h-2 rounded-full bg-primary" style={{ width: '100%' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`${label.toLowerCase()}-usage`}> 
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-on-surface">{label}</p>
        <p className={`text-xs ${usageTone(info.state)}`}>
          {info.used} / {info.limit}
        </p>
      </div>
      <div className="h-2 rounded-full bg-surface-container" role="progressbar" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={info.limit} aria-valuenow={Math.min(info.used, info.limit)}>
        <div className={`h-2 rounded-full transition-all ${barTone(info.state)}`} style={{ width: `${info.percent}%` }} />
      </div>
      {info.state === 'warning' && (
        <p className="text-xs text-surface-tint" data-testid={`${label.toLowerCase()}-warning`}>
          Approaching {label.toLowerCase()} limit.
        </p>
      )}
      {info.state === 'critical' && (
        <p className="text-xs text-error" data-testid={`${label.toLowerCase()}-critical`}>
          {label} limit reached.
        </p>
      )}
    </div>
  );
}

export function TierUsageIndicators({ tier, activeDeployments, activeCustomDomains }: TierUsageIndicatorsProps) {
  const entitlements = getEntitlements(tier);
  const deploymentUsage = getUsageInfo(activeDeployments, entitlements.maxDeployments);
  const domainUsage = getUsageInfo(activeCustomDomains, entitlements.maxCustomDomains);

  return (
    <section
      aria-label="Subscription usage"
      className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-xl font-bold font-headline text-on-surface">Tier Usage</h2>
          <p className="text-sm text-on-surface-variant">
            {TIER_CONFIGS[tier].displayName} plan utilization
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <UsageProgress label="Deployments" info={deploymentUsage} />

        <UsageProgress label="Domains" info={domainUsage} />
      </div>
    </section>
  );
}
