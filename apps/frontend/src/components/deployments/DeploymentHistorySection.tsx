'use client';

import React from 'react';

export interface DeploymentHistoryItem {
  id: string;
  title: string;
  summary: string;
  timestamp: string;
  actor?: string;
  status: 'success' | 'failed' | 'pending';
}

interface DeploymentHistorySectionProps {
  items: DeploymentHistoryItem[];
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

function statusClass(status: DeploymentHistoryItem['status']): string {
  if (status === 'success') return 'bg-green-100 text-green-700';
  if (status === 'failed') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function DeploymentHistorySection({
  items,
  isLoading = false,
  error = null,
  onRefresh,
}: DeploymentHistorySectionProps) {
  return (
    <section
      aria-label="Deployment history"
      className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold font-headline text-on-surface">History</h2>

        {onRefresh && (
          <button
            type="button"
            data-testid="deployment-history-refresh-btn"
            onClick={onRefresh}
            className="rounded-lg border border-outline-variant px-3 py-1.5 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Refresh
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {!error && isLoading && (
        <div className="mt-3 space-y-2" aria-label="Loading history">
          <div className="h-14 animate-pulse rounded-lg bg-surface-container" />
          <div className="h-14 animate-pulse rounded-lg bg-surface-container" />
        </div>
      )}

      {!error && !isLoading && items.length === 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-outline-variant/30 px-4 py-5">
          <p className="text-sm font-medium text-on-surface">History integration ready</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            This section is prepared for deployment update and redeploy events once the history feed endpoint is available.
          </p>
        </div>
      )}

      {!error && items.length > 0 && (
        <ul className="mt-3 space-y-2" role="list">
          {items.map((item) => (
            <li key={item.id} className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${statusClass(item.status)}`}>
                  {item.status}
                </span>
                <time className="text-on-surface-variant">{formatTimestamp(item.timestamp)}</time>
                {item.actor && <span className="text-on-surface-variant">by {item.actor}</span>}
              </div>
              <p className="mt-1 text-sm font-medium text-on-surface">{item.title}</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">{item.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
