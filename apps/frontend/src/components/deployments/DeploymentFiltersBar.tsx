'use client';

import React, { useEffect, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { DeploymentFilters, DeploymentFilterStatus, DeploymentFilterEnvironment } from '@/types/deployment';

interface DeploymentFiltersBarProps {
  filters: DeploymentFilters;
  onChange: (filters: DeploymentFilters) => void;
  totalCount: number;
  filteredCount: number;
  /**
   * When true (default), filter state is mirrored to the URL as query
   * parameters so that browser back/forward navigation restores the previously-
   * applied filters.  Set to false to keep filter state purely in-memory (e.g.
   * inside a modal or embedded panel where URL mutation is undesirable).
   */
  syncToUrl?: boolean;
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

/**
 * Search, status, and environment filters for the deployments list.
 *
 * This is a controlled component: it owns no filter state itself. The parent
 * owns `filters` and is the reference implementation for the codebase's
 * **URL-synced filters** convention (see "URL-synced filters" in
 * CONTRIBUTING.md), which makes filtered views shareable and refresh-safe:
 *
 * 1. Derive the initial filter state from `useSearchParams()` (the URL is the
 *    source of truth on first render; unknown values fall back to defaults).
 * 2. Keep the live state in React so typing stays responsive.
 * 3. Write changes back with a debounced `router.replace(..., { scroll: false })`
 *    — `replace`, not `push`, so each keystroke doesn't add a history entry.
 *    Omit default values so an unfiltered view has a clean URL.
 *
 * `useSearchParams()` makes the consuming page a Client Component and must sit
 * under a `<Suspense>` boundary. A Server Component page can instead read its
 * `searchParams` prop and pass them down as `initialFilters`, so the first,
 * server-rendered list is already filtered.
 *
 * @example
 * ```tsx
 * // app/app/deployments/page.tsx (Server Component)
 * export default function DeploymentsPage({
 *   searchParams,
 * }: { searchParams: Record<string, string | undefined> }) {
 *   return (
 *     <Suspense fallback={<DeploymentListSkeleton />}>
 *       <DeploymentsView initialFilters={filtersFromSearchParams(new URLSearchParams(searchParams as Record<string, string>))} />
 *     </Suspense>
 *   );
 * }
 *
 * // DeploymentsView.tsx
 * 'use client';
 *
 * const DEFAULT_FILTERS: DeploymentFilters = { status: 'all', environment: 'all', search: '' };
 *
 * function filtersToQueryString(filters: DeploymentFilters): string {
 *   const params = new URLSearchParams();
 *   if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status);
 *   if (filters.environment !== DEFAULT_FILTERS.environment) params.set('environment', filters.environment);
 *   if (filters.search) params.set('search', filters.search);
 *   return params.toString();
 * }
 *
 * export function DeploymentsView({ initialFilters }: { initialFilters?: DeploymentFilters }) {
 *   const searchParams = useSearchParams();
 *   const router = useRouter();
 *   const pathname = usePathname();
 *   const [filters, setFilters] = useState<DeploymentFilters>(
 *     () => initialFilters ?? filtersFromSearchParams(searchParams),
 *   );
 *
 *   // Debounced URL write: only the settled value reaches the address bar.
 *   useEffect(() => {
 *     const handle = setTimeout(() => {
 *       const qs = filtersToQueryString(filters);
 *       if (qs !== searchParams.toString()) {
 *         router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
 *       }
 *     }, 300);
 *     return () => clearTimeout(handle);
 *   }, [filters, pathname, router, searchParams]);
 *
 *   const visible = applyFilters(deployments, filters);
 *
 *   return (
 *     <DeploymentFiltersBar
 *       filters={filters}
 *       onChange={setFilters}
 *       totalCount={deployments.length}
 *       filteredCount={visible.length}
 *     />
 *   );
 * }
 * ```
 */

/** Build a URLSearchParams string from the current filter values. */
function filtersToParams(filters: DeploymentFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.environment !== 'all') params.set('environment', filters.environment);
  if (filters.search) params.set('search', filters.search);
  return params;
}

/** Read filter values back out of a URLSearchParams instance. */
export function filtersFromSearchParams(
  searchParams: URLSearchParams | ReturnType<typeof useSearchParams>,
): DeploymentFilters {
  return {
    status: (searchParams.get('status') as DeploymentFilterStatus) ?? 'all',
    environment: (searchParams.get('environment') as DeploymentFilterEnvironment) ?? 'all',
    search: searchParams.get('search') ?? '',
  };
}

export function DeploymentFiltersBar({
  filters,
  onChange,
  totalCount,
  filteredCount,
  syncToUrl = true,
}: DeploymentFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Debounce timer ref — text search updates are debounced so that every
  // keystroke doesn't push a new history entry.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount (or when the URL changes externally, e.g. browser back), read the
  // query parameters and propagate them to the parent so the deployment list
  // re-filters without a full reload.  We only do this when syncToUrl is true.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!syncToUrl) return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      const fromUrl = filtersFromSearchParams(searchParams);
      // Avoid a redundant onChange call if the parent already provided matching
      // filters (e.g. SSR-hydrated state).
      if (
        fromUrl.status !== filters.status ||
        fromUrl.environment !== filters.environment ||
        fromUrl.search !== filters.search
      ) {
        onChange(fromUrl);
      }
    }
  }, [syncToUrl, searchParams, filters, onChange]);

  // Whenever filters change, reflect them in the URL (debounced for search).
  useEffect(() => {
    if (!syncToUrl) return;

    const commit = () => {
      const params = filtersToParams(filters);
      const qs = params.toString();
      const target = qs ? `${pathname}?${qs}` : pathname;
      // Use replace so each filter change doesn't push a new history entry;
      // the back button jumps to the page the user came from, not the previous
      // filter combination (which would be disorienting).
      router.replace(target, { scroll: false });
    };

    // Debounce only text-search updates; dropdown changes are applied immediately.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(commit, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, pathname, router, syncToUrl]);

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
