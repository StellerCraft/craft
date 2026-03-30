'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { AppShell } from '@/components/app';
import { User, NavItem } from '@/types/navigation';
import type { DeploymentFilters } from '@/types/deployment';
import {
  AnalyticsGrid,
  DeploymentFiltersBar,
  DeploymentList,
  HealthSummaryBar,
  applyFilters,
} from '@/components/deployments';
import { MOCK_DEPLOYMENTS, MOCK_ANALYTICS } from '@/lib/deployment-fixtures';

/* ─── Shared shell data ─────────────────────────────────────────── */
const mockUser: User = {
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
  role: 'user',
};

const navItems: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    path: '/app',
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    path: '/app/templates',
    badge: 3,
  },
  {
    id: 'deployments',
    label: 'Deployments',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    path: '/app/deployments',
  },
  {
    id: 'customize',
    label: 'Customize',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
      </svg>
    ),
    path: '/app/customize',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    path: '/app/billing',
  },
];

/* ─── Page ──────────────────────────────────────────────────────── */
export default function DeploymentsPage() {
  /* Filter state */
  const [filters, setFilters] = useState<DeploymentFilters>({
    status: 'all',
    environment: 'all',
    search: '',
  });

  /* Data state — in production these would come from a hook / SWR */
  const [isLoading] = useState(false);
  const [error] = useState<string | null>(null);

  const filteredCount = useMemo(
    () => applyFilters(MOCK_DEPLOYMENTS, filters).length,
    [filters],
  );

  const handleViewLogs = useCallback((id: string) => {
    const dep = MOCK_DEPLOYMENTS.find((d) => d.id === id);
    if (dep?.logsUrl) window.open(dep.logsUrl, '_blank');
  }, []);

  const handleRedeploy = useCallback((_id: string) => {
    /* TODO: call POST /api/deployments/:id/redeploy */
  }, []);

  const handleRetry = useCallback(() => {
    /* TODO: re-trigger data fetch */
  }, []);

  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[{ label: 'Home', path: '/app' }, { label: 'Deployments' }]}
      status="operational"
      onStatusClick={() => window.open('https://status.craft.com', '_blank')}
    >
      <div className="p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
        {/* ── Page header ── */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold font-headline text-on-surface tracking-tight">
              Deployments
            </h1>
            <p className="text-on-surface-variant mt-1">
              Monitor builds, track health, and manage your live environments.
            </p>
          </div>

          <button
            id="deploy-new-btn"
            type="button"
            className="
              inline-flex items-center gap-2 px-5 py-2.5 rounded-lg
              bg-primary text-on-primary text-sm font-semibold
              hover:opacity-90 active:scale-95
              transition-all shadow-sm
              focus:outline-none focus:ring-2 focus:ring-primary/40
              flex-shrink-0
            "
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Deployment
          </button>
        </header>

        {/* ── Health summary ── */}
        <HealthSummaryBar analytics={MOCK_ANALYTICS} />

        {/* ── Analytics cards ── */}
        <AnalyticsGrid analytics={MOCK_ANALYTICS} />

        {/* ── Deployments list section ── */}
        <section aria-label="Deployment list">
          {/* Section header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold font-headline text-on-surface">
              Recent Deployments
            </h2>
          </div>

          {/* Filters */}
          <div className="mb-5">
            <DeploymentFiltersBar
              filters={filters}
              onChange={setFilters}
              totalCount={MOCK_DEPLOYMENTS.length}
              filteredCount={filteredCount}
            />
          </div>

          {/* List */}
          <DeploymentList
            deployments={MOCK_DEPLOYMENTS}
            filters={filters}
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
            onViewLogs={handleViewLogs}
            onRedeploy={handleRedeploy}
          />
        </section>
      </div>
    </AppShell>
  );
}
