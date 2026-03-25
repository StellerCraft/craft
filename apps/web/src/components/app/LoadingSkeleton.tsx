import React from 'react';

interface LoadingSkeletonProps {
  variant?: 'text' | 'rect' | 'circle' | 'card' | 'list';
  count?: number;
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function LoadingSkeleton({
  variant = 'text',
  count = 1,
  width,
  height,
  className = '',
}: LoadingSkeletonProps) {
  const baseClasses = 'animate-pulse bg-gradient-to-r from-surface-container-low via-surface-container to-surface-container-low bg-[length:200%_100%]';

  const getVariantClasses = () => {
    switch (variant) {
      case 'text':
        return 'h-4 rounded';
      case 'rect':
        return 'rounded-lg';
      case 'circle':
        return 'rounded-full';
      case 'card':
        return 'h-48 rounded-xl';
      case 'list':
        return 'h-16 rounded-lg';
      default:
        return '';
    }
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  if (variant === 'card') {
    return (
      <div className="space-y-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className={`${baseClasses} ${getVariantClasses()} ${className}`} style={style}>
            <div className="p-4 space-y-3">
              <div className="h-32 bg-surface-container-high rounded" />
              <div className="h-4 bg-surface-container-high rounded w-3/4" />
              <div className="h-3 bg-surface-container-high rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4 bg-surface-container-lowest rounded-lg">
            <div className="w-12 h-12 bg-surface-container rounded-full animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-surface-container rounded w-3/4 animate-pulse" />
              <div className="h-3 bg-surface-container rounded w-1/2 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`${baseClasses} ${getVariantClasses()} ${className}`}
          style={style}
        />
      ))}
    </div>
  );
}
