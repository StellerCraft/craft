import type { DeploymentDetailStatus } from '@/types/deployment';

export interface DeploymentDetailStatusPresentation {
  label: string;
  description: string;
  dotClass: string;
  bgClass: string;
  textClass: string;
  trackClass: string;
  fillClass: string;
}

const STATUS_PRESENTATION: Record<DeploymentDetailStatus, DeploymentDetailStatusPresentation> = {
  pending: {
    label: 'Pending',
    description: 'Deployment is queued and waiting to start.',
    dotClass: 'bg-amber-500',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-700',
    trackClass: 'bg-amber-100',
    fillClass: 'bg-amber-500',
  },
  generating: {
    label: 'Generating',
    description: 'Generating deployment configuration.',
    dotClass: 'bg-blue-500',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-700',
    trackClass: 'bg-blue-100',
    fillClass: 'bg-blue-500',
  },
  creating_repo: {
    label: 'Creating Repository',
    description: 'Creating a repository for generated code.',
    dotClass: 'bg-indigo-500',
    bgClass: 'bg-indigo-50',
    textClass: 'text-indigo-700',
    trackClass: 'bg-indigo-100',
    fillClass: 'bg-indigo-500',
  },
  pushing_code: {
    label: 'Pushing Code',
    description: 'Uploading files and commit history.',
    dotClass: 'bg-cyan-500',
    bgClass: 'bg-cyan-50',
    textClass: 'text-cyan-700',
    trackClass: 'bg-cyan-100',
    fillClass: 'bg-cyan-500',
  },
  deploying: {
    label: 'Deploying',
    description: 'Publishing the project to hosting infrastructure.',
    dotClass: 'bg-violet-500',
    bgClass: 'bg-violet-50',
    textClass: 'text-violet-700',
    trackClass: 'bg-violet-100',
    fillClass: 'bg-violet-500',
  },
  completed: {
    label: 'Completed',
    description: 'Deployment completed successfully.',
    dotClass: 'bg-green-500',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
    trackClass: 'bg-green-100',
    fillClass: 'bg-green-500',
  },
  failed: {
    label: 'Failed',
    description: 'Deployment failed and needs attention.',
    dotClass: 'bg-red-500',
    bgClass: 'bg-red-50',
    textClass: 'text-red-700',
    trackClass: 'bg-red-100',
    fillClass: 'bg-red-500',
  },
};

const DEFAULT_PROGRESS: Record<DeploymentDetailStatus, number> = {
  pending: 0,
  generating: 20,
  creating_repo: 40,
  pushing_code: 60,
  deploying: 80,
  completed: 100,
  failed: 0,
};

const ACTIVE_STATUSES = new Set<DeploymentDetailStatus>([
  'pending',
  'generating',
  'creating_repo',
  'pushing_code',
  'deploying',
]);

export function getDeploymentDetailStatusPresentation(
  status: DeploymentDetailStatus,
): DeploymentDetailStatusPresentation {
  return STATUS_PRESENTATION[status];
}

export function getDeploymentDefaultProgress(status: DeploymentDetailStatus): number {
  return DEFAULT_PROGRESS[status];
}

export function isDeploymentDetailStatusActive(status: DeploymentDetailStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}
