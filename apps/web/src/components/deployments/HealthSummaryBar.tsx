'use client';

import React from 'react';
import type { DeploymentAnalytics } from '@/types/deployment';

interface HealthSummaryBarProps {
  analytics: DeploymentAnalytics;
}

function SuccessRateFill({ rate }: { rate: number }) {
  const clampedRate = Math.min(100, Math.max(0, rate));
  const colour =
    clampedRate >= 95
      ? 'bg-green-500'
      : clampedRate >= 80
      ? 'bg-amber-500'
      : 'bg-red-500';

  return (
    <div
      className="h-1.5 rounded-full bg-surface-container-high overflow-hidden"
      role="progressbar"
      aria-valuenow={clampedRate}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Success rate"
    >
      <div
        className={`h-full rounded-full ${colour} transition-[width] duration-700`}
        style={{ width: `${clampedRate}%` }}
      />
    </div>
  );
}

export function HealthSummaryBar({ analytics }: HealthSummaryBarProps) {
  const overall: 'healthy' | 'degraded' | 'critical' =
    analytics.successRate >= 95 && analytics.failedLast24h === 0
      ? 'healthy'
      : analytics.successRate >= 80
      ? 'degraded'
      : 'critical';

  const healthConfig = {
    healthy: {
      label: 'All systems healthy',
      dotClass: 'bg-green-500',
      textClass: 'text-green-700',
      bgClass: 'bg-green-50 border-green-200',
    },
    degraded: {
      label: 'Degraded performance',
      dotClass: 'bg-amber-500',
      textClass: 'text-amber-700',
      bgClass: 'bg-amber-50 border-amber-200',
    },
    critical: {
      label: 'Critical failures detected',
      dotClass: 'bg-red-500',
      textClass: 'text-red-700',
      bgClass: 'bg-red-50 border-red-200',
    },
  }[overall];

  return (
    <div
      id="health-summary-bar"
      className={`rounded-xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4 ${healthConfig.bgClass}`}
      role="region"
      aria-label="Deployment health summary"
    >
      {/* Overall status pill */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${healthConfig.dotClass} ${overall !== 'healthy' ? 'animate-pulse' : ''}`} aria-hidden="true" />
        <span className={`text-sm font-semibold ${healthConfig.textClass}`}>{healthConfig.label}</span>
      </div>

      <div className="hidden sm:block w-px h-5 bg-current opacity-20" aria-hidden="true" />

      {/* Mini stats */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm flex-1">
        <Stat label="Active now" value={String(analytics.activeDeployments)} />
        <Stat label="Today" value={String(analytics.deploymentsToday)} />
        <Stat label="Failed (24 h)" value={String(analytics.failedLast24h)} emphasiseIfNonZero />
      </div>

      {/* Success rate bar */}
      <div className="flex-shrink-0 w-full sm:w-40 space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-on-surface-variant">Success rate</span>
          <span className="font-semibold text-on-surface">{analytics.successRate.toFixed(1)}%</span>
        </div>
        <SuccessRateFill rate={analytics.successRate} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasiseIfNonZero,
}: {
  label: string;
  value: string;
  emphasiseIfNonZero?: boolean;
}) {
  const isNonZero = emphasiseIfNonZero && value !== '0';
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`font-bold font-headline ${isNonZero ? 'text-red-700' : 'text-on-surface'}`}>
        {value}
      </span>
      <span className="text-on-surface-variant text-xs">{label}</span>
    </div>
  );
}
