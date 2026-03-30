import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTemplates, filtersFromSearchParams, filtersToQueryString } from './useTemplates';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const templateFixture = (id: string) => ({
  id,
  name: `Template ${id}`,
  description: 'A template',
  category: 'dex',
  blockchainType: 'stellar',
  baseRepositoryUrl: 'https://example.com',
  previewImageUrl: '',
  features: [],
  customizationSchema: {},
  isActive: true,
  createdAt: '2024-01-01T00:00:00Z',
});

describe('useTemplates', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetches templates on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [templateFixture('1')],
    });

    const { result } = renderHook(() => useTemplates());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.templates).toHaveLength(1);
    expect(result.current.templates[0].id).toBe('1');
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/templates',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('sets error on failed fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useTemplates());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to load templates (500)');
    expect(result.current.templates).toEqual([]);
  });

  it('includes category and search in API URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    renderHook(() => useTemplates({ category: 'dex', search: 'test' }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/templates?category=dex&search=test',
        expect.any(Object),
      ),
    );
  });

  it('re-fetches when category changes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { result } = renderHook(() => useTemplates());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setCategory('lending');
    });

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/templates?category=lending',
        expect.any(Object),
      ),
    );
  });

  it('re-fetches when search changes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { result } = renderHook(() => useTemplates());

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSearch('payment');
    });

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/templates?search=payment',
        expect.any(Object),
      ),
    );
  });

  it('retry re-fetches with current filters', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => [templateFixture('1')] });

    const { result } = renderHook(() => useTemplates());

    await waitFor(() => expect(result.current.error).toBeTruthy());

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.templates).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('shows friendly message for 429 responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
    });

    const { result } = renderHook(() => useTemplates());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Too many requests. Please try again in a moment.');
  });
});

describe('filtersFromSearchParams', () => {
  it('parses category from search params', () => {
    const params = new URLSearchParams('category=dex');
    expect(filtersFromSearchParams(params)).toEqual({ category: 'dex' });
  });

  it('parses search from search params', () => {
    const params = new URLSearchParams('search=stellar');
    expect(filtersFromSearchParams(params)).toEqual({ search: 'stellar' });
  });

  it('returns empty object for empty search params', () => {
    expect(filtersFromSearchParams(new URLSearchParams())).toEqual({});
  });

  it('parses both category and search', () => {
    const params = new URLSearchParams('category=lending&search=defi');
    expect(filtersFromSearchParams(params)).toEqual({
      category: 'lending',
      search: 'defi',
    });
  });
});

describe('filtersToQueryString', () => {
  it('serialises category', () => {
    expect(filtersToQueryString({ category: 'dex' })).toBe('category=dex');
  });

  it('serialises search', () => {
    expect(filtersToQueryString({ search: 'test' })).toBe('search=test');
  });

  it('returns empty string for empty filters', () => {
    expect(filtersToQueryString({})).toBe('');
  });

  it('serialises both category and search', () => {
    expect(filtersToQueryString({ category: 'payment', search: 'gateway' })).toBe(
      'category=payment&search=gateway',
    );
  });
});
