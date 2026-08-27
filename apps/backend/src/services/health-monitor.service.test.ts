/**
 * Unit tests for HealthMonitorService — basic health check functionality
 * Feature: write-unit-tests-for-health-monitoring-service-basic-ch
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthMonitorService } from './health-monitor.service';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom }),
}));

// ── Analytics mock ────────────────────────────────────────────────────────────

const { mockRecordUptimeCheck } = vi.hoisted(() => ({
    mockRecordUptimeCheck: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./analytics.service', () => ({
    analyticsService: { recordUptimeCheck: mockRecordUptimeCheck },
}));

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockDeployment(url: string | null) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
            data: url ? { deployment_url: url } : null,
            error: null,
        }),
    };
    mockFrom.mockReturnValue(chain);
    return chain;
}

describe('HealthMonitorService — checkDeploymentHealth', () => {
    let service: HealthMonitorService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new HealthMonitorService();
    });

    it('returns healthy status for a 200 response', async () => {
        mockDeployment('https://my-app.vercel.app');
        mockFetch.mockResolvedValue({ ok: true, status: 200 });

        const result = await service.checkDeploymentHealth('deploy-1');

        expect(result.isHealthy).toBe(true);
        expect(result.statusCode).toBe(200);
        expect(result.error).toBeNull();
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('returns unhealthy status for a 500 response', async () => {
        mockDeployment('https://my-app.vercel.app');
        mockFetch.mockResolvedValue({ ok: false, status: 500 });

        const result = await service.checkDeploymentHealth('deploy-1');

        expect(result.isHealthy).toBe(false);
        expect(result.statusCode).toBe(500);
        expect(result.error).toBeNull();
    });

    it('returns unhealthy status for a 404 response', async () => {
        mockDeployment('https://my-app.vercel.app');
        mockFetch.mockResolvedValue({ ok: false, status: 404 });

        const result = await service.checkDeploymentHealth('deploy-1');

        expect(result.isHealthy).toBe(false);
        expect(result.statusCode).toBe(404);
    });

    it('returns unhealthy with error message on fetch timeout/network error', async () => {
        mockDeployment('https://my-app.vercel.app');
        mockFetch.mockRejectedValue(new Error('The operation was aborted due to timeout'));

        const result = await service.checkDeploymentHealth('deploy-1');

        expect(result.isHealthy).toBe(false);
        expect(result.statusCode).toBeNull();
        expect(result.error).toMatch(/timeout|aborted/i);
        expect(result.responseTime).toBe(0);
    });

    it('returns unhealthy when deployment URL is not found', async () => {
        mockDeployment(null);

        const result = await service.checkDeploymentHealth('deploy-missing');

        expect(result.isHealthy).toBe(false);
        expect(result.error).toMatch(/Deployment URL not found/);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('records uptime check as healthy on 200', async () => {
        mockDeployment('https://my-app.vercel.app');
        mockFetch.mockResolvedValue({ ok: true, status: 200 });

        await service.checkDeploymentHealth('deploy-1');

        expect(mockRecordUptimeCheck).toHaveBeenCalledWith('deploy-1', true);
    });

    it('records uptime check as unhealthy on failed fetch', async () => {
        mockDeployment('https://my-app.vercel.app');
        mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

        await service.checkDeploymentHealth('deploy-1');

        expect(mockRecordUptimeCheck).toHaveBeenCalledWith('deploy-1', false);
    });

    it('records uptime check as unhealthy on non-ok response', async () => {
        mockDeployment('https://my-app.vercel.app');
        mockFetch.mockResolvedValue({ ok: false, status: 503 });

        await service.checkDeploymentHealth('deploy-1');

        expect(mockRecordUptimeCheck).toHaveBeenCalledWith('deploy-1', false);
    });
});

describe('HealthMonitorService — checkAllDeployments concurrency', () => {
    let service: HealthMonitorService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new HealthMonitorService();
    });

    it('caps concurrent health checks to the configured limit', async () => {
        const concurrency = 3;
        const deploymentCount = 10;
        const deployments = Array.from({ length: deploymentCount }, (_, i) => ({
            id: `dep-${i}`,
            deployment_url: `https://app-${i}.vercel.app`,
        }));

        let peakConcurrent = 0;
        let currentConcurrent = 0;

        const innerEq = vi.fn().mockResolvedValue({
            data: deployments.map(d => ({ id: d.id })),
            error: null,
        });
        const listChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({ eq: innerEq }),
        };

        let urlCallCount = 0;
        mockFrom.mockImplementation(() => {
            if (urlCallCount === 0) {
                urlCallCount++;
                return listChain;
            }
            const dep = deployments[urlCallCount - 1];
            urlCallCount++;
            const chain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { deployment_url: dep?.deployment_url },
                    error: null,
                }),
            };
            return chain;
        });

        mockFetch.mockImplementation(async () => {
            currentConcurrent++;
            peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
            await new Promise((r) => setTimeout(r, 10));
            currentConcurrent--;
            return { ok: true, status: 200 };
        });

        process.env.HEALTH_CHECK_CONCURRENCY = String(concurrency);
        const results = await service.checkAllDeployments();
        delete process.env.HEALTH_CHECK_CONCURRENCY;

        expect(results).toHaveLength(deploymentCount);
        expect(peakConcurrent).toBeLessThanOrEqual(concurrency);
    });

    it('returns results for all deployments even when some fail', async () => {
        const deployments = [
            { id: 'dep-1', deployment_url: 'https://app-1.vercel.app' },
            { id: 'dep-2', deployment_url: 'https://app-2.vercel.app' },
            { id: 'dep-3', deployment_url: 'https://app-3.vercel.app' },
        ];

        const innerEq = vi.fn().mockResolvedValue({
            data: deployments.map(d => ({ id: d.id })),
            error: null,
        });
        const listChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({ eq: innerEq }),
        };

        let urlCallCount = 0;
        mockFrom.mockImplementation(() => {
            if (urlCallCount === 0) {
                urlCallCount++;
                return listChain;
            }
            const dep = deployments[urlCallCount - 1];
            urlCallCount++;
            const chain = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { deployment_url: dep?.deployment_url },
                    error: null,
                }),
            };
            return chain;
        });

        mockFetch
            .mockResolvedValueOnce({ ok: true, status: 200 })
            .mockRejectedValueOnce(new Error('network error'))
            .mockResolvedValueOnce({ ok: true, status: 200 });

        const results = await service.checkAllDeployments();

        expect(results).toHaveLength(3);
        expect(results[0].isHealthy).toBe(true);
        expect(results[1].isHealthy).toBe(false);
        expect(results[2].isHealthy).toBe(true);
    });
});
