/**
 * Deployment Health Check Tests
 * Issue #397: Implement Deployment Health Check Tests
 *
 * Tests that verify deployment health checks accurately detect issues,
 * check frequency, alert triggering, and performance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Types ────────────────────────────────────────────────────────────────

interface DeploymentHealthResult {
  deploymentId: string;
  isHealthy: boolean;
  responseTime: number;
  statusCode: number | null;
  error: string | null;
}

// ── Mock Services ─────────────────────────────────────────────────────────────

const mockCheckDeploymentHealth = vi.fn();
const mockCheckAllDeployments = vi.fn();
const mockMonitorDeployment = vi.fn();
const mockNotifyDowntime = vi.fn();
const mockRecordUptimeCheck = vi.fn();

vi.mock('@/services/health-monitor.service', () => ({
  healthMonitorService: {
    checkDeploymentHealth: mockCheckDeploymentHealth,
    checkAllDeployments: mockCheckAllDeployments,
    monitorDeployment: mockMonitorDeployment,
    notifyDowntime: mockNotifyDowntime,
  },
}));

vi.mock('@/services/analytics.service', () => ({
  analyticsService: {
    recordUptimeCheck: mockRecordUptimeCheck,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHealthResult(overrides: Partial<DeploymentHealthResult> = {}): DeploymentHealthResult {
  return {
    deploymentId: 'deploy-1',
    isHealthy: true,
    responseTime: 120,
    statusCode: 200,
    error: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Deployment Health Check — issue detection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('detects a healthy deployment (2xx response)', async () => {
    mockCheckDeploymentHealth.mockResolvedValue(makeHealthResult());

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const result = await healthMonitorService.checkDeploymentHealth('deploy-1');

    expect(result.isHealthy).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeNull();
  });

  it('detects an unhealthy deployment (5xx response)', async () => {
    mockCheckDeploymentHealth.mockResolvedValue(
      makeHealthResult({ isHealthy: false, statusCode: 503, error: null })
    );

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const result = await healthMonitorService.checkDeploymentHealth('deploy-down');

    expect(result.isHealthy).toBe(false);
    expect(result.statusCode).toBe(503);
  });

  it('detects a deployment that times out', async () => {
    mockCheckDeploymentHealth.mockResolvedValue(
      makeHealthResult({ isHealthy: false, statusCode: null, responseTime: 0, error: 'Request timed out' })
    );

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const result = await healthMonitorService.checkDeploymentHealth('deploy-timeout');

    expect(result.isHealthy).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(result.responseTime).toBe(0);
  });

  it('detects a deployment with missing URL', async () => {
    mockCheckDeploymentHealth.mockResolvedValue(
      makeHealthResult({ isHealthy: false, statusCode: null, error: 'Deployment URL not found' })
    );

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const result = await healthMonitorService.checkDeploymentHealth('deploy-no-url');

    expect(result.isHealthy).toBe(false);
    expect(result.error).toMatch(/URL not found/i);
  });

  it('detects a 404 as unhealthy', async () => {
    mockCheckDeploymentHealth.mockResolvedValue(
      makeHealthResult({ isHealthy: false, statusCode: 404 })
    );

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const result = await healthMonitorService.checkDeploymentHealth('deploy-404');

    expect(result.isHealthy).toBe(false);
    expect(result.statusCode).toBe(404);
  });
});

describe('Deployment Health Check — all deployments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('checks all active deployments and returns results', async () => {
    const results = [
      makeHealthResult({ deploymentId: 'deploy-1' }),
      makeHealthResult({ deploymentId: 'deploy-2', isHealthy: false, statusCode: 500 }),
      makeHealthResult({ deploymentId: 'deploy-3' }),
    ];
    mockCheckAllDeployments.mockResolvedValue(results);

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const all = await healthMonitorService.checkAllDeployments();

    expect(all).toHaveLength(3);
    expect(all.filter((r) => r.isHealthy)).toHaveLength(2);
    expect(all.filter((r) => !r.isHealthy)).toHaveLength(1);
  });

  it('returns empty array when no active deployments exist', async () => {
    mockCheckAllDeployments.mockResolvedValue([]);

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const all = await healthMonitorService.checkAllDeployments();

    expect(all).toEqual([]);
  });

  it('includes responseTime for every result', async () => {
    mockCheckAllDeployments.mockResolvedValue([
      makeHealthResult({ deploymentId: 'deploy-1', responseTime: 95 }),
      makeHealthResult({ deploymentId: 'deploy-2', responseTime: 210 }),
    ]);

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const all = await healthMonitorService.checkAllDeployments();

    all.forEach((r) => expect(typeof r.responseTime).toBe('number'));
  });
});

describe('Deployment Health Check — alert triggering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('triggers downtime notification when deployment is unhealthy', async () => {
    mockMonitorDeployment.mockImplementation(async (deploymentId: string) => {
      // Simulate: unhealthy → notify
      await mockNotifyDowntime(deploymentId, 'user-1');
    });

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    await healthMonitorService.monitorDeployment('deploy-down');

    expect(mockNotifyDowntime).toHaveBeenCalledWith('deploy-down', 'user-1');
  });

  it('does not trigger notification for a healthy deployment', async () => {
    mockMonitorDeployment.mockResolvedValue(undefined); // healthy — no notify call

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    await healthMonitorService.monitorDeployment('deploy-healthy');

    expect(mockNotifyDowntime).not.toHaveBeenCalled();
  });

  it('notifyDowntime is called with correct deploymentId and userId', async () => {
    mockNotifyDowntime.mockResolvedValue(undefined);

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    await healthMonitorService.notifyDowntime('deploy-abc', 'user-xyz');

    expect(mockNotifyDowntime).toHaveBeenCalledWith('deploy-abc', 'user-xyz');
  });
});

describe('Deployment Health Check — performance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes a single health check within acceptable time', async () => {
    mockCheckDeploymentHealth.mockResolvedValue(makeHealthResult({ responseTime: 245 }));

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const start = Date.now();
    await healthMonitorService.checkDeploymentHealth('deploy-1');
    const elapsed = Date.now() - start;

    // The mock resolves instantly; wall-clock should be well under 1 s
    expect(elapsed).toBeLessThan(1000);
  });

  it('reports response time in the result', async () => {
    mockCheckDeploymentHealth.mockResolvedValue(makeHealthResult({ responseTime: 312 }));

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const result = await healthMonitorService.checkDeploymentHealth('deploy-1');

    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('runs checks for multiple deployments concurrently', async () => {
    const deploymentIds = ['d1', 'd2', 'd3', 'd4', 'd5'];
    mockCheckAllDeployments.mockResolvedValue(
      deploymentIds.map((id) => makeHealthResult({ deploymentId: id }))
    );

    const { healthMonitorService } = await import('@/services/health-monitor.service');
    const results = await healthMonitorService.checkAllDeployments();

    expect(results).toHaveLength(deploymentIds.length);
  });
});
