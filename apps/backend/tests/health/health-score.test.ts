import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthScoreService } from '@/services/health-score.service';
import * as analyticsModule from '@/services/analytics.service';

const mockGetAnalytics = vi.spyOn(analyticsModule.analyticsService, 'getAnalytics');

function makeRows(type: string, values: number[]) {
    return values.map((v, i) => ({
        id: `${i}`,
        metricType: type,
        metricValue: v,
        recordedAt: new Date(),
    }));
}

describe('HealthScoreService.computeScore', () => {
    const svc = new HealthScoreService();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 100 when all metrics are perfect', async () => {
        mockGetAnalytics.mockImplementation(async (_id, type) => {
            if (type === 'uptime_check') return makeRows('uptime_check', [1, 1, 1, 1]);
            if (type === 'response_time_ms') return makeRows('response_time_ms', [100, 120, 130, 110]);
            return []; // no errors
        });

        const result = await svc.computeScore('dep-1', true);
        expect(result.score).toBe(100);
        expect(result.breakdown.uptime).toBe(100);
        expect(result.breakdown.latency).toBe(100);
        expect(result.breakdown.errorRate).toBe(100);
        expect(result.breakdown.rpc).toBe(100);
    });

    it('returns 0 for rpc component when RPC is unhealthy', async () => {
        mockGetAnalytics.mockResolvedValue([]);
        const result = await svc.computeScore('dep-1', false);
        expect(result.breakdown.rpc).toBe(0);
        // rpc weight is 0.1, so score should be 90 when everything else perfect
        expect(result.score).toBe(90);
    });

    it('computes uptime score proportionally', async () => {
        mockGetAnalytics.mockImplementation(async (_id, type) => {
            if (type === 'uptime_check') return makeRows('uptime_check', [1, 1, 0, 0]); // 50% uptime
            return [];
        });
        const result = await svc.computeScore('dep-1', true);
        expect(result.breakdown.uptime).toBe(50);
        // score = 50*0.4 + 100*0.3 + 100*0.2 + 100*0.1 = 20 + 30 + 20 + 10 = 80
        expect(result.score).toBe(80);
    });

    it('scores p95 latency at 0 when above bad threshold', async () => {
        const highLatency = Array(100).fill(3000); // all 3000ms → p95 = 3000ms >> 2000ms
        mockGetAnalytics.mockImplementation(async (_id, type) => {
            if (type === 'response_time_ms') return makeRows('response_time_ms', highLatency);
            return [];
        });
        const result = await svc.computeScore('dep-1', true);
        expect(result.breakdown.latency).toBe(0);
    });

    it('interpolates latency score between thresholds', async () => {
        // p95 = 1100ms; midpoint between 200 and 2000 → score = (2000-1100)/(2000-200)*100 = 50
        const values = Array(100).fill(1100);
        mockGetAnalytics.mockImplementation(async (_id, type) => {
            if (type === 'response_time_ms') return makeRows('response_time_ms', values);
            return [];
        });
        const result = await svc.computeScore('dep-1', true);
        expect(result.breakdown.latency).toBeCloseTo(50, 0);
    });

    it('scores error rate correctly', async () => {
        mockGetAnalytics.mockImplementation(async (_id, type) => {
            if (type === 'uptime_check') return makeRows('uptime_check', [1, 1, 1, 1]); // 4 requests
            if (type === 'error') return makeRows('error', [1, 1]); // 2 errors → 33% error rate
            return [];
        });
        const result = await svc.computeScore('dep-1', true);
        // errorRate = 2/(4+2) = 0.333 → score = (1-0.333)*100 ≈ 66.67
        expect(result.breakdown.errorRate).toBeCloseTo(66.67, 0);
    });

    it('returns 100 for all components when no data (assumes healthy)', async () => {
        mockGetAnalytics.mockResolvedValue([]);
        const result = await svc.computeScore('dep-empty', true);
        expect(result.score).toBe(100);
    });
});
