'use client';

import React from 'react';
import type { DeploymentStatus } from '@/types/deployment';

interface DeploymentStatusBadgeProps {
  status: DeploymentStatus;
  /** Show a pulsing dot for in-progress states */
  animated?: boolean;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<
  DeploymentStatus,
  { label: string; dotClass: string; bgClass: string; textClass: string }
> = {
  running: {
    label: 'Running',
    dotClass: 'bg-blue-500',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-700',
  },
  success: {
    label: 'Success',
    dotClass: 'bg-green-500',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
  },
  failed: {
    label: 'Failed',
    dotClass: 'bg-red-500',
    bgClass: 'bg-red-50',
    textClass: 'text-red-700',
  },
  queued: {
    label: 'Queued',
    dotClass: 'bg-amber-500',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-700',
  },
  cancelled: {
    label: 'Cancelled',
    dotClass: 'bg-outline',
    bgClass: 'bg-surface-container',
    textClass: 'text-on-surface-variant',
  },
  'rolling-back': {
    label: 'Rolling Back',
    dotClass: 'bg-purple-500',
    bgClass: 'bg-purple-50',
    textClass: 'text-purple-700',
  },
};

const ANIMATED_STATUSES: DeploymentStatus[] = ['running', 'queued', 'rolling-back'];

export function DeploymentStatusBadge({
  status,
  animated = true,
  size = 'md',
}: DeploymentStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const isAnimated = animated && ANIMATED_STATUSES.includes(status);

  const sizeClasses =
    size === 'sm'
      ? 'px-2 py-0.5 text-[10px] gap-1.5'
      : 'px-3 py-1 text-xs gap-2';

  return (
    <span
      className={`
        inline-flex items-center font-semibold tracking-wide uppercase rounded-full
        ${sizeClasses} ${config.bgClass} ${config.textClass}
      `}
    >
      <span
        className={`
          rounded-full flex-shrink-0
          ${size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2'}
          ${config.dotClass}
          ${isAnimated ? 'animate-pulse' : ''}
        `}
      />
      {config.label}
    </span>
  );
}
