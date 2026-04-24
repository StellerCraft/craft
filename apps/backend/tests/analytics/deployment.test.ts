/**
 * Deployment Analytics Tests
 *
 * Comprehensive tests for deployment analytics:
 * - Analytics event collection
 * - Metric aggregation accuracy
 * - Analytics export functionality
 * - Privacy compliance in analytics
 * - Analytics dashboard queries
 *
 * Run: vitest run tests/analytics/deployment.test.ts
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

interface AnalyticsEvent {
  id: string;
  deploymentId: string;
  eventType: 'page_view' | 'uptime_check' | 'transaction' | 'error';
  value: number;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

interface AggregatedMetrics {
  deploymentId: string;
  totalPageViews: number;
  totalTransactions: number;
  uptimePercentage: number;
  errorCount: number;
  averageResponseTime: number;
  period: { start: Date; end: Date };
}

interface AnalyticsExport {
  format: 'csv' | 'json';
  data: string;
  generatedAt: Date;
  rowCount: number;
}

class DeploymentAnalyticsService {
  private events: AnalyticsEvent[] = [];
  private eventId = 0;

  /**
   * Collect analytics event
   */
  collectEvent(
    deploymentId: string,
    eventType: AnalyticsEvent['eventType'],
    value: number,
    metadata?: Record<string, unknown>
  ): AnalyticsEvent {
    if (!deploymentId || deploymentId.trim().length === 0) {
      throw new Error('Deployment ID is required');
    }

    if (value < 0) {
      throw new Error('Event value cannot be negative');
    }

    const event: AnalyticsEvent = {
      id: `event_${++this.eventId}`,
      deploymentId,
      eventType,
      value,
      metadata: this.sanitizeMetadata(metadata),
      timestamp: new Date(),
    };

    this.events.push(event);
    return event;
  }

  /**
   * Sanitize metadata to remove PII
   */
  private sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!metadata) return undefined;

    const sanitized: Record<string, unknown> = {};
    const piiPatterns = {
      email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      phone: /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/,
      ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
      creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
    };

    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string') {
        let sanitizedValue = value;
        for (const [piiType, pattern] of Object.entries(piiPatterns)) {
          if (pattern.test(sanitizedValue)) {
            sanitizedValue = `[REDACTED_${piiType.toUpperCase()}]`;
            break;
          }
        }
        sanitized[key] = sanitizedValue;
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Aggregate metrics for period
   */
  aggregateMetrics(
    deploymentId: string,
    startDate: Date,
    endDate: Date
  ): AggregatedMetrics {
    const periodEvents = this.events.filter(
      (e) =>
        e.deploymentId === deploymentId &&
        e.timestamp >= startDate &&
        e.timestamp <= endDate
    );

    const pageViews = periodEvents
      .filter((e) => e.eventType === 'page_view')
      .reduce((sum, e) => sum + e.value, 0);

    const transactions = periodEvents
      .filter((e) => e.eventType === 'transaction')
      .reduce((sum, e) => sum + e.value, 0);

    const errors = periodEvents.filter((e) => e.eventType === 'error').length;

    const uptimeChecks = periodEvents.filter((e) => e.eventType === 'uptime_check');
    const uptimePercentage =
      uptimeChecks.length > 0
        ? (uptimeChecks.filter((e) => e.value === 1).length / uptimeChecks.length) * 100
        : 0;

    const responseTimes = periodEvents
      .filter((e) => e.metadata?.responseTime)
      .map((e) => (e.metadata?.responseTime as number) || 0);

    const averageResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    return {
      deploymentId,
      totalPageViews: pageViews,
      totalTransactions: transactions,
      uptimePercentage,
      errorCount: errors,
      averageResponseTime,
      period: { start: startDate, end: endDate },
    };
  }

  /**
   * Export analytics as CSV
   */
  exportAsCSV(deploymentId: string, startDate: Date, endDate: Date): AnalyticsExport {
    const periodEvents = this.events.filter(
      (e) =>
        e.deploymentId === deploymentId &&
        e.timestamp >= startDate &&
        e.timestamp <= endDate
    );

    const headers = ['Event ID', 'Event Type', 'Value', 'Timestamp'];
    const rows = periodEvents.map((e) => [
      e.id,
      e.eventType,
      e.value.toString(),
      e.timestamp.toISOString(),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');

    return {
      format: 'csv',
      data: csv,
      generatedAt: new Date(),
      rowCount: rows.length,
    };
  }

  /**
   * Export analytics as JSON
   */
  exportAsJSON(deploymentId: string, startDate: Date, endDate: Date): AnalyticsExport {
    const periodEvents = this.events.filter(
      (e) =>
        e.deploymentId === deploymentId &&
        e.timestamp >= startDate &&
        e.timestamp <= endDate
    );

    const data = JSON.stringify(periodEvents, null, 2);

    return {
      format: 'json',
      data,
      generatedAt: new Date(),
      rowCount: periodEvents.length,
    };
  }

  /**
   * Query analytics for dashboard
   */
  queryDashboard(deploymentId: string, days: number = 7): AggregatedMetrics {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    return this.aggregateMetrics(deploymentId, startDate, endDate);
  }

  /**
   * Get all events for testing
   */
  getAllEvents(): AnalyticsEvent[] {
    return [...this.events];
  }

  /**
   * Clear events for testing
   */
  clearEvents(): void {
    this.events = [];
    this.eventId = 0;
  }
}

describe('Deployment Analytics', () => {
  let analyticsService: DeploymentAnalyticsService;
  const deploymentId = 'dep_test123';

  beforeAll(() => {
    analyticsService = new DeploymentAnalyticsService();
  });

  beforeEach(() => {
    analyticsService.clearEvents();
  });

  describe('Event Collection', () => {
    it('should collect page view events', () => {
      const event = analyticsService.collectEvent(deploymentId, 'page_view', 1);

      expect(event.id).toBeDefined();
      expect(event.deploymentId).toBe(deploymentId);
      expect(event.eventType).toBe('page_view');
      expect(event.value).toBe(1);
      expect(event.timestamp).toBeDefined();
    });

    it('should collect transaction events', () => {
      const event = analyticsService.collectEvent(deploymentId, 'transaction', 150.5);

      expect(event.eventType).toBe('transaction');
      expect(event.value).toBe(150.5);
    });

    it('should collect uptime check events', () => {
      const event = analyticsService.collectEvent(deploymentId, 'uptime_check', 1);

      expect(event.eventType).toBe('uptime_check');
      expect(event.value).toBe(1);
    });

    it('should collect error events', () => {
      const event = analyticsService.collectEvent(deploymentId, 'error', 1, {
        errorCode: '500',
        message: 'Internal Server Error',
      });

      expect(event.eventType).toBe('error');
      expect(event.metadata?.errorCode).toBe('500');
    });

    it('should reject events with negative values', () => {
      expect(() => analyticsService.collectEvent(deploymentId, 'page_view', -1)).toThrow(
        'Event value cannot be negative'
      );
    });

    it('should reject events without deployment ID', () => {
      expect(() => analyticsService.collectEvent('', 'page_view', 1)).toThrow(
        'Deployment ID is required'
      );
    });

    it('should include metadata with events', () => {
      const metadata = { responseTime: 245, statusCode: 200 };
      const event = analyticsService.collectEvent(deploymentId, 'page_view', 1, metadata);

      expect(event.metadata).toBeDefined();
      expect(event.metadata?.responseTime).toBe(245);
    });
  });

  describe('Metric Aggregation', () => {
    it('should aggregate page views correctly', () => {
      analyticsService.collectEvent(deploymentId, 'page_view', 1);
      analyticsService.collectEvent(deploymentId, 'page_view', 1);
      analyticsService.collectEvent(deploymentId, 'page_view', 1);

      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const metrics = analyticsService.aggregateMetrics(deploymentId, startDate, now);
      expect(metrics.totalPageViews).toBe(3);
    });

    it('should aggregate transactions correctly', () => {
      analyticsService.collectEvent(deploymentId, 'transaction', 100);
      analyticsService.collectEvent(deploymentId, 'transaction', 50);
      analyticsService.collectEvent(deploymentId, 'transaction', 75);

      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const metrics = analyticsService.aggregateMetrics(deploymentId, startDate, now);
      expect(metrics.totalTransactions).toBe(225);
    });

    it('should calculate uptime percentage', () => {
      analyticsService.collectEvent(deploymentId, 'uptime_check', 1); // healthy
      analyticsService.collectEvent(deploymentId, 'uptime_check', 1); // healthy
      analyticsService.collectEvent(deploymentId, 'uptime_check', 0); // unhealthy

      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const metrics = analyticsService.aggregateMetrics(deploymentId, startDate, now);
      expect(metrics.uptimePercentage).toBeCloseTo(66.67, 1);
    });

    it('should count errors', () => {
      analyticsService.collectEvent(deploymentId, 'error', 1);
      analyticsService.collectEvent(deploymentId, 'error', 1);
      analyticsService.collectEvent(deploymentId, 'page_view', 1);

      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const metrics = analyticsService.aggregateMetrics(deploymentId, startDate, now);
      expect(metrics.errorCount).toBe(2);
    });

    it('should calculate average response time', () => {
      analyticsService.collectEvent(deploymentId, 'page_view', 1, { responseTime: 100 });
      analyticsService.collectEvent(deploymentId, 'page_view', 1, { responseTime: 200 });
      analyticsService.collectEvent(deploymentId, 'page_view', 1, { responseTime: 300 });

      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const metrics = analyticsService.aggregateMetrics(deploymentId, startDate, now);
      expect(metrics.averageResponseTime).toBe(200);
    });

    it('should filter by date range', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      analyticsService.collectEvent(deploymentId, 'page_view', 1);

      const metrics = analyticsService.aggregateMetrics(deploymentId, yesterday, now);
      expect(metrics.totalPageViews).toBe(1);

      const metricsOld = analyticsService.aggregateMetrics(deploymentId, twoDaysAgo, yesterday);
      expect(metricsOld.totalPageViews).toBe(0);
    });
  });

  describe('Analytics Export', () => {
    it('should export analytics as CSV', () => {
      analyticsService.collectEvent(deploymentId, 'page_view', 1);
      analyticsService.collectEvent(deploymentId, 'transaction', 100);

      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const export_ = analyticsService.exportAsCSV(deploymentId, startDate, now);

      expect(export_.format).toBe('csv');
      expect(export_.data).toContain('Event ID');
      expect(export_.data).toContain('page_view');
      expect(export_.data).toContain('transaction');
      expect(export_.rowCount).toBe(2);
    });

    it('should export analytics as JSON', () => {
      analyticsService.collectEvent(deploymentId, 'page_view', 1);
      analyticsService.collectEvent(deploymentId, 'transaction', 100);

      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const export_ = analyticsService.exportAsJSON(deploymentId, startDate, now);

      expect(export_.format).toBe('json');
      const parsed = JSON.parse(export_.data);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);
      expect(export_.rowCount).toBe(2);
    });

    it('should include generated timestamp in export', () => {
      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const export_ = analyticsService.exportAsCSV(deploymentId, startDate, now);

      expect(export_.generatedAt).toBeDefined();
      expect(export_.generatedAt.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });

    it('should handle empty exports', () => {
      const now = new Date();
      const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const export_ = analyticsService.exportAsCSV(deploymentId, startDate, now);

      expect(export_.rowCount).toBe(0);
      expect(export_.data).toContain('Event ID');
    });
  });

  describe('Privacy Compliance', () => {
    it('should not include PII in analytics', () => {
      const metadata = {
        email: 'user@example.com',
        action: 'login',
      };

      const event = analyticsService.collectEvent(deploymentId, 'page_view', 1, metadata);

      expect(event.metadata?.email).toContain('[REDACTED_email]');
      expect(event.metadata?.action).toBe('login');
    });

    it('should redact phone numbers', () => {
      const metadata = {
        phone: '555-123-4567',
        userId: 'user123',
      };

      const event = analyticsService.collectEvent(deploymentId, 'page_view', 1, metadata);

      expect(event.metadata?.phone).toContain('[REDACTED_phone]');
      expect(event.metadata?.userId).toBe('user123');
    });

    it('should redact IP addresses', () => {
      const metadata = {
        clientIp: '192.168.1.1',
        region: 'US',
      };

      const event = analyticsService.collectEvent(deploymentId, 'page_view', 1, metadata);

      expect(event.metadata?.clientIp).toContain('[REDACTED_ipAddress]');
      expect(event.metadata?.region).toBe('US');
    });

    it('should redact credit card numbers', () => {
      const metadata = {
        cardNumber: '4111-1111-1111-1111',
        transactionId: 'txn_123',
      };

      const event = analyticsService.collectEvent(deploymentId, 'page_view', 1, metadata);

      expect(event.metadata?.cardNumber).toContain('[REDACTED_creditCard]');
      expect(event.metadata?.transactionId).toBe('txn_123');
    });

    it('should preserve non-PII metadata', () => {
      const metadata = {
        responseTime: 245,
        statusCode: 200,
        endpoint: '/api/deployments',
      };

      const event = analyticsService.collectEvent(deploymentId, 'page_view', 1, metadata);

      expect(event.metadata?.responseTime).toBe(245);
      expect(event.metadata?.statusCode).toBe(200);
      expect(event.metadata?.endpoint).toBe('/api/deployments');
    });
  });

  describe('Dashboard Queries', () => {
    it('should query last 7 days by default', () => {
      analyticsService.collectEvent(deploymentId, 'page_view', 1);
      analyticsService.collectEvent(deploymentId, 'page_view', 1);

      const metrics = analyticsService.queryDashboard(deploymentId);

      expect(metrics.deploymentId).toBe(deploymentId);
      expect(metrics.totalPageViews).toBe(2);
      expect(metrics.period.start).toBeDefined();
      expect(metrics.period.end).toBeDefined();
    });

    it('should query custom date ranges', () => {
      analyticsService.collectEvent(deploymentId, 'page_view', 1);

      const metrics = analyticsService.queryDashboard(deploymentId, 30);

      expect(metrics.period.end.getTime() - metrics.period.start.getTime()).toBeCloseTo(
        30 * 24 * 60 * 60 * 1000,
        -3
      );
    });

    it('should include all metrics in dashboard query', () => {
      analyticsService.collectEvent(deploymentId, 'page_view', 1);
      analyticsService.collectEvent(deploymentId, 'transaction', 100);
      analyticsService.collectEvent(deploymentId, 'uptime_check', 1);
      analyticsService.collectEvent(deploymentId, 'error', 1);

      const metrics = analyticsService.queryDashboard(deploymentId);

      expect(metrics.totalPageViews).toBeGreaterThan(0);
      expect(metrics.totalTransactions).toBeGreaterThan(0);
      expect(metrics.uptimePercentage).toBeGreaterThanOrEqual(0);
      expect(metrics.errorCount).toBeGreaterThan(0);
    });
  });
});
