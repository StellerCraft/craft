import type {
  DeploymentDetail,
  DeploymentLogsQuery,
  DeploymentLogsResponse,
  DeploymentStatusSnapshot,
} from '@/types/deployment';

export interface DeploymentActionResponse {
  success: boolean;
  deploymentId: string;
  message?: string;
}

export class DeploymentApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'DeploymentApiError';
    this.status = status;
    this.body = body;
  }
}

function normalizeErrorMessage(payload: unknown, fallback = 'Request failed'): string {
  if (typeof payload === 'object' && payload && 'error' in payload) {
    const candidate = (payload as { error?: unknown }).error;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  if (typeof payload === 'string' && payload.trim().length > 0) {
    return payload;
  }

  return fallback;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Accept: 'application/json',
    },
  });

  const body = await readBody(response);
  if (!response.ok) {
    throw new DeploymentApiError(
      normalizeErrorMessage(body, `Request failed with status ${response.status}`),
      response.status,
      body,
    );
  }

  return body as T;
}

export function buildDeploymentLogsQuery(query: DeploymentLogsQuery = {}): string {
  const params = new URLSearchParams();

  if (query.page !== undefined) {
    params.set('page', String(Math.max(1, Math.floor(query.page))));
  }

  if (query.limit !== undefined) {
    params.set('limit', String(Math.min(200, Math.max(1, Math.floor(query.limit)))));
  }

  if (query.order) {
    params.set('order', query.order);
  }

  if (query.since) {
    params.set('since', query.since);
  }

  if (query.level) {
    params.set('level', query.level);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export async function fetchDeploymentDetail(deploymentId: string): Promise<DeploymentDetail> {
  return requestJson<DeploymentDetail>(`/api/deployments/${deploymentId}`);
}

export async function fetchDeploymentStatus(deploymentId: string): Promise<DeploymentStatusSnapshot> {
  return requestJson<DeploymentStatusSnapshot>(`/api/deployments/${deploymentId}/status`);
}

export async function fetchDeploymentLogs(
  deploymentId: string,
  query: DeploymentLogsQuery = {},
): Promise<DeploymentLogsResponse> {
  const suffix = buildDeploymentLogsQuery(query);
  return requestJson<DeploymentLogsResponse>(`/api/deployments/${deploymentId}/logs${suffix}`);
}

/**
 * Integration point for update/redeploy API.
 * The backend endpoint may not be present yet in all environments.
 */
export async function redeployDeployment(deploymentId: string): Promise<DeploymentActionResponse> {
  return requestJson<DeploymentActionResponse>(`/api/deployments/${deploymentId}/redeploy`, {
    method: 'POST',
  });
}

export async function deleteDeployment(deploymentId: string): Promise<DeploymentActionResponse> {
  return requestJson<DeploymentActionResponse>(`/api/deployments/${deploymentId}`, {
    method: 'DELETE',
  });
}

/**
 * Integration point for update-related metadata.
 * Uses the draft endpoint until a dedicated updates feed is available.
 */
export async function fetchDeploymentUpdateContext(deploymentId: string): Promise<unknown> {
  return requestJson<unknown>(`/api/drafts/deployment/${deploymentId}`);
}
