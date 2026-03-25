'use client';

import React from 'react';
import { StatusType } from '@/types/navigation';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  onClick?: () => void;
}

const statusConfig = {
  operational: {
    label: 'ALL OPERATIONAL',
    dotColor: 'bg-green-500',
    bgColor: 'bg-green-50',
    textColor: 'text-green-800',
  },
  degraded: {
    label: 'DEGRADED PERFORMANCE',
    dotColor: 'bg-yellow-500',
    bgColor: 'bg-yellow-50',
    textColor: 'text-yellow-800',
  },
  outage: {
    label: 'SERVICE OUTAGE',
    dotColor: 'bg-red-500',
    bgColor: 'bg-red-50',
    textColor: 'text-red-800',
  },
  maintenance: {
    label: 'MAINTENANCE',
    dotColor: 'bg-blue-500',
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-800',
  },
};

export function StatusBadge({ status, label, onClick }: StatusBadgeProps) {
  const config = statusConfig[status];
  const displayLabel = label || config.label;

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`
        inline-flex items-center gap-2 px-3 py-1.5 rounded-full
        text-[11px] font-bold tracking-wider uppercase
        ${config.bgColor} ${config.textColor}
        ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}
      `}
      {...(onClick && { type: 'button' })}
    >
      <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
      {displayLabel}
    </Component>
  );
}
