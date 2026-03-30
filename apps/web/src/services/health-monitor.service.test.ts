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

const mockRecordUptimeCheck = vi.fn().mockResolvedValue(undefined);

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
