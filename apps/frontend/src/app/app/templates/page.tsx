'use client';

import { useCallback, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { AppShell } from '@/components/app';
import {
  TemplateCatalogFilters,
  TemplateGrid,
  useTemplates,
  filtersFromSearchParams,
  filtersToQueryString,
} from '@/components/app/templates';
import { User, NavItem } from '@/types/navigation';
import type { Template, TemplateCategory } from '@craft/types';

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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    path: '/app',
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    path: '/app/deployments',
  },
  {
    id: 'customize',
    label: 'Customize',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
      </svg>
    ),
    path: '/app/customize',
  },
  {
    id: 'billing',
    label: 'Billing',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    path: '/app/billing',
  },
];

export default function TemplateCatalogPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initialFilters = filtersFromSearchParams(searchParams);
  const { templates, loading, error, filters, setCategory, setSearch, retry } =
    useTemplates(initialFilters);

  const hasFilters = !!(filters.category || filters.search);

  // Sync filter state back to the URL so it's shareable and survives refresh
  useEffect(() => {
    const qs = filtersToQueryString(filters);
    const target = qs ? `${pathname}?${qs}` : pathname;
    const current = searchParams.toString();
    if (qs !== current) {
      router.replace(target, { scroll: false });
    }
  }, [filters, pathname, router, searchParams]);

  const handleCategoryChange = useCallback(
    (category: TemplateCategory | undefined) => {
      setCategory(category);
    },
    [setCategory],
  );

  const handleSearchChange = useCallback(
    (search: string) => {
      setSearch(search);
    },
    [setSearch],
  );

  const handleClearFilters = useCallback(() => {
    setCategory(undefined);
    setSearch('');
  }, [setCategory, setSearch]);

  const handleSelectTemplate = useCallback(
    (template: Template) => {
      router.push(`/app/templates/${template.id}`);
    },
    [router],
  );

  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[
        { label: 'Home', path: '/app' },
        { label: 'Templates' },
      ]}
      status="operational"
      onStatusClick={() => window.open('https://status.craft.com', '_blank')}
    >
      <div className="p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold font-headline text-on-surface mb-2">
              Template Catalog
            </h1>
            <p className="text-on-surface-variant">
              Browse and select from our collection of Stellar blockchain templates.
            </p>
          </div>

          <div className="mb-8">
            <TemplateCatalogFilters
              selectedCategory={filters.category}
              searchQuery={filters.search}
              onCategoryChange={handleCategoryChange}
              onSearchChange={handleSearchChange}
            />
          </div>

          {hasFilters && !loading && !error && templates.length > 0 && (
            <p className="text-sm text-on-surface-variant mb-4" aria-live="polite">
              {templates.length} template{templates.length !== 1 ? 's' : ''} found
            </p>
          )}

          <TemplateGrid
            templates={templates}
            loading={loading}
            error={error}
            hasFilters={hasFilters}
            onRetry={retry}
            onSelect={handleSelectTemplate}
            onClearFilters={handleClearFilters}
          />
        </div>
      </div>
    </AppShell>
  );
}
