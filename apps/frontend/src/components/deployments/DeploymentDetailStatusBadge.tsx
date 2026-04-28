'use client';

import React from 'react';
import type { DeploymentDetailStatus } from '@/types/deployment';
import {
  getDeploymentDetailStatusPresentation,
  isDeploymentDetailStatusActive,
} from './deployment-detail-status';

interface DeploymentDetailStatusBadgeProps {
  status: DeploymentDetailStatus;
  size?: 'sm' | 'md';
  animated?: boolean;
}

export function DeploymentDetailStatusBadge({
  status,
  size = 'md',
  animated = true,
}: DeploymentDetailStatusBadgeProps) {
  const presentation = getDeploymentDetailStatusPresentation(status);
  const shouldAnimate = animated && isDeploymentDetailStatusActive(status);

  const sizeClass = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs';
  const dotSizeClass = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full font-semibold uppercase tracking-wide ${sizeClass} ${presentation.bgClass} ${presentation.textClass}`}
      title={presentation.description}
    >
      <span
        className={`rounded-full ${dotSizeClass} ${presentation.dotClass} ${shouldAnimate ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      {presentation.label}
    </span>
  );
}
