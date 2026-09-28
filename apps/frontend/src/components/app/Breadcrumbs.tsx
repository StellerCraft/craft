'use client';

import React from 'react';
import Link from 'next/link';
import { Breadcrumb } from '@/types/navigation';

interface BreadcrumbsProps {
  items: Breadcrumb[];
  /**
   * Maximum number of segments to display before collapsing middle items into
   * an ellipsis affordance. Must be ≥ 3 to have any effect (first + ellipsis +
   * last). Defaults to 4.
   */
  maxItems?: number;
  separator?: React.ReactNode;
}

export function Breadcrumbs({
  items,
  maxItems = 4,
  separator = '/',
}: BreadcrumbsProps) {
  if (items.length === 0) return null;

  // Collapse middle segments when the trail is long.
  // Requires maxItems ≥ 3: we always keep the first and last segment.
  const shouldTruncate = items.length > maxItems && maxItems >= 3;
  let processedItems: Breadcrumb[];

  if (shouldTruncate) {
    // Keep first segment, an ellipsis placeholder, and the last (maxItems - 2) segments.
    const tail = items.slice(-(maxItems - 2));
    processedItems = [
      items[0],
      { label: '…', path: undefined },
      ...tail,
    ];
  } else {
    processedItems = items;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      // `min-w-0` on the flex container lets child flex items shrink below their
      // content size so text-overflow: ellipsis can actually fire.
      className="flex items-center gap-2 text-sm min-w-0"
    >
      {processedItems.map((item, index) => {
        const isLast = index === processedItems.length - 1;
        const isEllipsis = item.label === '…';

        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <span className="text-on-surface-variant/40 select-none flex-shrink-0">
                {separator}
              </span>
            )}
            {isEllipsis ? (
              // Non-interactive ellipsis collapse indicator.
              <span
                className="text-on-surface-variant flex-shrink-0"
                aria-hidden="true"
              >
                …
              </span>
            ) : isLast || !item.path ? (
              // Current / non-navigable segment — truncate with ellipsis and
              // expose full text via title so keyboard/mouse users can discover it.
              <span
                className="text-on-surface font-medium truncate min-w-0"
                title={item.label}
              >
                {item.label}
              </span>
            ) : (
              // Navigable ancestor segment — also truncate and expose via title.
              <Link
                href={item.path}
                className="text-on-surface-variant hover:text-on-surface transition-colors truncate min-w-0"
                title={item.label}
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
