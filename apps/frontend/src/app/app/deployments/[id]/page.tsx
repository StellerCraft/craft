'use client';

/**
 * Deployment Detail Page — /app/deployments/[id]
 *
 * Sections:
 *   1. Metadata header  — name, status, environment, trigger, timestamps, URLs
 *   2. Actions toolbar  — Redeploy, Delete (with confirmation)
 *   3. Health           — current health check result and response time
 *   4. Analytics        — page views, uptime %, transaction count
 *   5. Logs             — paginated, filterable build/runtime log stream
 *   6. History          — previous deployments for the same project (diff entry point)
 *
 * Data contracts:
 *   GET  /api/deployments/[id]           → deployment metadata
 *   GET  /api/deployments/[id]/health    → { isHealthy, responseTime, statusCode, lastChecked }
 *   GET  /api/deployments/[id]/analytics → { analytics[], summary }
 *   GET  /api/deployments/[id]/logs      → { data: DeploymentLogResponse[], pagination }
 *   DELETE /api/deployments/[id]         → { success, deploymentId }
 *
 * See docs/deployment-detail-design.md for full design rationale.
 */

import React, { useState } from 'react';
import { AppShell } from '@/components/app';
import { DeploymentStatusBadge } from '@/components/deployments';
import type { User, NavItem } from '@/types/navigation';
import type { DeploymentStatus, DeploymentEnvironment, DeploymentTrigger } from '@/types/deployment';
import type { LogLevel } from '@craft/types';

/* ─── Shell fixtures (replace with session/SWR in production) ─── */

const mockUser: User = {
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
  role: 'user',
};

const navItems: NavItem[] = [
  {
    id: 'deployments',
    label: 'Deployments',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    path: '/app/deployments',
  },
];

/* ─── Mock detail data (replace with SWR / React Query) ─────── */

interface DeploymentDetail {
  id: string;
  name: string;
  status: DeploymentStatus;
  environment: DeploymentEnvironment;
  trigger: DeploymentTrigger;
  commit: { sha: string; message: string; author: string; branch: string };
  region: { label: string; flag: string };
  createdAt: string;
  completedAt?: string;
  durationSeconds?: number;
  url?: string;
  repositoryUrl?: string;
  templateId: string;
}

interface HealthData {
  isHealthy: boolean;
  responseTime: number;
  statusCode: number;
  lastChecked: string;
}

interface AnalyticsSummary {
  totalPageViews: number;
  uptimePercentage: number;
  totalTransactions: number;
  lastChecked: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
}

interface HistoryEntry {
  id: string;
  status: DeploymentStatus;
  createdAt: string;
  commit: { sha: string; message: string };
  durationSeconds?: number;
}

const MOCK_DETAIL: DeploymentDetail = {
  id: 'dep-001',
  name: 'stellar-dex-template',
  status: 'success',
  environment: 'production',
  trigger: 'push',
  commit: { sha: 'a3f9c12', message: 'feat: add liquidity pool calculation logic', author: 'jana.m', branch: 'main' },
  region: { label: 'US East', flag: '🇺🇸' },
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  completedAt: new Date(Date.now() - 2.8 * 60 * 60 * 1000).toISOString(),
  durationSeconds: 127,
  url: 'https://stellar-dex.craft.app',
  repositoryUrl: 'https://github.com/acme/stellar-dex',
  templateId: 'stellar-dex',
};

const MOCK_HEALTH: HealthData = {
  isHealthy: true,
  responseTime: 245,
  statusCode: 200,
  lastChecked: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
};

const MOCK_ANALYTICS: AnalyticsSummary = {
  totalPageViews: 1_482,
  uptimePercentage: 99.9,
  totalTransactions: 312,
  lastChecked: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
};

const MOCK_LOGS: LogEntry[] = [
  { id: 'l1', timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), level: 'info', message: 'Deployment pipeline started' },
  { id: 'l2', timestamp: new Date(Date.now() - 2.95 * 60 * 60 * 1000).toISOString(), level: 'info', message: 'Generating template files…' },
  { id: 'l3', timestamp: new Date(Date.now() - 2.9 * 60 * 60 * 1000).toISOString(), level: 'info', message: 'Creating GitHub repository stellar-dex' },
  { id: 'l4', timestamp: new Date(Date.now() - 2.85 * 60 * 60 * 1000).toISOString(), level: 'info', message: 'Pushing generated code (47 files)' },
  { id: 'l5', timestamp: new Date(Date.now() - 2.82 * 60 * 60 * 1000).toISOString(), level: 'warn', message: 'Vercel build warning: unused variable in swap.ts:42' },
  { id: 'l6', timestamp: new Date(Date.now() - 2.8 * 60 * 60 * 1000).toISOString(), level: 'info', message: 'Deployment completed — https://stellar-dex.craft.app' },
];

