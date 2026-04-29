'use client';

import React from 'react';
import type { DeploymentDetailStatus } from '@/types/deployment';
import {
  getDeploymentDefaultProgress,
  getDeploymentDetailStatusPresentation,
  isDeploymentDetailStatusActive,
} from './deployment-detail-status';
import { DeploymentDetailStatusBadge } from './DeploymentDetailStatusBadge';

interface DeploymentProgressIndicatorProps {
  status: DeploymentDetailStatus;
  percentage?: number;
  description?: string;
  updatedAt?: string | null;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatUpdatedAt(value?: string | null): string | null {
  if (!value) return null;

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;

  return timestamp.toLocaleString();
}

export function DeploymentProgressIndicator({
  status,
  percentage,
  description,
  updatedAt,
}: DeploymentProgressIndicatorProps) {
  const presentation = getDeploymentDetailStatusPresentation(status);
  const progress = clampPercentage(percentage ?? getDeploymentDefaultProgress(status));
  const showActivityPulse = isDeploymentDetailStatusActive(status);
  const lastUpdated = formatUpdatedAt(updatedAt);

  return (
    <section
      aria-label="Deployment progress"
      className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DeploymentDetailStatusBadge status={status} />
        <span className="text-sm font-semibold text-on-surface">{progress}%</span>
      </div>

      <p className="mt-2 text-sm text-on-surface-variant">{description ?? presentation.description}</p>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${progress}%`}
        className={`mt-3 h-2 w-full overflow-hidden rounded-full ${presentation.trackClass}`}
      >
        <div
          className={`h-full transition-all duration-500 ${presentation.fillClass} ${showActivityPulse ? 'animate-pulse' : ''}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {lastUpdated && (
        <p className="mt-2 text-xs text-on-surface-variant" data-testid="deployment-progress-updated-at">
          Last updated: {lastUpdated}
        </p>
      )}
    </section>
  );
}
