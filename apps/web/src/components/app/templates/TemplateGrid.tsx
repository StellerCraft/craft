import React from 'react';
import type { Template } from '@craft/types';
import { LoadingSkeleton } from '../LoadingSkeleton';
import { ErrorState } from '../ErrorState';
import { EmptyState } from '../EmptyState';
import { TemplateCard } from './TemplateCard';

interface TemplateGridProps {
  templates: Template[];
  loading: boolean;
  error: string | null;
  hasFilters: boolean;
  onRetry: () => void;
  onSelect?: (template: Template) => void;
  onClearFilters?: () => void;
}

function GridSkeleton() {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      aria-label="Loading templates"
      role="status"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 overflow-hidden"
        >
          <div className="aspect-video bg-surface-container-high animate-pulse" />
          <div className="p-5 space-y-3">
            <div className="h-5 bg-surface-container rounded w-2/3 animate-pulse" />
            <div className="h-4 bg-surface-container rounded w-full animate-pulse" />
            <div className="h-4 bg-surface-container rounded w-4/5 animate-pulse" />
            <div className="flex justify-between pt-3 border-t border-outline-variant/10">
              <div className="h-3 bg-surface-container rounded w-24 animate-pulse" />
              <div className="h-3 bg-surface-container rounded w-20 animate-pulse" />
            </div>
          </div>
        </div>
      ))}
      <span className="sr-only">Loading templates…</span>
    </div>
  );
}

export function TemplateGrid({
  templates,
  loading,
  error,
  hasFilters,
  onRetry,
  onSelect,
  onClearFilters,
}: TemplateGridProps) {
  if (loading) {
    return <GridSkeleton />;
  }

  if (error) {
    return (
      <ErrorState
        title="Failed to load templates"
        message={error}
        onRetry={onRetry}
      />
    );
  }

  if (templates.length === 0) {
    if (hasFilters) {
      return (
        <EmptyState
          icon="🔍"
          title="No templates found"
          description="Try adjusting your search or filters to find what you're looking for."
          primaryAction={
            onClearFilters
              ? { label: 'Clear Filters', onClick: onClearFilters }
              : undefined
          }
        />
      );
    }

    return (
      <EmptyState
        icon="📋"
        title="No templates available"
        description="Templates will appear here once they are published."
      />
    );
  }

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
      role="list"
      aria-label="Template catalog"
    >
      {templates.map((template) => (
        <div key={template.id} role="listitem">
          <TemplateCard template={template} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
