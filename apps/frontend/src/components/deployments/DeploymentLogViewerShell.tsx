'use client';

import React from 'react';
import type { DeploymentLogEntry } from '@/types/deployment';

interface DeploymentLogViewerShellProps {
  logs: DeploymentLogEntry[];
  isLoading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

function levelClass(level: DeploymentLogEntry['level']): string {
  if (level === 'error') return 'bg-red-100 text-red-700';
  if (level === 'warn') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
}

function formatLogTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function DeploymentLogViewerShell({
  logs,
  isLoading = false,
  error = null,
  onRefresh,
  onLoadMore,
  hasMore = false,
}: DeploymentLogViewerShellProps) {
  return (
    <section
      aria-label="Deployment logs"
      className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold font-headline text-on-surface">Logs</h2>

        {onRefresh && (
          <button
            type="button"
            data-testid="deployment-logs-refresh-btn"
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

      {!error && isLoading && logs.length === 0 && (
        <div className="mt-3 space-y-2" aria-label="Loading logs">
          <div className="h-10 animate-pulse rounded-lg bg-surface-container" />
          <div className="h-10 animate-pulse rounded-lg bg-surface-container" />
          <div className="h-10 animate-pulse rounded-lg bg-surface-container" />
        </div>
      )}

      {!error && !isLoading && logs.length === 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-outline-variant/30 px-4 py-6 text-center">
          <p className="text-sm text-on-surface">No logs yet</p>
          <p className="mt-1 text-xs text-on-surface-variant">
            Logs will stream here when the deployment starts emitting events.
          </p>
        </div>
      )}

      {logs.length > 0 && (
        <ul className="mt-3 max-h-[420px] space-y-2 overflow-auto pr-1" role="list">
          {logs.map((log) => (
            <li
              key={log.id}
              className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${levelClass(log.level)}`}>
                  {log.level}
                </span>
                <time className="font-mono text-on-surface-variant">{formatLogTimestamp(log.timestamp)}</time>
              </div>
              <p className="mt-1 font-mono text-xs text-on-surface">{log.message}</p>
            </li>
          ))}
        </ul>
      )}

      {logs.length > 0 && hasMore && onLoadMore && (
        <button
          type="button"
          data-testid="deployment-logs-load-more-btn"
          onClick={onLoadMore}
          className="mt-3 rounded-lg border border-outline-variant px-3 py-1.5 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          Load older logs
        </button>
      )}
    </section>
  );
}
