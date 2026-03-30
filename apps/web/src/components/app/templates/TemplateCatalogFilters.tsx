'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { TemplateCategory } from '@craft/types';

const CATEGORIES: { value: TemplateCategory; label: string }[] = [
  { value: 'dex', label: 'DEX' },
  { value: 'lending', label: 'Lending' },
  { value: 'payment', label: 'Payment' },
  { value: 'asset-issuance', label: 'Asset Issuance' },
];

interface TemplateCatalogFiltersProps {
  selectedCategory?: TemplateCategory;
  searchQuery?: string;
  onCategoryChange: (category: TemplateCategory | undefined) => void;
  onSearchChange: (search: string) => void;
}

export function TemplateCatalogFilters({
  selectedCategory,
  searchQuery = '',
  onCategoryChange,
  onSearchChange,
}: TemplateCatalogFiltersProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocalSearch(searchQuery);
  }, [searchQuery]);

  const handleSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setLocalSearch(value);

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchChange(value);
    }, 300);
  };

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Search */}
      <div className="relative flex-1 max-w-md">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-on-surface-variant/60"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="search"
          value={localSearch}
          onChange={handleSearchInput}
          placeholder="Search templates…"
          aria-label="Search templates"
          className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-surface-container-low border border-outline-variant/20 text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all text-sm"
        />
      </div>

      {/* Category chips */}
      <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onCategoryChange(undefined)}
          aria-pressed={selectedCategory === undefined}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
            selectedCategory === undefined
              ? 'primary-gradient text-on-primary shadow-sm'
              : 'bg-surface-container-low text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container hover:text-on-surface'
          }`}
        >
          All
        </button>

        {CATEGORIES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => onCategoryChange(value === selectedCategory ? undefined : value)}
            aria-pressed={value === selectedCategory}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
              value === selectedCategory
                ? 'primary-gradient text-on-primary shadow-sm'
                : 'bg-surface-container-low text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
