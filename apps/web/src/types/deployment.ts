/**
 * Deployment domain types.
 * All data contracts here must stay consistent with the backend API spec.
 */

export type DeploymentStatus =
  | 'running'
  | 'success'
  | 'failed'
  | 'queued'
  | 'cancelled'
  | 'rolling-back';

export type DeploymentEnvironment = 'production' | 'staging' | 'preview' | 'development';

export type DeploymentTrigger = 'push' | 'manual' | 'schedule' | 'api';

export interface DeploymentCommit {
  sha: string;
  message: string;
  author: string;
  branch: string;
}

export interface DeploymentRegion {
  id: string;
  label: string;
  flag: string;
}

export interface Deployment {
  id: string;
  name: string;
  status: DeploymentStatus;
  environment: DeploymentEnvironment;
  trigger: DeploymentTrigger;
  commit: DeploymentCommit;
  region: DeploymentRegion;
  /** ISO-8601 timestamp */
  createdAt: string;
  /** ISO-8601 timestamp – undefined while still running */
  completedAt?: string;
  /** Duration in seconds */
  durationSeconds?: number;
  /** URL of the deployed instance */
  url?: string;
  /** Build logs URL */
  logsUrl?: string;
}

export interface DeploymentAnalytics {
  totalDeployments: number;
  successRate: number; // 0-100
  avgDurationSeconds: number;
  activeDeployments: number;
  failedLast24h: number;
  deploymentsToday: number;
  /** Trend vs previous period: positive = improved */
  successRateTrend: number;
  avgDurationTrend: number;
}

export type DeploymentFilterStatus = 'all' | DeploymentStatus;
export type DeploymentFilterEnvironment = 'all' | DeploymentEnvironment;

export interface DeploymentFilters {
  status: DeploymentFilterStatus;
  environment: DeploymentFilterEnvironment;
  search: string;
}
