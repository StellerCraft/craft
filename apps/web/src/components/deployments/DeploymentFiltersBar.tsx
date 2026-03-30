'use client';

import React from 'react';
import type { DeploymentFilters, DeploymentFilterStatus, DeploymentFilterEnvironment } from '@/types/deployment';

interface DeploymentFiltersBarProps {
  filters: DeploymentFilters;
  onChange: (filters: DeploymentFilters) => void;
  totalCount: number;
  filteredCount: number;
}

const STATUS_OPTIONS: { value: DeploymentFilterStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'queued', label: 'Queued' },
  { value: 'rolling-back', label: 'Rolling Back' },
  { value: 'cancelled', label: 'Cancelled' },
];

const ENV_OPTIONS: { value: DeploymentFilterEnvironment; label: string }[] = [
  { value: 'all', label: 'All environments' },
  { value: 'production', label: 'Production' },
  { value: 'staging', label: 'Staging' },
  { value: 'preview', label: 'Preview' },
  { value: 'development', label: 'Development' },
];

export function DeploymentFiltersBar({
  filters,
  onChange,
  totalCount,
  filteredCount,
}: DeploymentFiltersBarProps) {
  const update = <K extends keyof DeploymentFilters>(key: K, value: DeploymentFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const hasActiveFilters =
    filters.status !== 'all' || filters.environment !== 'all' || filters.search !== '';

  const selectBase =
    'bg-surface-container-lowest border border-outline-variant/20 rounded-lg text-sm text-on-surface px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-colors appearance-none cursor-pointer hover:border-outline-variant/40';

  return (
    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
      {/* Left: search + dropdowns */}
      <div className="flex flex-col sm:flex-row gap-3 flex-1 min-w-0">
        {/* Search */}
        <div className="relative flex-1 min-w-0 max-w-xs">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
            aria-hidden="true"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </span>
          <input
            id="deployment-search"
            type="search"
            placeholder="Search deployments…"
            value={filters.search}
            onChange={(e) => update('search', e.target.value)}
            aria-label="Search deployments by name, author, or commit"
            className="
              w-full bg-surface-container-lowest border border-outline-variant/20 rounded-lg
              text-sm text-on-surface pl-9 pr-3 py-2
              focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
              transition-colors placeholder:text-on-surface-variant/50
            "
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            id="deployment-filter-status"
            value={filters.status}
            onChange={(e) => update('status', e.target.value as DeploymentFilterStatus)}
            aria-label="Filter by status"
            className={selectBase}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" aria-hidden="true">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </div>

        {/* Environment filter */}
        <div className="relative">
          <select
            id="deployment-filter-env"
            value={filters.environment}
            onChange={(e) => update('environment', e.target.value as DeploymentFilterEnvironment)}
            aria-label="Filter by environment"
            className={selectBase}
          >
            {ENV_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant" aria-hidden="true">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </div>
      </div>

      {/* Right: result count + clear */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-on-surface-variant" aria-live="polite" aria-atomic="true">
          {filteredCount === totalCount
            ? `${totalCount} deployment${totalCount !== 1 ? 's' : ''}`
            : `${filteredCount} of ${totalCount}`}
        </span>

        {hasActiveFilters && (
          <button
            id="deployment-clear-filters"
            type="button"
            onClick={() => onChange({ status: 'all', environment: 'all', search: '' })}
            className="text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 rounded px-1"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
