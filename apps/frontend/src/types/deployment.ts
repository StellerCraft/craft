/**
 * Deployment domain types.
 * All data contracts here must stay consistent with backend API contracts.
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
  /** ISO-8601 timestamp; undefined while still running */
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

/**
 * Backend deployment detail/status route contract.
 * Mirrors apps/backend/src/app/api/deployments/[id] routes.
 */
export type DeploymentDetailStatus =
  | 'pending'
  | 'generating'
  | 'creating_repo'
  | 'pushing_code'
  | 'deploying'
  | 'completed'
  | 'failed';

export interface DeploymentDetail {
  id: string;
  name: string;
  status: DeploymentDetailStatus;
  templateId: string | null;
  vercelProjectId: string | null;
  deploymentUrl: string | null;
  repositoryUrl: string | null;
  customizationConfig: Record<string, unknown> | null;
  errorMessage: string | null;
  timestamps: {
    created: string;
    updated: string;
    deployed: string | null;
  };
}

export interface DeploymentProgressMetadata {
  stage: string;
  percentage: number;
  description: string;
}

export interface DeploymentStatusSnapshot {
  id: string;
  status: DeploymentDetailStatus;
  error: string | null;
  deploymentUrl: string | null;
  timestamps: {
    created: string;
    updated: string;
    deployed: string | null;
  };
  progress: DeploymentProgressMetadata;
}

export type DeploymentLogLevel = 'info' | 'warn' | 'error';

export interface DeploymentLogEntry {
  id: string;
  deploymentId: string;
  timestamp: string;
  level: DeploymentLogLevel;
  message: string;
}

export interface DeploymentLogsPagination {
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
}

export interface DeploymentLogsResponse {
  data: DeploymentLogEntry[];
  pagination: DeploymentLogsPagination;
}

export interface DeploymentLogsQuery {
  page?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  since?: string;
  level?: DeploymentLogLevel;
}
