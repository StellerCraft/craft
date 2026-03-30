'use client';

import React from 'react';
import type { Deployment, DeploymentFilters } from '@/types/deployment';
import { DeploymentRow } from './DeploymentRow';
import { DeploymentListSkeleton } from './DeploymentListSkeleton';

interface DeploymentListProps {
  deployments: Deployment[];
  filters: DeploymentFilters;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onViewLogs: (id: string) => void;
  onRedeploy: (id: string) => void;
}

/** Filtered subset matching all active filter criteria */
function applyFilters(deployments: Deployment[], filters: DeploymentFilters): Deployment[] {
  return deployments.filter((d) => {
    if (filters.status !== 'all' && d.status !== filters.status) return false;
    if (filters.environment !== 'all' && d.environment !== filters.environment) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const haystack = [
        d.name,
        d.commit.message,
        d.commit.author,
        d.commit.branch,
        d.commit.sha,
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function DeploymentList({
  deployments,
  filters,
  isLoading,
  error,
  onRetry,
  onViewLogs,
  onRedeploy,
}: DeploymentListProps) {
  /* ── Loading state ── */
  if (isLoading) {
    return <DeploymentListSkeleton count={5} />;
  }

  /* ── Error state ── */
  if (error) {
    return (
      <div
        id="deployment-list-error"
        role="alert"
        className="
          flex flex-col items-center justify-center py-20 px-6 text-center
          rounded-xl border border-red-200 bg-red-50
        "
      >
        <span className="text-4xl mb-4" aria-hidden="true">⚠️</span>
        <h3 className="text-lg font-bold font-headline text-on-surface mb-2">
          Failed to load deployments
        </h3>
        <p className="text-sm text-on-surface-variant mb-6 max-w-sm">{error}</p>
        <button
          type="button"
          id="deployment-list-retry"
          onClick={onRetry}
          className="
            inline-flex items-center gap-2 px-5 py-2.5 rounded-lg
            bg-primary text-on-primary text-sm font-semibold
            hover:opacity-90 active:scale-95 transition-all
            focus:outline-none focus:ring-2 focus:ring-primary/40
          "
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Retry
        </button>
      </div>
    );
  }

  const filtered = applyFilters(deployments, filters);

  /* ── Empty state — no deployments at all ── */
  if (deployments.length === 0) {
    return (
      <div
        id="deployment-list-empty"
        className="
          flex flex-col items-center justify-center py-20 px-6 text-center
          rounded-xl border border-dashed border-outline-variant/30
        "
      >
        <span
          className="
            w-16 h-16 rounded-2xl bg-surface-container flex items-center justify-center mb-5
            text-on-surface-variant
          "
          aria-hidden="true"
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </span>
        <h3 className="text-xl font-bold font-headline text-on-surface mb-2">
          No deployments yet
        </h3>
        <p className="text-sm text-on-surface-variant max-w-xs leading-relaxed">
          Push a commit or trigger a manual deployment to see it here.
        </p>
      </div>
    );
  }

  /* ── Empty state — filters produce no results ── */
  if (filtered.length === 0) {
    return (
      <div
        id="deployment-list-no-results"
        className="
          flex flex-col items-center justify-center py-16 px-6 text-center
          rounded-xl border border-dashed border-outline-variant/30
        "
      >
        <span
          className="
            w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center mb-4
            text-on-surface-variant
          "
          aria-hidden="true"
        >
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
        </span>
        <h3 className="text-lg font-bold font-headline text-on-surface mb-1">
          No deployments match your filters
        </h3>
        <p className="text-sm text-on-surface-variant">
          Try adjusting the search or clearing the filters.
        </p>
      </div>
    );
  }

  /* ── Normal list ── */
  return (
    <ul id="deployment-list" aria-label="Deployments" className="space-y-3" role="list">
      {filtered.map((d) => (
        <DeploymentRow
          key={d.id}
          deployment={d}
          onViewLogs={onViewLogs}
          onRedeploy={onRedeploy}
        />
      ))}
    </ul>
  );
}

/** Re-export the filter helper for use in page-level hooks/tests */
export { applyFilters };
