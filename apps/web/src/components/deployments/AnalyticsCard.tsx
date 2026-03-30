'use client';

import React from 'react';

interface AnalyticsCardProps {
  id: string;
  label: string;
  value: string;
  subValue?: string;
  /** Optional trend: positive numbers are green, negative are red */
  trend?: number;
  trendLabel?: string;
  icon: React.ReactNode;
  /** Accent colour key — drives the icon bg tint */
  accent?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'neutral';
}

const ACCENT_CLASSES: Record<NonNullable<AnalyticsCardProps['accent']>, string> = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-green-50 text-green-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
  purple: 'bg-purple-50 text-purple-600',
  neutral: 'bg-surface-container text-on-surface-variant',
};

export function AnalyticsCard({
  id,
  label,
  value,
  subValue,
  trend,
  trendLabel,
  icon,
  accent = 'neutral',
}: AnalyticsCardProps) {
  const hasTrend = trend !== undefined;
  const isPositive = hasTrend && trend >= 0;
  const trendSign = isPositive ? '+' : '';

  return (
    <article
      id={id}
      aria-label={label}
      className="
        bg-surface-container-lowest rounded-xl border border-outline-variant/10
        p-5 flex flex-col gap-4
        hover:shadow-md hover:-translate-y-0.5
        transition-all duration-200
      "
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${ACCENT_CLASSES[accent]}`}
          aria-hidden="true"
        >
          <span className="w-5 h-5">{icon}</span>
        </div>

        {hasTrend && (
          <span
            className={`
              inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full
              ${isPositive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}
            `}
          >
            {isPositive ? (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            )}
            {trendSign}{trend}
            {trendLabel && <span className="font-normal opacity-70">{trendLabel}</span>}
          </span>
        )}
      </div>

      {/* Value */}
      <div>
        <p className="text-sm text-on-surface-variant mb-1">{label}</p>
        <p className="text-3xl font-bold font-headline text-on-surface leading-none tracking-tight">
          {value}
        </p>
        {subValue && (
          <p className="text-xs text-on-surface-variant mt-1.5">{subValue}</p>
        )}
      </div>
    </article>
  );
}
