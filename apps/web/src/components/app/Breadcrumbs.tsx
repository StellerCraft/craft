'use client';

import React from 'react';
import Link from 'next/link';
import { Breadcrumb } from '@/types/navigation';

interface BreadcrumbsProps {
  items: Breadcrumb[];
  maxItems?: number;
  separator?: React.ReactNode;
}

export function Breadcrumbs({ 
  items, 
  maxItems = 3,
  separator = '/'
}: BreadcrumbsProps) {
  if (items.length === 0) return null;

  // Responsive behavior: show only last item on mobile
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const displayItems = isMobile ? [items[items.length - 1]] : items;

  // Truncate middle items if too many
  const shouldTruncate = displayItems.length > maxItems && maxItems > 2;
  let processedItems = displayItems;

  if (shouldTruncate) {
    processedItems = [
      displayItems[0],
      { label: '...', path: undefined },
      ...displayItems.slice(-(maxItems - 2))
    ];
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
      {processedItems.map((item, index) => {
        const isLast = index === processedItems.length - 1;
        const isEllipsis = item.label === '...';

        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <span className="text-on-surface-variant/40 select-none">
                {separator}
              </span>
            )}
            {isEllipsis ? (
              <span className="text-on-surface-variant">...</span>
            ) : isLast || !item.path ? (
              <span className="text-on-surface font-medium">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.path}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
              >
                {item.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
