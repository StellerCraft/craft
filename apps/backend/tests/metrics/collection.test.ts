/**
 * Deployment Metrics Collection Tests (#375)
 *
 * Tests for deployment metrics collection and aggregation:
 * - Metric collection for all event types
 * - Aggregation accuracy
 * - Retention policies
 * - Query performance
 * - Export functionality
 *
 * Run: vitest run tests/metrics/collection.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MetricType = 'page_view' | 'uptime_check' | 'transaction_count' | 'error_rate' | 'response_time';

interface MetricRecord {
  id: string;
  deploymentId: string;
  type: MetricType;
  value: number;
  metadata?: Record<string, unknown>;
  recordedAt: Date;
}

interface AggregatedMetrics {
  deploymentId: string;
  totalPageViews: number;
  uptimePercentage: number;
  totalTransactions: number;
  averageResponseTime: number;
  errorRate: number;
  period: { start: Date; end: Date };
}

interface RetentionPolicy {
  metricType: MetricType;
  retentionDays: number;
}

// ---------------------------------------------------------------------------
// Metrics service
// ---------------------------------------------------------------------------

class MetricsCollectionService {
  private records: MetricRecord[] = [];
  private idCounter = 0;

  private readonly retentionPolicies: RetentionPolicy[] = [
    { metricType: 'page_view', retentionDays: 90 },
    { metricType: 'uptime_check', retentionDays: 30 },
    { metricType: 'transaction_count', retentionDays: 365 },
    { metricType: 'error_rate', retentionDays: 90 },
    { metricType: 'response_time', retentionDays: 30 },
  ];

  collect(
    deploymentId: string,
    type: MetricType,
    value: number,
    metadata?: Record<string, unknown>,
    recordedAt?: Date
  ): MetricRecord {
    if (!deploymentId) throw new Error('deploymentId is required');
    if (value < 0) throw new Error('Metric value cannot be negative');

    const record: MetricRecord = {
      id: `metric_${++this.idCounter}`,
      deploymentId,
      type,
      value,
      metadata,
      recordedAt: recordedAt ?? new Date(),
    };
    this.records.push(record);
    return record;
  }

  getRecords(deploymentId: string, type?: MetricType): MetricRecord[] {
    return this.records.filter(
      (r) => r.deploymentId === deploymentId && (type === undefined || r.type === type)
    );
  }

  aggregate(deploymentId: string, start: Date, end: Date): AggregatedMetrics {
    const inRange = this.records.filter(
      (r) =>
        r.deploymentId === deploymentId &&
        r.recordedAt >= start &&
        r.recordedAt <= end
    );

    const sum = (type: MetricType) =>
      inRange.filter((r) => r.type === type).reduce((acc, r) => acc + r.value, 0);

    const avg = (type: MetricType) => {
      const items = inRange.filter((r) => r.type === type);
      return items.length ? items.reduce((acc, r) => acc + r.value, 0) / items.length : 0;
    };

    const uptimeChecks = inRange.filter((r) => r.type === 'uptime_check');
    const uptimePercentage =
      uptimeChecks.length
        ? (uptimeChecks.filter((r) => r.value === 1).length / uptimeChecks.length) * 100
        : 100;

    return {
      deploymentId,
      totalPageViews: sum('page_view'),
      uptimePercentage,
      totalTransactions: sum('transaction_count'),
      averageResponseTime: avg('response_time'),
      errorRate: avg('error_rate'),
      period: { start, end },
    };
  }

  applyRetentionPolicy(now: Date = new Date()): number {
    const before = this.records.length;
    this.records = this.records.filter((record) => {
      const policy = this.retentionPolicies.find((p) => p.metricType === record.type);
      if (!policy) return true;
      const cutoff = new Date(now.getTime() - policy.retentionDays * 24 * 60 * 60 * 1000);
      return record.recordedAt >= cutoff;
    });
    return before - this.records.length;
  }

  exportCsv(deploymentId: string, start: Date, end: Date): string {
    const rows = this.records.filter(
      (r) =>
        r.deploymentId === deploymentId &&
        r.recordedAt >= start &&
        r.recordedAt <= end
    );
    const header = 'id,deploymentId,type,value,recordedAt';
    const lines = rows.map(
      (r) => `${r.id},${r.deploymentId},${r.type},${r.value},${r.recordedAt.toISOString()}`
    );
    return [header, ...lines].join('\n');
  }

  queryByTimeRange(deploymentId: string, start: Date, end: Date): MetricRecord[] {
    return this.records.filter(
      (r) =>
        r.deploymentId === deploymentId &&
        r.recordedAt >= start &&
        r.recordedAt <= end
    );
  }

  count(): number {
    return this.records.length;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Deployment Metrics Collection', () => {
  let service: MetricsCollectionService;
  const depId = 'dep_test_001';

  beforeEach(() => {
    service = new MetricsCollectionService();
  });

  // -------------------------------------------------------------------------
  describe('Metric Collection', () => {
    it('collects a page_view metric', () => {
      const record = service.collect(depId, 'page_view', 1);

      expect(record.id).toMatch(/^metric_/);
      expect(record.deploymentId).toBe(depId);
      expect(record.type).toBe('page_view');
      expect(record.value).toBe(1);
      expect(record.recordedAt).toBeInstanceOf(Date);
    });

    it('collects all supported metric types', () => {
      const types: MetricType[] = [
        'page_view',
        'uptime_check',
        'transaction_count',
        'error_rate',
        'response_time',
      ];

      for (const type of types) {
        const record = service.collect(depId, type, 42);
        expect(record.type).toBe(type);
      }

      expect(service.count()).toBe(types.length);
    });

    it('rejects negative metric values', () => {
      expect(() => service.collect(depId, 'page_view', -1)).toThrow('cannot be negative');
    });

    it('rejects missing deploymentId', () => {
      expect(() => service.collect('', 'page_view', 1)).toThrow('deploymentId is required');
    });

    it('stores metadata alongside the metric', () => {
      const meta = { path: '/dashboard', userAgent: 'Mozilla/5.0' };
      const record = service.collect(depId, 'page_view', 1, meta);
      expect(record.metadata).toEqual(meta);
    });

    it('accepts a custom recordedAt timestamp', () => {
      const ts = new Date('2024-01-15T10:00:00Z');
      const record = service.collect(depId, 'response_time', 250, undefined, ts);
      expect(record.recordedAt).toEqual(ts);
    });
  });

  // -------------------------------------------------------------------------
  describe('Metric Aggregation Accuracy', () => {
    beforeEach(() => {
      // Seed deterministic data
      const base = new Date('2024-01-15T00:00:00Z');
      for (let i = 0; i < 10; i++) {
        const ts = new Date(base.getTime() + i * 60_000);
        service.collect(depId, 'page_view', 10, undefined, ts);
        service.collect(depId, 'transaction_count', 5, undefined, ts);
        service.collect(depId, 'response_time', 200 + i * 10, undefined, ts);
        // 8 up, 2 down
        service.collect(depId, 'uptime_check', i < 8 ? 1 : 0, undefined, ts);
      }
    });

    it('sums page views correctly', () => {
      const start = new Date('2024-01-15T00:00:00Z');
      const end = new Date('2024-01-15T01:00:00Z');
      const agg = service.aggregate(depId, start, end);
      expect(agg.totalPageViews).toBe(100); // 10 * 10
    });

    it('sums transactions correctly', () => {
      const start = new Date('2024-01-15T00:00:00Z');
      const end = new Date('2024-01-15T01:00:00Z');
      const agg = service.aggregate(depId, start, end);
      expect(agg.totalTransactions).toBe(50); // 10 * 5
    });

    it('calculates average response time correctly', () => {
      const start = new Date('2024-01-15T00:00:00Z');
      const end = new Date('2024-01-15T01:00:00Z');
      const agg = service.aggregate(depId, start, end);
      // 200+210+...+290 = 2450, avg = 245
      expect(agg.averageResponseTime).toBe(245);
    });

    it('calculates uptime percentage correctly', () => {
      const start = new Date('2024-01-15T00:00:00Z');
      const end = new Date('2024-01-15T01:00:00Z');
      const agg = service.aggregate(depId, start, end);
      expect(agg.uptimePercentage).toBe(80); // 8/10
    });

    it('returns 100% uptime when no checks recorded', () => {
      const svc = new MetricsCollectionService();
      const agg = svc.aggregate(depId, new Date(), new Date());
      expect(agg.uptimePercentage).toBe(100);
    });

    it('excludes records outside the time range', () => {
      const start = new Date('2024-01-15T00:00:00Z');
      // end is exclusive-ish: records at i=0..4 (00:00:00–00:04:00) are within range
      const end = new Date('2024-01-15T00:04:30Z'); // cuts off at 4.5 minutes
      const agg = service.aggregate(depId, start, end);
      expect(agg.totalPageViews).toBe(50); // 5 records * 10
    });

    it('isolates metrics by deploymentId', () => {
      service.collect('dep_other', 'page_view', 999);
      const start = new Date('2024-01-15T00:00:00Z');
      const end = new Date('2024-01-15T01:00:00Z');
      const agg = service.aggregate(depId, start, end);
      expect(agg.totalPageViews).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  describe('Retention Policies', () => {
    it('removes page_view records older than 90 days', () => {
      service.collect(depId, 'page_view', 1, undefined, daysAgo(91));
      service.collect(depId, 'page_view', 1, undefined, daysAgo(89));

      const removed = service.applyRetentionPolicy();
      expect(removed).toBe(1);
      expect(service.count()).toBe(1);
    });

    it('removes uptime_check records older than 30 days', () => {
      service.collect(depId, 'uptime_check', 1, undefined, daysAgo(31));
      service.collect(depId, 'uptime_check', 1, undefined, daysAgo(29));

      const removed = service.applyRetentionPolicy();
      expect(removed).toBe(1);
    });

    it('keeps transaction_count records up to 365 days', () => {
      service.collect(depId, 'transaction_count', 5, undefined, daysAgo(364));
      service.collect(depId, 'transaction_count', 5, undefined, daysAgo(366));

      const removed = service.applyRetentionPolicy();
      expect(removed).toBe(1);
      expect(service.count()).toBe(1);
    });

    it('returns 0 when nothing is expired', () => {
      service.collect(depId, 'page_view', 1);
      const removed = service.applyRetentionPolicy();
      expect(removed).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('Query Performance', () => {
    it('queries 1000 records by time range efficiently', () => {
      const base = Date.now();
      for (let i = 0; i < 1000; i++) {
        service.collect(depId, 'page_view', 1, undefined, new Date(base + i * 1000));
      }

      const start = new Date(base);
      const end = new Date(base + 500 * 1000);

      const t0 = performance.now();
      const results = service.queryByTimeRange(depId, start, end);
      const elapsed = performance.now() - t0;

      expect(results.length).toBe(501);
      expect(elapsed).toBeLessThan(100); // must complete within 100 ms
    });

    it('aggregates 500 records within acceptable time', () => {
      const base = new Date('2024-01-01T00:00:00Z').getTime();
      for (let i = 0; i < 500; i++) {
        service.collect(depId, 'page_view', 1, undefined, new Date(base + i * 60_000));
        service.collect(depId, 'response_time', 200, undefined, new Date(base + i * 60_000));
      }

      const t0 = performance.now();
      service.aggregate(depId, new Date(base), new Date(base + 500 * 60_000));
      const elapsed = performance.now() - t0;

      expect(elapsed).toBeLessThan(100);
    });
  });

  // -------------------------------------------------------------------------
  describe('Metric Export', () => {
    it('exports metrics as CSV with correct headers', () => {
      const ts = new Date('2024-01-15T10:00:00Z');
      service.collect(depId, 'page_view', 5, undefined, ts);

      const csv = service.exportCsv(depId, new Date('2024-01-15T00:00:00Z'), new Date('2024-01-15T23:59:59Z'));
      const lines = csv.split('\n');

      expect(lines[0]).toBe('id,deploymentId,type,value,recordedAt');
      expect(lines.length).toBe(2);
    });

    it('includes all records within the date range', () => {
      const base = new Date('2024-01-15T00:00:00Z').getTime();
      for (let i = 0; i < 5; i++) {
        service.collect(depId, 'page_view', i + 1, undefined, new Date(base + i * 3600_000));
      }

      const csv = service.exportCsv(
        depId,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z')
      );
      const lines = csv.split('\n');
      expect(lines.length).toBe(6); // header + 5 rows
    });

    it('excludes records outside the date range', () => {
      service.collect(depId, 'page_view', 1, undefined, new Date('2024-01-14T23:59:59Z'));
      service.collect(depId, 'page_view', 1, undefined, new Date('2024-01-15T12:00:00Z'));

      const csv = service.exportCsv(
        depId,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z')
      );
      const lines = csv.split('\n');
      expect(lines.length).toBe(2); // header + 1 row
    });

    it('returns only the header when no records match', () => {
      const csv = service.exportCsv(
        depId,
        new Date('2024-01-15T00:00:00Z'),
        new Date('2024-01-15T23:59:59Z')
      );
      expect(csv).toBe('id,deploymentId,type,value,recordedAt');
    });
  });
});
