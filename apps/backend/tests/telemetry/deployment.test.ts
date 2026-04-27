/**
 * Deployment Telemetry Tests (#414)
 *
 * Tests that verify deployment telemetry data is correctly collected and reported:
 * - Telemetry data collection for all deployment events
 * - Metric accuracy and aggregation
 * - Telemetry export (CSV / JSON)
 * - Privacy compliance (no PII in telemetry)
 * - Realistic data volumes
 *
 * Run: vitest run tests/telemetry/deployment.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type DeploymentEvent =
  | 'deployment_started'
  | 'deployment_succeeded'
  | 'deployment_failed'
  | 'deployment_cancelled'
  | 'rollback_triggered'
  | 'health_check_passed'
  | 'health_check_failed'
  | 'build_started'
  | 'build_succeeded'
  | 'build_failed';

interface TelemetryRecord {
  id: string;
  deploymentId: string;
  event: DeploymentEvent;
  durationMs?: number;
  metadata: Record<string, unknown>;
  recordedAt: Date;
}

interface TelemetrySummary {
  deploymentId: string;
  totalEvents: number;
  successCount: number;
  failureCount: number;
  averageDurationMs: number;
  healthCheckPassRate: number;
  period: { start: Date; end: Date };
}

interface TelemetryExport {
  format: 'csv' | 'json';
  data: string;
  rowCount: number;
  generatedAt: Date;
}

// ── PII field names that must never appear in telemetry ───────────────────────

const PII_FIELD_NAMES = new Set([
  'email', 'phone', 'name', 'fullName', 'address',
  'creditCard', 'ssn', 'password', 'token', 'secret',
]);

const PII_VALUE_PATTERNS: RegExp[] = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,   // email
  /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/,                      // phone
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,                        // IPv4
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,        // credit card
];

// ── DeploymentTelemetryService ────────────────────────────────────────────────

class DeploymentTelemetryService {
  private records: TelemetryRecord[] = [];
  private seq = 0;

  record(
    deploymentId: string,
    event: DeploymentEvent,
    durationMs?: number,
    metadata: Record<string, unknown> = {}
  ): TelemetryRecord {
    if (!deploymentId?.trim()) throw new Error('deploymentId is required');
    if (durationMs !== undefined && durationMs < 0) throw new Error('durationMs cannot be negative');

    const entry: TelemetryRecord = {
      id: `tel_${++this.seq}`,
      deploymentId,
      event,
      durationMs,
      metadata: this.sanitize(metadata),
      recordedAt: new Date(),
    };
    this.records.push(entry);
    return entry;
  }

  private sanitize(metadata: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (PII_FIELD_NAMES.has(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      if (typeof value === 'string') {
        const isPii = PII_VALUE_PATTERNS.some((re) => re.test(value));
        out[key] = isPii ? '[REDACTED]' : value;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  summarize(deploymentId: string, start: Date, end: Date): TelemetrySummary {
    const slice = this.records.filter(
      (r) => r.deploymentId === deploymentId && r.recordedAt >= start && r.recordedAt <= end
    );

    const successEvents: DeploymentEvent[] = ['deployment_succeeded', 'build_succeeded', 'health_check_passed'];
    const failureEvents: DeploymentEvent[] = ['deployment_failed', 'build_failed', 'health_check_failed'];

    const successCount = slice.filter((r) => successEvents.includes(r.event)).length;
    const failureCount = slice.filter((r) => failureEvents.includes(r.event)).length;

    const durations = slice.filter((r) => r.durationMs !== undefined).map((r) => r.durationMs as number);
    const averageDurationMs = durations.length
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    const healthChecks = slice.filter((r) => r.event === 'health_check_passed' || r.event === 'health_check_failed');
    const healthCheckPassRate = healthChecks.length
      ? (slice.filter((r) => r.event === 'health_check_passed').length / healthChecks.length) * 100
      : 0;

    return {
      deploymentId,
      totalEvents: slice.length,
      successCount,
      failureCount,
      averageDurationMs,
      healthCheckPassRate,
      period: { start, end },
    };
  }

  exportCsv(deploymentId: string, start: Date, end: Date): TelemetryExport {
    const slice = this.records.filter(
      (r) => r.deploymentId === deploymentId && r.recordedAt >= start && r.recordedAt <= end
    );
    const header = 'id,deploymentId,event,durationMs,recordedAt';
    const rows = slice.map(
      (r) => `${r.id},${r.deploymentId},${r.event},${r.durationMs ?? ''},${r.recordedAt.toISOString()}`
    );
    return {
      format: 'csv',
      data: [header, ...rows].join('\n'),
      rowCount: rows.length,
      generatedAt: new Date(),
    };
  }

  exportJson(deploymentId: string, start: Date, end: Date): TelemetryExport {
    const slice = this.records.filter(
      (r) => r.deploymentId === deploymentId && r.recordedAt >= start && r.recordedAt <= end
    );
    return {
      format: 'json',
      data: JSON.stringify(slice),
      rowCount: slice.length,
      generatedAt: new Date(),
    };
  }

  getAll(): TelemetryRecord[] {
    return [...this.records];
  }

  clear(): void {
    this.records = [];
    this.seq = 0;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function recentWindow(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end.getTime() - 60_000); // last 60 s
  return { start, end };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Deployment Telemetry', () => {
  let svc: DeploymentTelemetryService;
  const depId = 'dep_telemetry_001';

  beforeEach(() => {
    svc = new DeploymentTelemetryService();
  });

  // ── Data Collection ─────────────────────────────────────────────────────────

  describe('Data Collection', () => {
    it('records deployment_started event', () => {
      const r = svc.record(depId, 'deployment_started');
      expect(r.event).toBe('deployment_started');
      expect(r.deploymentId).toBe(depId);
      expect(r.id).toMatch(/^tel_/);
      expect(r.recordedAt).toBeInstanceOf(Date);
    });

    it.each([
      'deployment_started',
      'deployment_succeeded',
      'deployment_failed',
      'deployment_cancelled',
      'rollback_triggered',
      'health_check_passed',
      'health_check_failed',
      'build_started',
      'build_succeeded',
      'build_failed',
    ] as DeploymentEvent[])('records event "%s" without error', (event) => {
      expect(() => svc.record(depId, event)).not.toThrow();
    });

    it('stores durationMs when provided', () => {
      const r = svc.record(depId, 'deployment_succeeded', 4200);
      expect(r.durationMs).toBe(4200);
    });

    it('stores metadata alongside the event', () => {
      const r = svc.record(depId, 'build_succeeded', 1500, { buildId: 'bld_42', region: 'us-east-1' });
      expect(r.metadata.buildId).toBe('bld_42');
      expect(r.metadata.region).toBe('us-east-1');
    });

    it('assigns unique IDs to each record', () => {
      const a = svc.record(depId, 'build_started');
      const b = svc.record(depId, 'build_succeeded');
      expect(a.id).not.toBe(b.id);
    });

    it('rejects empty deploymentId', () => {
      expect(() => svc.record('', 'deployment_started')).toThrow('deploymentId is required');
    });

    it('rejects whitespace-only deploymentId', () => {
      expect(() => svc.record('   ', 'deployment_started')).toThrow('deploymentId is required');
    });

    it('rejects negative durationMs', () => {
      expect(() => svc.record(depId, 'deployment_succeeded', -1)).toThrow('durationMs cannot be negative');
    });

    it('allows zero durationMs', () => {
      expect(() => svc.record(depId, 'deployment_succeeded', 0)).not.toThrow();
    });

    it('accumulates multiple records', () => {
      svc.record(depId, 'build_started');
      svc.record(depId, 'build_succeeded');
      svc.record(depId, 'deployment_started');
      expect(svc.getAll()).toHaveLength(3);
    });
  });

  // ── Metric Accuracy ─────────────────────────────────────────────────────────

  describe('Metric Accuracy', () => {
    it('counts success events correctly', () => {
      svc.record(depId, 'deployment_succeeded');
      svc.record(depId, 'build_succeeded');
      svc.record(depId, 'health_check_passed');
      svc.record(depId, 'deployment_failed');

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);
      expect(summary.successCount).toBe(3);
    });

    it('counts failure events correctly', () => {
      svc.record(depId, 'deployment_failed');
      svc.record(depId, 'build_failed');
      svc.record(depId, 'health_check_failed');
      svc.record(depId, 'deployment_succeeded');

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);
      expect(summary.failureCount).toBe(3);
    });

    it('computes average duration across events', () => {
      svc.record(depId, 'build_succeeded', 1000);
      svc.record(depId, 'build_succeeded', 2000);
      svc.record(depId, 'build_succeeded', 3000);

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);
      expect(summary.averageDurationMs).toBe(2000);
    });

    it('returns 0 average duration when no durations recorded', () => {
      svc.record(depId, 'deployment_started');

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);
      expect(summary.averageDurationMs).toBe(0);
    });

    it('computes 100% health check pass rate', () => {
      svc.record(depId, 'health_check_passed');
      svc.record(depId, 'health_check_passed');

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);
      expect(summary.healthCheckPassRate).toBe(100);
    });

    it('computes partial health check pass rate', () => {
      svc.record(depId, 'health_check_passed');
      svc.record(depId, 'health_check_passed');
      svc.record(depId, 'health_check_failed');

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);
      expect(summary.healthCheckPassRate).toBeCloseTo(66.67, 1);
    });

    it('returns 0 health check pass rate when no checks recorded', () => {
      svc.record(depId, 'deployment_started');

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);
      expect(summary.healthCheckPassRate).toBe(0);
    });

    it('counts total events correctly', () => {
      for (let i = 0; i < 5; i++) svc.record(depId, 'health_check_passed');

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);
      expect(summary.totalEvents).toBe(5);
    });

    it('isolates metrics by deploymentId', () => {
      svc.record('dep_A', 'deployment_succeeded');
      svc.record('dep_B', 'deployment_succeeded');
      svc.record('dep_B', 'deployment_succeeded');

      const { start, end } = recentWindow();
      expect(svc.summarize('dep_A', start, end).successCount).toBe(1);
      expect(svc.summarize('dep_B', start, end).successCount).toBe(2);
    });

    it('filters events outside the date range', () => {
      svc.record(depId, 'deployment_succeeded');

      const future = new Date(Date.now() + 60_000);
      const farFuture = new Date(Date.now() + 120_000);
      const summary = svc.summarize(depId, future, farFuture);
      expect(summary.totalEvents).toBe(0);
    });
  });

  // ── Telemetry Aggregation ───────────────────────────────────────────────────

  describe('Telemetry Aggregation', () => {
    it('aggregates realistic deployment lifecycle', () => {
      svc.record(depId, 'build_started', 0);
      svc.record(depId, 'build_succeeded', 45_000);
      svc.record(depId, 'deployment_started', 0);
      svc.record(depId, 'deployment_succeeded', 12_000);
      svc.record(depId, 'health_check_passed', 200);

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);

      expect(summary.totalEvents).toBe(5);
      expect(summary.successCount).toBe(3); // build_succeeded + deployment_succeeded + health_check_passed
      expect(summary.healthCheckPassRate).toBe(100);
    });

    it('aggregates failed deployment lifecycle', () => {
      svc.record(depId, 'build_started');
      svc.record(depId, 'build_failed', 5_000);
      svc.record(depId, 'deployment_failed');

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);

      expect(summary.failureCount).toBe(2);
      expect(summary.successCount).toBe(0);
    });

    it('aggregates rollback scenario', () => {
      svc.record(depId, 'deployment_succeeded', 10_000);
      svc.record(depId, 'health_check_failed', 200);
      svc.record(depId, 'rollback_triggered');
      svc.record(depId, 'deployment_succeeded', 8_000);
      svc.record(depId, 'health_check_passed', 200);

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);

      expect(summary.totalEvents).toBe(5);
      expect(summary.healthCheckPassRate).toBe(50);
    });

    it('handles high-volume telemetry (1000 events)', () => {
      for (let i = 0; i < 1000; i++) {
        svc.record(depId, i % 2 === 0 ? 'health_check_passed' : 'health_check_failed', 100 + i);
      }

      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);

      expect(summary.totalEvents).toBe(1000);
      expect(summary.healthCheckPassRate).toBe(50);
    });

    it('summary includes period boundaries', () => {
      const { start, end } = recentWindow();
      const summary = svc.summarize(depId, start, end);

      expect(summary.period.start).toEqual(start);
      expect(summary.period.end).toEqual(end);
    });
  });

  // ── Telemetry Export ────────────────────────────────────────────────────────

  describe('Telemetry Export', () => {
    it('exports CSV with header row', () => {
      svc.record(depId, 'deployment_succeeded', 5000);

      const { start, end } = recentWindow();
      const exp = svc.exportCsv(depId, start, end);

      expect(exp.format).toBe('csv');
      expect(exp.data).toContain('id,deploymentId,event,durationMs,recordedAt');
    });

    it('exports CSV with correct row count', () => {
      svc.record(depId, 'build_started');
      svc.record(depId, 'build_succeeded', 3000);

      const { start, end } = recentWindow();
      const exp = svc.exportCsv(depId, start, end);

      expect(exp.rowCount).toBe(2);
    });

    it('exports CSV containing event names', () => {
      svc.record(depId, 'deployment_succeeded', 5000);

      const { start, end } = recentWindow();
      const exp = svc.exportCsv(depId, start, end);

      expect(exp.data).toContain('deployment_succeeded');
    });

    it('exports JSON as valid parseable array', () => {
      svc.record(depId, 'deployment_succeeded', 5000);
      svc.record(depId, 'health_check_passed', 200);

      const { start, end } = recentWindow();
      const exp = svc.exportJson(depId, start, end);

      expect(exp.format).toBe('json');
      const parsed = JSON.parse(exp.data);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it('JSON export row count matches array length', () => {
      svc.record(depId, 'build_succeeded', 2000);

      const { start, end } = recentWindow();
      const exp = svc.exportJson(depId, start, end);

      expect(exp.rowCount).toBe(JSON.parse(exp.data).length);
    });

    it('export includes generatedAt timestamp', () => {
      const { start, end } = recentWindow();
      const exp = svc.exportCsv(depId, start, end);

      expect(exp.generatedAt).toBeInstanceOf(Date);
      expect(exp.generatedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('empty export has zero rows but valid header', () => {
      const { start, end } = recentWindow();
      const exp = svc.exportCsv(depId, start, end);

      expect(exp.rowCount).toBe(0);
      expect(exp.data).toContain('id,deploymentId');
    });

    it('export only includes records for the specified deploymentId', () => {
      svc.record('dep_other', 'deployment_succeeded');
      svc.record(depId, 'deployment_succeeded');

      const { start, end } = recentWindow();
      const exp = svc.exportJson(depId, start, end);

      const parsed: TelemetryRecord[] = JSON.parse(exp.data);
      expect(parsed.every((r) => r.deploymentId === depId)).toBe(true);
    });
  });

  // ── Privacy Compliance ──────────────────────────────────────────────────────

  describe('Privacy Compliance', () => {
    it('redacts email addresses from metadata', () => {
      const r = svc.record(depId, 'deployment_started', undefined, { email: 'user@example.com' });
      expect(r.metadata.email).toBe('[REDACTED]');
    });

    it('redacts phone numbers from metadata', () => {
      const r = svc.record(depId, 'deployment_started', undefined, { phone: '555-123-4567' });
      expect(r.metadata.phone).toBe('[REDACTED]');
    });

    it('redacts PII field names regardless of value', () => {
      const r = svc.record(depId, 'deployment_started', undefined, { password: 'hunter2' });
      expect(r.metadata.password).toBe('[REDACTED]');
    });

    it('redacts email-like values in non-PII-named fields', () => {
      const r = svc.record(depId, 'deployment_started', undefined, { info: 'contact@example.com' });
      expect(r.metadata.info).toBe('[REDACTED]');
    });

    it('redacts IPv4 addresses from metadata values', () => {
      const r = svc.record(depId, 'deployment_started', undefined, { clientIp: '10.0.0.1' });
      expect(r.metadata.clientIp).toBe('[REDACTED]');
    });

    it('preserves safe string metadata', () => {
      const r = svc.record(depId, 'deployment_started', undefined, {
        region: 'us-east-1',
        buildId: 'bld_99',
      });
      expect(r.metadata.region).toBe('us-east-1');
      expect(r.metadata.buildId).toBe('bld_99');
    });

    it('preserves numeric metadata', () => {
      const r = svc.record(depId, 'deployment_started', undefined, {
        retryCount: 3,
        statusCode: 200,
      });
      expect(r.metadata.retryCount).toBe(3);
      expect(r.metadata.statusCode).toBe(200);
    });

    it('preserves boolean metadata', () => {
      const r = svc.record(depId, 'deployment_started', undefined, { isRollback: true });
      expect(r.metadata.isRollback).toBe(true);
    });

    it('handles empty metadata without error', () => {
      expect(() => svc.record(depId, 'deployment_started', undefined, {})).not.toThrow();
    });

    it('exported CSV does not contain raw email addresses', () => {
      svc.record(depId, 'deployment_started', undefined, { email: 'secret@example.com' });

      const { start, end } = recentWindow();
      const exp = svc.exportCsv(depId, start, end);

      expect(exp.data).not.toContain('secret@example.com');
    });

    it('exported JSON does not contain raw email addresses', () => {
      svc.record(depId, 'deployment_started', undefined, { email: 'secret@example.com' });

      const { start, end } = recentWindow();
      const exp = svc.exportJson(depId, start, end);

      expect(exp.data).not.toContain('secret@example.com');
    });
  });
});
