/**
 * Tests for DeploymentFiltersBar — #1332
 *
 * Verifies that filter state is persisted to the URL and is restored correctly
 * from query parameters so that browser back/forward navigation preserves the
 * previously-applied filter state.
 *
 * ⚠️  DO NOT run this test file in production. It is a unit/integration test
 *     only and relies on mocked Next.js navigation hooks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DeploymentFiltersBar, filtersFromSearchParams } from './DeploymentFiltersBar';
import type { DeploymentFilters } from '@/types/deployment';

// ---------------------------------------------------------------------------
// Mock next/navigation — vitest doesn't run in a Next.js context
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockSearchParamsGet = vi.fn((_key: string) => null);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/app/deployments',
  useSearchParams: () => ({
    get: mockSearchParamsGet,
    toString: () => '',
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultFilters: DeploymentFilters = {
  status: 'all',
  environment: 'all',
  search: '',
};

function renderBar(
  overrides: Partial<DeploymentFilters> = {},
  syncToUrl = true,
  onChange = vi.fn(),
) {
  const filters = { ...defaultFilters, ...overrides };
  return render(
    <DeploymentFiltersBar
      filters={filters}
      onChange={onChange}
      totalCount={10}
      filteredCount={10}
      syncToUrl={syncToUrl}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeploymentFiltersBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
  });

  it('renders the search input and filter dropdowns', () => {
    renderBar();
    expect(screen.getByRole('searchbox')).toBeDefined();
    expect(screen.getByLabelText('Filter by status')).toBeDefined();
    expect(screen.getByLabelText('Filter by environment')).toBeDefined();
  });

  it('calls onChange when the search input changes', () => {
    const onChange = vi.fn();
    renderBar({}, true, onChange);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'my-app' } });
    expect(onChange).toHaveBeenCalledWith({ ...defaultFilters, search: 'my-app' });
  });

  it('calls onChange when the status filter changes', () => {
    const onChange = vi.fn();
    renderBar({}, true, onChange);
    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'failed' },
    });
    expect(onChange).toHaveBeenCalledWith({ ...defaultFilters, status: 'failed' });
  });

  it('calls onChange when the environment filter changes', () => {
    const onChange = vi.fn();
    renderBar({}, true, onChange);
    fireEvent.change(screen.getByLabelText('Filter by environment'), {
      target: { value: 'production' },
    });
    expect(onChange).toHaveBeenCalledWith({ ...defaultFilters, environment: 'production' });
  });

  it('pushes filter state to the URL via router.replace when syncToUrl=true', async () => {
    renderBar({ status: 'failed' });
    // The effect fires asynchronously after render.
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalled();
    });
    const [url] = mockReplace.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain('status=failed');
  });

  it('does NOT call router.replace when syncToUrl=false', async () => {
    renderBar({ status: 'failed' }, false);
    // Give any pending effects time to fire.
    await new Promise((r) => setTimeout(r, 50));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // #1332 — back-navigation restoration -------------------------------------------

  it('filtersFromSearchParams reads status, environment, and search from params', () => {
    const params = new URLSearchParams('status=failed&environment=production&search=my-app');
    const filters = filtersFromSearchParams(params);
    expect(filters.status).toBe('failed');
    expect(filters.environment).toBe('production');
    expect(filters.search).toBe('my-app');
  });

  it('filtersFromSearchParams returns defaults when params are absent', () => {
    const params = new URLSearchParams('');
    const filters = filtersFromSearchParams(params);
    expect(filters.status).toBe('all');
    expect(filters.environment).toBe('all');
    expect(filters.search).toBe('');
  });

  it('calls onChange with URL-derived filters on mount when they differ from props', async () => {
    // Simulate landing on a URL that already has filters set (e.g. after back nav).
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'status') return 'success';
      if (key === 'environment') return 'staging';
      if (key === 'search') return 'my-service';
      return null;
    });

    const onChange = vi.fn();
    render(
      <DeploymentFiltersBar
        filters={defaultFilters}   // parent starts with no filters
        onChange={onChange}
        totalCount={5}
        filteredCount={5}
        syncToUrl
      />,
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({
        status: 'success',
        environment: 'staging',
        search: 'my-service',
      });
    });
  });

  it('does not call onChange on mount when URL params match the current filter props', async () => {
    mockSearchParamsGet.mockImplementation((key: string) => {
      if (key === 'status') return 'failed';
      return null;
    });

    const onChange = vi.fn();
    render(
      <DeploymentFiltersBar
        filters={{ ...defaultFilters, status: 'failed' }}
        onChange={onChange}
        totalCount={5}
        filteredCount={3}
        syncToUrl
      />,
    );

    // Slight delay to allow effects to settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the clear-filters button only when active filters exist', () => {
    const { rerender } = renderBar();
    expect(screen.queryByText('Clear filters')).toBeNull();

    rerender(
      <DeploymentFiltersBar
        filters={{ status: 'failed', environment: 'all', search: '' }}
        onChange={vi.fn()}
        totalCount={10}
        filteredCount={3}
      />,
    );
    expect(screen.getByText('Clear filters')).toBeDefined();
  });
});
