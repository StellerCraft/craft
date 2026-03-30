'use client';

import React from 'react';

/** Placeholder skeleton shown while deployments are loading */
export function DeploymentListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul aria-label="Loading deployments" className="space-y-3" role="list">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="
            flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4
            px-5 py-4 rounded-xl border border-outline-variant/10
            bg-surface-container-lowest animate-pulse
          "
          aria-hidden="true"
        >
          {/* Left */}
          <div className="flex-1 space-y-2 min-w-0">
            <div className="flex items-center gap-2">
              <div className="h-4 w-36 bg-surface-container rounded" />
              <div className="h-4 w-16 bg-surface-container rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-12 bg-surface-container rounded" />
              <div className="h-3 w-48 bg-surface-container rounded" />
            </div>
          </div>

          {/* Right */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="h-5 w-20 bg-surface-container rounded-full" />
            <div className="h-3 w-28 bg-surface-container rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}
