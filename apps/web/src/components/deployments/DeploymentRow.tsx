'use client';

import React from 'react';
import type { Deployment, DeploymentEnvironment } from '@/types/deployment';
import { DeploymentStatusBadge } from './DeploymentStatusBadge';

interface DeploymentRowProps {
  deployment: Deployment;
  onViewLogs?: (id: string) => void;
  onRedeploy?: (id: string) => void;
}

const ENV_LABELS: Record<DeploymentEnvironment, { label: string; className: string }> = {
  production: { label: 'Production', className: 'text-purple-700 bg-purple-50' },
  staging: { label: 'Staging', className: 'text-amber-700 bg-amber-50' },
  preview: { label: 'Preview', className: 'text-blue-700 bg-blue-50' },
  development: { label: 'Development', className: 'text-on-surface-variant bg-surface-container' },
};

const TRIGGER_ICONS: Record<Deployment['trigger'], React.ReactNode> = {
  push: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  manual: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
    </svg>
  ),
  schedule: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  api: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
    </svg>
  ),
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function DeploymentRow({ deployment, onViewLogs, onRedeploy }: DeploymentRowProps) {
  const env = ENV_LABELS[deployment.environment];
  const canRedeploy = deployment.status === 'success' || deployment.status === 'failed' || deployment.status === 'cancelled';

  return (
    <li
      id={`deployment-row-${deployment.id}`}
      className="
        group flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4
        px-5 py-4 bg-surface-container-lowest
        border border-outline-variant/10 rounded-xl
        hover:shadow-md hover:border-outline-variant/20
        transition-all duration-200
      "
    >
      {/* Left: name + commit */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="font-semibold text-on-surface text-sm truncate font-headline">
            {deployment.name}
          </span>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${env.className}`}
          >
            {env.label}
          </span>
        </div>

        {/* Commit meta */}
        <div className="flex items-center gap-2 text-xs text-on-surface-variant flex-wrap">
          <code className="font-mono bg-surface-container px-1.5 py-0.5 rounded text-[11px]">
            {deployment.commit.sha}
          </code>
          <span className="truncate max-w-[220px]">{deployment.commit.message}</span>
          <span className="opacity-60">·</span>
          <span>{deployment.commit.author}</span>
          <span className="opacity-60">on</span>
          <code className="font-mono text-[11px]">{deployment.commit.branch}</code>
        </div>
      </div>

      {/* Middle: status + meta */}
      <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 sm:gap-1 flex-shrink-0">
        <DeploymentStatusBadge status={deployment.status} size="sm" />

        <div className="flex items-center gap-2 text-xs text-on-surface-variant">
          {/* Trigger icon + label */}
          <span className="flex items-center gap-1" title={`Triggered by ${deployment.trigger}`}>
            {TRIGGER_ICONS[deployment.trigger]}
            <span className="capitalize">{deployment.trigger}</span>
          </span>

          {/* Region */}
          <span title={deployment.region.label}>
            {deployment.region.flag}
          </span>

          {/* Duration */}
          {deployment.durationSeconds !== undefined && (
            <span title="Build duration">{formatDuration(deployment.durationSeconds)}</span>
          )}

          {/* Time */}
          <span title={new Date(deployment.createdAt).toLocaleString()}>
            {formatRelativeTime(deployment.createdAt)}
          </span>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {deployment.url && (
          <a
            href={deployment.url}
            target="_blank"
            rel="noopener noreferrer"
            id={`deployment-visit-${deployment.id}`}
            aria-label={`Visit ${deployment.name}`}
            className="
              p-1.5 rounded-lg text-on-surface-variant
              hover:bg-surface-container hover:text-on-surface
              transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40
            "
            title="Visit deployment"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        )}

        {deployment.logsUrl && onViewLogs && (
          <button
            type="button"
            id={`deployment-logs-${deployment.id}`}
            aria-label={`View logs for ${deployment.name}`}
            onClick={() => onViewLogs(deployment.id)}
            className="
              p-1.5 rounded-lg text-on-surface-variant
              hover:bg-surface-container hover:text-on-surface
              transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40
            "
            title="View logs"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
          </button>
        )}

        {canRedeploy && onRedeploy && (
          <button
            type="button"
            id={`deployment-redeploy-${deployment.id}`}
            aria-label={`Redeploy ${deployment.name}`}
            onClick={() => onRedeploy(deployment.id)}
            className="
              p-1.5 rounded-lg text-on-surface-variant
              hover:bg-surface-container hover:text-on-surface
              transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40
            "
            title="Redeploy"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
          </button>
        )}
      </div>
    </li>
  );
}
