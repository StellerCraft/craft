'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Template, TemplateCategory, TemplateFilters } from '@craft/types';

export interface UseTemplatesState {
  templates: Template[];
  loading: boolean;
  error: string | null;
  filters: TemplateFilters;
}

export interface UseTemplatesReturn extends UseTemplatesState {
  setCategory: (category: TemplateCategory | undefined) => void;
  setSearch: (search: string) => void;
  retry: () => void;
}

function buildApiUrl(filters: TemplateFilters): string {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.search) params.set('search', filters.search);
  if (filters.blockchainType) params.set('blockchainType', filters.blockchainType);
  const qs = params.toString();
  return `/api/templates${qs ? `?${qs}` : ''}`;
}

/**
 * Reads TemplateFilters from URLSearchParams. Used to initialise the hook
 * state from the browser URL so that filters survive page reloads and are
 * shareable via link.
 */
export function filtersFromSearchParams(
  searchParams: URLSearchParams,
): TemplateFilters {
  const filters: TemplateFilters = {};
  const category = searchParams.get('category');
  if (category) filters.category = category as TemplateCategory;
  const search = searchParams.get('search');
  if (search) filters.search = search;
  return filters;
}

/**
 * Serialises TemplateFilters into a URLSearchParams-compatible string.
 * Empty/undefined values are omitted so the URL stays clean.
 */
export function filtersToQueryString(filters: TemplateFilters): string {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.search) params.set('search', filters.search);
  return params.toString();
}

export function useTemplates(initialFilters: TemplateFilters = {}): UseTemplatesReturn {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TemplateFilters>(initialFilters);
  const abortRef = useRef<AbortController | null>(null);

  const fetchTemplates = useCallback(async (currentFilters: TemplateFilters) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(buildApiUrl(currentFilters), {
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(
          res.status === 429
            ? 'Too many requests. Please try again in a moment.'
            : `Failed to load templates (${res.status})`,
        );
      }

      const data: Template[] = await res.json();
      setTemplates(data);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err?.message ?? 'An unexpected error occurred');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchTemplates(filters);
    return () => abortRef.current?.abort();
  }, [filters, fetchTemplates]);

  const setCategory = useCallback((category: TemplateCategory | undefined) => {
    setFilters((prev) => ({ ...prev, category }));
  }, []);

  const setSearch = useCallback((search: string) => {
    setFilters((prev) => ({ ...prev, search: search || undefined }));
  }, []);

  const retry = useCallback(() => {
    fetchTemplates(filters);
  }, [filters, fetchTemplates]);

  return { templates, loading, error, filters, setCategory, setSearch, retry };
}
