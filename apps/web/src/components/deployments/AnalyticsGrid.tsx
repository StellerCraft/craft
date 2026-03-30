'use client';

import React from 'react';
import type { DeploymentAnalytics } from '@/types/deployment';
import { AnalyticsCard } from './AnalyticsCard';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

interface AnalyticsGridProps {
  analytics: DeploymentAnalytics;
}

export function AnalyticsGrid({ analytics }: AnalyticsGridProps) {
  return (
    <section aria-label="Deployment analytics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      <div className="xl:col-span-2">
        <AnalyticsCard
          id="analytics-total"
          label="Total Deployments"
          value={analytics.totalDeployments.toLocaleString()}
          subValue={`${analytics.deploymentsToday} today`}
          accent="blue"
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
      </div>

      <div className="xl:col-span-2">
        <AnalyticsCard
          id="analytics-success-rate"
          label="Success Rate"
          value={`${analytics.successRate.toFixed(1)}%`}
          subValue="Last 30 days"
          trend={+analytics.successRateTrend}
          trendLabel="pp"
          accent={analytics.successRate >= 95 ? 'green' : analytics.successRate >= 80 ? 'amber' : 'red'}
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      <div className="xl:col-span-2">
        <AnalyticsCard
          id="analytics-avg-duration"
          label="Avg Build Time"
          value={formatDuration(analytics.avgDurationSeconds)}
          subValue="Per deployment"
          trend={analytics.avgDurationTrend}
          trendLabel="s"
          accent="purple"
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      <div className="xl:col-span-2">
        <AnalyticsCard
          id="analytics-active"
          label="Active Deployments"
          value={String(analytics.activeDeployments)}
          subValue="Running right now"
          accent="blue"
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
            </svg>
          }
        />
      </div>

      <div className="xl:col-span-2">
        <AnalyticsCard
          id="analytics-failed"
          label="Failed (24 h)"
          value={String(analytics.failedLast24h)}
          subValue={analytics.failedLast24h === 0 ? 'No failures — great!' : 'Needs attention'}
          accent={analytics.failedLast24h === 0 ? 'green' : 'red'}
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          }
        />
      </div>

      <div className="xl:col-span-2">
        <AnalyticsCard
          id="analytics-today"
          label="Deployments Today"
          value={String(analytics.deploymentsToday)}
          subValue="Since midnight UTC"
          accent="neutral"
          icon={
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          }
        />
      </div>
    </section>
  );
}