const MOCK_HISTORY: HistoryEntry[] = [
  { id: 'dep-001', status: 'success', createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), commit: { sha: 'a3f9c12', message: 'feat: add liquidity pool calculation logic' }, durationSeconds: 127 },
  { id: 'dep-prev-1', status: 'failed', createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), commit: { sha: 'b7e2d45', message: 'fix: handle edge-case in invoice reconciliation' }, durationSeconds: 43 },
  { id: 'dep-prev-2', status: 'success', createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(), commit: { sha: 'c1a8b90', message: 'chore: bump soroban-sdk to v21' }, durationSeconds: 98 },
];

/* ─── Sub-components ─────────────────────────────────────────── */

const LOG_LEVEL_CLASSES: Record<LogLevel, string> = {
  info: 'text-on-surface-variant',
  warn: 'text-amber-600',
  error: 'text-red-600',
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-bold font-headline text-on-surface mb-4">{children}</h2>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-2.5 border-b border-outline-variant/10 last:border-0">
      <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide w-36 shrink-0">{label}</span>
      <span className="text-sm text-on-surface">{children}</span>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function DeploymentDetailPage({ params }: { params: { id: string } }) {
  const [logLevel, setLogLevel] = useState<LogLevel | 'all'>('all');
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const dep = MOCK_DETAIL; // TODO: replace with useSWR(`/api/deployments/${params.id}`)
  const health = MOCK_HEALTH; // TODO: replace with useSWR(`/api/deployments/${params.id}/health`)
  const analytics = MOCK_ANALYTICS; // TODO: replace with useSWR(`/api/deployments/${params.id}/analytics`)
  const logs = MOCK_LOGS; // TODO: replace with useSWR(`/api/deployments/${params.id}/logs`)
  const history = MOCK_HISTORY; // TODO: replace with useSWR(`/api/deployments/${params.id}/history`)

  const filteredLogs = logLevel === 'all' ? logs : logs.filter((l) => l.level === logLevel);

  const canRedeploy = dep.status === 'success' || dep.status === 'failed' || dep.status === 'cancelled';

  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[
        { label: 'Home', path: '/app' },
        { label: 'Deployments', path: '/app/deployments' },
        { label: dep.name },
      ]}
      status="operational"
    >
      <div className="p-6 lg:p-8 space-y-8 max-w-5xl mx-auto">

        {/* ── 1. Header ── */}
        <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold font-headline text-on-surface tracking-tight">
              {dep.name}
            </h1>
            <DeploymentStatusBadge status={dep.status} />
          </div>

          {/* ── 2. Actions toolbar ── */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {dep.url && (
              <a
                href={dep.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/20 text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                Visit
              </a>
            )}

            {canRedeploy && (
              <button
                type="button"
                id="detail-redeploy-btn"
                aria-label={`Redeploy ${dep.name}`}
                onClick={() => { /* TODO: POST /api/deployments/${dep.id}/redeploy */ }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:opacity-90 active:scale-95 transition-all shadow-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                Redeploy
              </button>
            )}

            {!deleteConfirm ? (
              <button
                type="button"
                id="detail-delete-btn"
                aria-label={`Delete ${dep.name}`}
                onClick={() => setDeleteConfirm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Delete
              </button>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
                <span className="text-xs text-red-700 font-semibold">Confirm delete?</span>
                <button
                  type="button"
                  id="detail-delete-confirm-btn"
                  onClick={() => { /* TODO: DELETE /api/deployments/${dep.id} then redirect */ setDeleteConfirm(false); }}
                  className="text-xs font-bold text-red-700 hover:underline"
                >
                  Yes, delete
                </button>
                <button type="button" onClick={() => setDeleteConfirm(false)} className="text-xs text-on-surface-variant hover:underline">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ── 3. Metadata ── */}
        <section aria-label="Deployment metadata" className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 px-5 py-4">
          <SectionHeading>Details</SectionHeading>
          <MetaRow label="Environment">
            <span className="capitalize">{dep.environment}</span>
          </MetaRow>
          <MetaRow label="Trigger">
            <span className="capitalize">{dep.trigger}</span>
          </MetaRow>
          <MetaRow label="Commit">
            <code className="font-mono text-xs bg-surface-container px-1.5 py-0.5 rounded mr-2">{dep.commit.sha}</code>
            {dep.commit.message}
          </MetaRow>
          <MetaRow label="Branch">
            <code className="font-mono text-xs">{dep.commit.branch}</code>
          </MetaRow>
          <MetaRow label="Author">{dep.commit.author}</MetaRow>
          <MetaRow label="Region">{dep.region.flag} {dep.region.label}</MetaRow>
          <MetaRow label="Started">{formatRelative(dep.createdAt)}</MetaRow>
          {dep.durationSeconds !== undefined && (
            <MetaRow label="Duration">{formatDuration(dep.durationSeconds)}</MetaRow>
          )}
          {dep.url && (
            <MetaRow label="URL">
              <a href={dep.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{dep.url}</a>
            </MetaRow>
          )}
          {dep.repositoryUrl && (
            <MetaRow label="Repository">
              <a href={dep.repositoryUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{dep.repositoryUrl}</a>
            </MetaRow>
          )}
        </section>

        {/* ── 4. Health ── */}
        <section aria-label="Deployment health" className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 px-5 py-4">
          <SectionHeading>Health</SectionHeading>
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-on-surface-variant">Status</span>
              <span className={`text-sm font-semibold ${health.isHealthy ? 'text-green-600' : 'text-red-600'}`}>
                {health.isHealthy ? '✓ Healthy' : '✗ Unhealthy'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-on-surface-variant">HTTP status</span>
              <span className="text-sm font-semibold text-on-surface">{health.statusCode}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-on-surface-variant">Response time</span>
              <span className="text-sm font-semibold text-on-surface">{health.responseTime}ms</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-on-surface-variant">Last checked</span>
              <span className="text-sm text-on-surface">{formatRelative(health.lastChecked)}</span>
            </div>
          </div>
        </section>

        {/* ── 5. Analytics ── */}
        <section aria-label="Deployment analytics" className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 px-5 py-4">
          <SectionHeading>Analytics</SectionHeading>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            {[
              { label: 'Page views', value: analytics.totalPageViews.toLocaleString() },
              { label: 'Uptime', value: `${analytics.uptimePercentage.toFixed(1)}%` },
              { label: 'Transactions', value: analytics.totalTransactions.toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col gap-1">
                <span className="text-xs text-on-surface-variant">{label}</span>
                <span className="text-2xl font-bold font-headline text-on-surface">{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── 6. Logs ── */}
        <section aria-label="Deployment logs">
          <div className="flex items-center justify-between mb-4">
            <SectionHeading>Logs</SectionHeading>
            <div className="flex items-center gap-1 bg-surface-container rounded-lg p-1">
              {(['all', 'info', 'warn', 'error'] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setLogLevel(lvl)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                    logLevel === lvl
                      ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <div
            id="deployment-logs"
            role="log"
            aria-label="Build and runtime logs"
            aria-live="polite"
            className="bg-gray-950 rounded-xl border border-outline-variant/10 p-4 font-mono text-xs space-y-1 max-h-80 overflow-y-auto"
          >
            {filteredLogs.length === 0 ? (
              <p className="text-gray-500 py-4 text-center">No log entries for this filter.</p>
            ) : (
              filteredLogs.map((entry) => (
                <div key={entry.id} className="flex gap-3 items-start">
                  <span className="text-gray-500 shrink-0 tabular-nums">
                    {new Date(entry.timestamp).toISOString().slice(11, 19)}
                  </span>
                  <span className={`uppercase font-bold w-8 shrink-0 ${LOG_LEVEL_CLASSES[entry.level]}`}>
                    {entry.level === 'warn' ? 'WARN' : entry.level.toUpperCase()}
                  </span>
                  <span className="text-gray-200 break-all">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── 7. History ── */}
        <section aria-label="Deployment history">
          <SectionHeading>History</SectionHeading>
          <ul className="space-y-2" role="list">
            {history.map((h) => (
              <li
                key={h.id}
                className={`flex items-center gap-4 px-4 py-3 rounded-xl border text-sm transition-colors ${
                  h.id === dep.id
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-outline-variant/10 bg-surface-container-lowest hover:border-outline-variant/20'
                }`}
              >
                <DeploymentStatusBadge status={h.status} size="sm" />
                <div className="flex-1 min-w-0">
                  <code className="font-mono text-xs text-on-surface-variant mr-2">{h.commit.sha}</code>
                  <span className="text-on-surface truncate">{h.commit.message}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-on-surface-variant shrink-0">
                  {h.durationSeconds !== undefined && <span>{formatDuration(h.durationSeconds)}</span>}
                  <span>{formatRelative(h.createdAt)}</span>
                  {h.id !== dep.id && (
                    <a
                      href={`/app/deployments/${h.id}`}
                      className="text-primary hover:underline font-medium"
                      aria-label={`View deployment ${h.commit.sha}`}
                    >
                      View
                    </a>
                  )}
                  {h.id === dep.id && (
                    <span className="text-primary font-semibold">Current</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

      </div>
    </AppShell>
  );
}
