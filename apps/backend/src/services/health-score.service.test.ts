import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HealthScoreService,
  healthScoreService,
  HealthScoreResult,
} from './health-score.service';
import { analyticsService } from './analytics.service';

vi.mock('./analytics.service', () => ({
  analyticsService: {
    getAnalytics: vi.fn(),
  },
}));

describe('HealthScoreService', () => {
  let service: HealthScoreService;

  beforeEach(() => {
    service = new HealthScoreService();
    vi.clearAllMocks();
  });

  describe('zero-data handling (empty analytics rows)', () => {
    it('returns perfect scores for empty data when RPC is healthy', async () => {
      vi.mocked(analyticsService.getAnalytics).mockImplementation(async (_depId, metricType) => {
        return [];
      });

      const result: HealthScoreResult = await service.computeScore('dep_123', true);

      expect(result).toEqual({
        score: 100,
        breakdown: {
          uptime: 100,
          latency: 100,
          errorRate: 100,
          rpc: 100,
        },
      });
    });

    it('returns 90 overall score for empty data when RPC is unhealthy', async () => {
      vi.mocked(analyticsService.getAnalytics).mockImplementation(async () => []);

      const result = await service.computeScore('dep_123', false);

      // Score = 100*0.4 + 100*0.3 + 100*0.2 + 0*0.1 = 40 + 30 + 20 + 0 = 90
      expect(result).toEqual({
        score: 90,
        breakdown: {
          uptime: 100,
          latency: 100,
          errorRate: 100,
          rpc: 0,
        },
      });
    });
  });

  describe('latency linear interpolation and boundaries', () => {
    const setupLatencyTest = (latencies: number[]) => {
      vi.mocked(analyticsService.getAnalytics).mockImplementation(async (_depId, metricType) => {
        if (metricType === 'uptime_check') return [];
        if (metricType === 'error') return [];
        if (metricType === 'response_time_ms') {
          return latencies.map((val) => ({ metricValue: val } as any));
        }
        return [];
      });
    };

    it('awards 100 latency score when p95 is below GOOD_LATENCY_MS (200ms)', async () => {
      setupLatencyTest([50, 100, 150]);
      const result = await service.computeScore('dep_123', true);

      expect(result.breakdown.latency).toBe(100);
    });

    it('awards 100 latency score at the exact GOOD_LATENCY_MS boundary (200ms)', async () => {
      setupLatencyTest([200]);
      const result = await service.computeScore('dep_123', true);

      expect(result.breakdown.latency).toBe(100);
    });

    it('awards 0 latency score at the exact BAD_LATENCY_MS boundary (2000ms)', async () => {
      setupLatencyTest([2000]);
      const result = await service.computeScore('dep_123', true);

      expect(result.breakdown.latency).toBe(0);
    });

    it('awards 0 latency score when p95 exceeds BAD_LATENCY_MS (> 2000ms)', async () => {
      setupLatencyTest([2500, 3000]);
      const result = await service.computeScore('dep_123', true);

      expect(result.breakdown.latency).toBe(0);
    });

    it('interpolates linearly at 50% midpoint between good and bad latency (1100ms)', async () => {
      // (2000 - 1100) / (2000 - 200) * 100 = 900 / 1800 * 100 = 50.0
      setupLatencyTest([1100]);
      const result = await service.computeScore('dep_123', true);

      expect(result.breakdown.latency).toBe(50);
    });

    it('interpolates linearly at 75% score (650ms)', async () => {
      // (2000 - 650) / 1800 * 100 = 1350 / 1800 * 100 = 75.0
      setupLatencyTest([650]);
      const result = await service.computeScore('dep_123', true);

      expect(result.breakdown.latency).toBe(75);
    });

    it('interpolates linearly at 25% score (1550ms)', async () => {
      // (2000 - 1550) / 1800 * 100 = 450 / 1800 * 100 = 25.0
      setupLatencyTest([1550]);
      const result = await service.computeScore('dep_123', true);

      expect(result.breakdown.latency).toBe(25);
    });

    it('calculates p95 correctly from an unsorted multi-element dataset', async () => {
      // 20 elements: p95 index = floor(20 * 0.95) = 19 (the 20th sorted element)
      const latencies = [
        100, 105, 110, 115, 120,
        125, 130, 135, 140, 145,
        150, 155, 160, 165, 170,
        175, 180, 185, 190, 650,
      ];
      // Shuffle array to ensure sorting works
      const shuffled = [...latencies].reverse();
      setupLatencyTest(shuffled);

      const result = await service.computeScore('dep_123', true);
      // p95 element is 650 -> (2000 - 650)/1800 * 100 = 75.0
      expect(result.breakdown.latency).toBe(75);
    });
  });

  describe('uptime and error rate calculations', () => {
    it('calculates uptime score as percentage of checks where metricValue === 1', async () => {
      vi.mocked(analyticsService.getAnalytics).mockImplementation(async (_depId, metricType) => {
        if (metricType === 'uptime_check') {
          return [
            { metricValue: 1 },
            { metricValue: 1 },
            { metricValue: 1 },
            { metricValue: 0 },
          ] as any;
        }
        return [];
      });

      const result = await service.computeScore('dep_123', true);
      // 3 up out of 4 -> 75%
      expect(result.breakdown.uptime).toBe(75);
    });

    it('calculates error rate score based on ratio of errors to total requests', async () => {
      vi.mocked(analyticsService.getAnalytics).mockImplementation(async (_depId, metricType) => {
        if (metricType === 'uptime_check') {
          return Array.from({ length: 80 }, () => ({ metricValue: 1 })) as any;
        }
        if (metricType === 'error') {
          return Array.from({ length: 20 }, () => ({ metricValue: 1 })) as any;
        }
        return [];
      });

      const result = await service.computeScore('dep_123', true);
      // totalRequests = 80 + 20 = 100, errorRate = 20/100 = 0.20 -> errorRateScore = (1 - 0.20) * 100 = 80%
      expect(result.breakdown.errorRate).toBe(80);
    });
  });

  describe('hand-computed representative mixed-input fixture', () => {
    it('matches exact hand-computed weighted score and breakdown (RPC healthy = true)', async () => {
      vi.mocked(analyticsService.getAnalytics).mockImplementation(async (_depId, metricType) => {
        if (metricType === 'uptime_check') {
          // 20 checks: 18 up, 2 down -> uptimeScore = (18 / 20) * 100 = 90.0
          return [
            ...Array.from({ length: 18 }, () => ({ metricValue: 1 })),
            ...Array.from({ length: 2 }, () => ({ metricValue: 0 })),
          ] as any;
        }
        if (metricType === 'response_time_ms') {
          // 20 items: sorted 20th item (index 19) is 650ms -> latencyScore = ((2000 - 650) / 1800) * 100 = 75.0
          return [
            ...Array.from({ length: 19 }, () => ({ metricValue: 150 })),
            { metricValue: 650 },
          ] as any;
        }
        if (metricType === 'error') {
          // 5 error records. totalRequests = 20 (uptime) + 5 (error) = 25 -> errorRate = 5/25 = 0.20 -> errorRateScore = 80.0
          return Array.from({ length: 5 }, () => ({ metricValue: 1 })) as any;
        }
        return [];
      });

      const result = await service.computeScore('dep_mixed', true);

      // Hand-calculation:
      // Uptime:    90 * 0.4 = 36.0
      // Latency:   75 * 0.3 = 22.5
      // ErrorRate: 80 * 0.2 = 16.0
      // RPC:      100 * 0.1 = 10.0
      // Overall:  36.0 + 22.5 + 16.0 + 10.0 = 84.5
      expect(result).toEqual({
        score: 84.5,
        breakdown: {
          uptime: 90,
          latency: 75,
          errorRate: 80,
          rpc: 100,
        },
      });
    });

    it('matches exact hand-computed weighted score when RPC healthy is false', async () => {
      vi.mocked(analyticsService.getAnalytics).mockImplementation(async (_depId, metricType) => {
        if (metricType === 'uptime_check') {
          return [
            ...Array.from({ length: 18 }, () => ({ metricValue: 1 })),
            ...Array.from({ length: 2 }, () => ({ metricValue: 0 })),
          ] as any;
        }
        if (metricType === 'response_time_ms') {
          return [
            ...Array.from({ length: 19 }, () => ({ metricValue: 150 })),
            { metricValue: 650 },
          ] as any;
        }
        if (metricType === 'error') {
          return Array.from({ length: 5 }, () => ({ metricValue: 1 })) as any;
        }
        return [];
      });

      const result = await service.computeScore('dep_mixed', false);

      // Hand-calculation:
      // 36.0 + 22.5 + 16.0 + 0 = 74.5
      expect(result).toEqual({
        score: 74.5,
        breakdown: {
          uptime: 90,
          latency: 75,
          errorRate: 80,
          rpc: 0,
        },
      });
    });
  });

  describe('singleton export', () => {
    it('healthScoreService singleton is an instance of HealthScoreService', () => {
      expect(healthScoreService).toBeInstanceOf(HealthScoreService);
    });
  });
});
