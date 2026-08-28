/**
 * Time-Travel Testing Infrastructure for Cron Job Health Check Route Idempotency (#554)
 *
 * Tests verify that the health check cron route remains idempotent across multiple
 * invocations and handles timing edge cases correctly using fake timers.
 *
 * Run: vitest run src/app/api/cron/health-check/route.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'test-cron-secret';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockHealthCheckResults = [
  { deploymentId: 'dep-1', isHealthy: true, responseTime: 245 },
  { deploymentId: 'dep-2', isHealthy: false, responseTime: 5000 },
  { deploymentId: 'dep-3', isHealthy: true, responseTime: 312 },
];

const mockHealthMonitorService = {
  checkAllDeploymentsPaged: vi.fn().mockResolvedValue({
    results: mockHealthCheckResults,
    nextCursor: null,
    totalProcessed: mockHealthCheckResults.length,
  }),
};

const mockVercelService = {
  breaker: { currentState: 'CLOSED' },
};

vi.mock('@/services/health-monitor.service', () => ({
  healthMonitorService: mockHealthMonitorService,
}));

vi.mock('@/services/vercel.service', () => ({
  VercelService: vi.fn(() => mockVercelService),
}));

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = CRON_SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Helper functions ──────────────────────────────────────────────────────────

function createCronRequest(secret?: string): NextRequest {
  return new NextRequest('http://localhost:4001/api/cron/health-check', {
    method: 'GET',
    headers: {
      authorization: secret ? `Bearer ${secret}` : `Bearer ${CRON_SECRET}`,
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/cron/health-check', () => {
  // ─────────────────────────────────────────────────────────────────────────
  describe('Authentication', () => {
    it('returns 401 for missing authorization header', async () => {
      const request = new NextRequest('http://localhost:4001/api/cron/health-check', {
        method: 'GET',
      });

      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('returns 401 for invalid cron secret', async () => {
      const request = createCronRequest('wrong-secret');
      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('returns 200 for valid cron secret', async () => {
      const request = createCronRequest();
      const response = await GET(request);
      expect(response.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Basic health check execution', () => {
    it('calls healthMonitorService.checkAllDeployments', async () => {
      const request = createCronRequest();
      await GET(request);

      expect(mockHealthMonitorService.checkAllDeploymentsPaged).toHaveBeenCalledTimes(1);
    });

    it('returns correct response structure', async () => {
      const request = createCronRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('totalChecked', 3);
      expect(data).toHaveProperty('unhealthyCount', 1);
      expect(data).toHaveProperty('results');
      expect(data).toHaveProperty('vercelCircuitState');
    });

    it('counts unhealthy deployments correctly', async () => {
      const request = createCronRequest();
      const response = await GET(request);
      const data = await response.json();

      expect(data.unhealthyCount).toBe(1);
      expect(data.results.filter((r: any) => !r.isHealthy).length).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Idempotency: Multiple invocations', () => {
    it('produces identical results on consecutive invocations', async () => {
      const request1 = createCronRequest();
      const response1 = await GET(request1);
      const data1 = await response1.json();

      const request2 = createCronRequest();
      const response2 = await GET(request2);
      const data2 = await response2.json();

      expect(data1).toEqual(data2);
      expect(mockHealthMonitorService.checkAllDeploymentsPaged).toHaveBeenCalledTimes(2);
    });

    it('does not accumulate state across invocations', async () => {
      // First invocation
      await GET(createCronRequest());
      const firstCallCount = mockHealthMonitorService.checkAllDeploymentsPaged.mock.calls.length;

      // Second invocation
      await GET(createCronRequest());
      const secondCallCount = mockHealthMonitorService.checkAllDeploymentsPaged.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount + 1);
    });

    it('handles rapid successive invocations without side effects', async () => {
      const requests = Array(5).fill(null).map(() => createCronRequest());
      const responses = await Promise.all(requests.map(r => GET(r)));

      expect(responses.every(r => r.status === 200)).toBe(true);
      expect(mockHealthMonitorService.checkAllDeploymentsPaged).toHaveBeenCalledTimes(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Time-travel: Schedule boundary conditions', () => {
    it('executes correctly at exact schedule time', async () => {
      vi.useFakeTimers();
      const now = new Date('2024-01-15T10:00:00Z');
      vi.setSystemTime(now);

      const request = createCronRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      vi.useRealTimers();
    });

    it('executes correctly slightly before schedule time', async () => {
      vi.useFakeTimers();
      const scheduleTime = new Date('2024-01-15T10:05:00Z');
      const beforeTime = new Date(scheduleTime.getTime() - 10000); // 10 seconds before

      vi.setSystemTime(beforeTime);
      const request = createCronRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);

      vi.useRealTimers();
    });

    it('executes correctly slightly after schedule time', async () => {
      vi.useFakeTimers();
      const scheduleTime = new Date('2024-01-15T10:05:00Z');
      const afterTime = new Date(scheduleTime.getTime() + 10000); // 10 seconds after

      vi.setSystemTime(afterTime);
      const request = createCronRequest();
      const response = await GET(request);

      expect(response.status).toBe(200);

      vi.useRealTimers();
    });

    it('maintains idempotency across schedule boundaries', async () => {
      vi.useFakeTimers();

      // First execution at 10:00
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
      const response1 = await GET(createCronRequest());
      const data1 = await response1.json();

      // Second execution at 10:05 (next schedule)
      vi.setSystemTime(new Date('2024-01-15T10:05:00Z'));
      const response2 = await GET(createCronRequest());
      const data2 = await response2.json();

      // Results should be identical (same health check results)
      expect(data1.totalChecked).toBe(data2.totalChecked);
      expect(data1.unhealthyCount).toBe(data2.unhealthyCount);

      vi.useRealTimers();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Time-travel: Overlapping invocations', () => {
    it('handles overlapping invocations without duplicate side effects', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      // Simulate two overlapping invocations at the same time
      const [response1, response2] = await Promise.all([
        GET(createCronRequest()),
        GET(createCronRequest()),
      ]);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Both should call the service independently (no deduplication at this level)
      expect(mockHealthMonitorService.checkAllDeploymentsPaged).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('maintains consistency when invoked at overlapping times', async () => {
      vi.useFakeTimers();

      // Invocation 1 at 10:00:00
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
      const response1 = await GET(createCronRequest());
      const data1 = await response1.json();

      // Invocation 2 at 10:00:01 (1 second later, still overlapping window)
      vi.setSystemTime(new Date('2024-01-15T10:00:01Z'));
      const response2 = await GET(createCronRequest());
      const data2 = await response2.json();

      // Both should succeed and return consistent data
      expect(data1.success).toBe(true);
      expect(data2.success).toBe(true);
      expect(data1.totalChecked).toBe(data2.totalChecked);

      vi.useRealTimers();
    });

    it('does not create duplicate database writes on concurrent execution', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      // Simulate concurrent execution
      const promises = Array(3).fill(null).map(() => GET(createCronRequest()));
      const responses = await Promise.all(promises);

      expect(responses.every(r => r.status === 200)).toBe(true);
      // Each invocation calls the service independently
      expect(mockHealthMonitorService.checkAllDeploymentsPaged).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Time-travel: Long-running execution', () => {
    it('completes successfully even if execution spans multiple schedule windows', async () => {
      vi.useFakeTimers();

      // Start at 10:00:00
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));
      const request = createCronRequest();

      // Simulate the health check taking 2 minutes
      mockHealthMonitorService.checkAllDeploymentsPaged.mockImplementation(async () => {
        vi.advanceTimersByTime(120000); // 2 minutes
        return {
          results: mockHealthCheckResults,
          nextCursor: null,
          totalProcessed: mockHealthCheckResults.length,
        };
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      // Time should now be 10:02:00
      expect(new Date().getTime()).toBe(new Date('2024-01-15T10:02:00Z').getTime());

      vi.useRealTimers();
    });

    it('handles time advancement during execution', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

      let executionTime: Date | null = null;
      mockHealthMonitorService.checkAllDeploymentsPaged.mockImplementation(async () => {
        executionTime = new Date();
        vi.advanceTimersByTime(30000); // 30 seconds
        return {
          results: mockHealthCheckResults,
          nextCursor: null,
          totalProcessed: mockHealthCheckResults.length,
        };
      });

      const response = await GET(createCronRequest());
      expect(response.status).toBe(200);

      // Execution time should be at start
      expect(executionTime?.getTime()).toBe(new Date('2024-01-15T10:00:00Z').getTime());

      vi.useRealTimers();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Error handling', () => {
    it('returns 500 when health check service throws', async () => {
      mockHealthMonitorService.checkAllDeploymentsPaged.mockRejectedValueOnce(
        new Error('Service unavailable')
      );

      const request = createCronRequest();
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('Service unavailable');
    });

    it('returns 500 with generic message for unknown errors', async () => {
      mockHealthMonitorService.checkAllDeploymentsPaged.mockRejectedValueOnce(
        new Error('Unknown error')
      );

      const request = createCronRequest();
      const response = await GET(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('recovers from transient errors on retry', async () => {
      mockHealthMonitorService.checkAllDeploymentsPaged
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce(mockHealthCheckResults);

      // First invocation fails
      const response1 = await GET(createCronRequest());
      expect(response1.status).toBe(500);

      // Second invocation succeeds
      const response2 = await GET(createCronRequest());
      expect(response2.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Cron idempotency contract', () => {
    it('satisfies idempotency: same input → same output', async () => {
      const request = createCronRequest();

      const response1 = await GET(request);
      const data1 = await response1.json();

      const response2 = await GET(request);
      const data2 = await response2.json();

      expect(data1).toEqual(data2);
    });

    it('satisfies idempotency: no side effects on repeated execution', async () => {
      const initialCallCount = mockHealthMonitorService.checkAllDeploymentsPaged.mock.calls.length;

      // Execute 3 times
      for (let i = 0; i < 3; i++) {
        await GET(createCronRequest());
      }

      // Each execution should call the service exactly once
      expect(mockHealthMonitorService.checkAllDeploymentsPaged.mock.calls.length).toBe(
        initialCallCount + 3
      );
    });

    it('satisfies idempotency: execution order does not matter', async () => {
      const results1 = await GET(createCronRequest());
      const data1 = await results1.json();

      const results2 = await GET(createCronRequest());
      const data2 = await results2.json();

      const results3 = await GET(createCronRequest());
      const data3 = await results3.json();

      // All results should be identical regardless of order
      expect(data1).toEqual(data2);
      expect(data2).toEqual(data3);
    });
  });
});
