import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDeploymentLogsQuery,
  DeploymentApiError,
  fetchDeploymentDetail,
  fetchDeploymentLogs,
  fetchDeploymentStatus,
  redeployDeployment,
} from './deployment-detail-api';

describe('deployment-detail-api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds logs query params and clamps values', () => {
    const query = buildDeploymentLogsQuery({
      page: 0,
      limit: 999,
      order: 'desc',
      since: '2026-01-01T00:00:00.000Z',
      level: 'error',
    });

    expect(query).toContain('page=1');
    expect(query).toContain('limit=200');
    expect(query).toContain('order=desc');
    expect(query).toContain('since=2026-01-01T00%3A00%3A00.000Z');
    expect(query).toContain('level=error');
  });

  it('fetches deployment detail', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'dep-1', name: 'demo' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await fetchDeploymentDetail('dep-1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/deployments/dep-1', expect.any(Object));
    expect(result).toMatchObject({ id: 'dep-1', name: 'demo' });
  });

  it('throws DeploymentApiError with backend message on non-2xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Deployment not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(fetchDeploymentStatus('missing-deployment')).rejects.toMatchObject({
      name: 'DeploymentApiError',
      status: 404,
      message: 'Deployment not found',
    } as Partial<DeploymentApiError>);
  });

  it('calls redeploy endpoint with POST', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, deploymentId: 'dep-1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await redeployDeployment('dep-1');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/deployments/dep-1/redeploy',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.success).toBe(true);
  });

  it('attaches serialized query params to logs endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [], pagination: { page: 2, limit: 20, total: 0, hasNextPage: false } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await fetchDeploymentLogs('dep-1', { page: 2, limit: 20, order: 'asc' });

    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('/api/deployments/dep-1/logs?page=2&limit=20&order=asc');
  });
});
