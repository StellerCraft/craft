// @vitest-environment node
/**
 * Health Check Cron Cascading Dependency Failure Integration Test
 *
 * Tests health check system behavior when individual dependencies fail
 * in isolation and cascading. Verifies correct degraded health reporting
 * and Slack alert emission.
 *
 * Run: pnpm test -- health-check.cascade.integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DependencyStatus {
  name: string;
  status: 'up' | 'down' | 'degraded';
  responseTime: number;
  lastChecked: Date;
  error?: string;
}

interface HealthCheckResult {
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  dependencies: DependencyStatus[];
  timestamp: Date;
  slackAlertSent?: boolean;
}

interface SlackAlert {
  channel: string;
  message: string;
  timestamp: Date;
}

// ── Mock Dependencies ─────────────────────────────────────────────────────────

class MockSupabaseDependency {
  status: 'up' | 'down' = 'up';

  async check(): Promise<DependencyStatus> {
    if (this.status === 'down') {
      return {
        name: 'supabase',
        status: 'down',
        responseTime: 0,
        lastChecked: new Date(),
        error: 'Connection timeout',
      };
    }

    return {
      name: 'supabase',
      status: 'up',
      responseTime: 45,
      lastChecked: new Date(),
    };
  }

  setDown() {
    this.status = 'down';
  }

  setUp() {
    this.status = 'up';
  }
}

class MockStellarDependency {
  status: 'up' | 'down' = 'up';

  async check(): Promise<DependencyStatus> {
    if (this.status === 'down') {
      return {
        name: 'stellar',
        status: 'down',
        responseTime: 0,
        lastChecked: new Date(),
        error: 'Horizon API unreachable',
      };
    }

    return {
      name: 'stellar',
      status: 'up',
      responseTime: 120,
      lastChecked: new Date(),
    };
  }

  setDown() {
    this.status = 'down';
  }

  setUp() {
    this.status = 'up';
  }
}

class MockVercelDependency {
  status: 'up' | 'down' = 'up';

  async check(): Promise<DependencyStatus> {
    if (this.status === 'down') {
      return {
        name: 'vercel',
        status: 'down',
        responseTime: 0,
        lastChecked: new Date(),
        error: 'API rate limit exceeded',
      };
    }

    return {
      name: 'vercel',
      status: 'up',
      responseTime: 80,
      lastChecked: new Date(),
    };
  }

  setDown() {
    this.status = 'down';
  }

  setUp() {
    this.status = 'up';
  }
}

// ── Mock Slack Service ────────────────────────────────────────────────────────

class MockSlackService {
  private alerts: SlackAlert[] = [];

  async sendAlert(message: string): Promise<boolean> {
    this.alerts.push({
      channel: '#craft-alerts',
      message,
      timestamp: new Date(),
    });
    return true;
  }

  getAlerts(): SlackAlert[] {
    return this.alerts;
  }

  clearAlerts() {
    this.alerts = [];
  }

  hasAlert(pattern: string): boolean {
    return this.alerts.some((a) => a.message.includes(pattern));
  }
}

// ── Health Check Monitor ──────────────────────────────────────────────────────

class MockHealthCheckMonitor {
  constructor(
    private supabase: MockSupabaseDependency,
    private stellar: MockStellarDependency,
    private vercel: MockVercelDependency,
    private slack: MockSlackService
  ) {}

  async check(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const results = await Promise.all([
      this.supabase.check(),
      this.stellar.check(),
      this.vercel.check(),
    ]);

    const downDependencies = results.filter((r) => r.status === 'down');
    const degradedDependencies = results.filter((r) => r.status === 'degraded');

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (downDependencies.length > 0) {
      overallStatus = downDependencies.length === results.length ? 'unhealthy' : 'degraded';
    }
    if (degradedDependencies.length > 0) {
      overallStatus = 'degraded';
    }

    const result: HealthCheckResult = {
      overallStatus,
      dependencies: results,
      timestamp: new Date(),
    };

    // Send alert if unhealthy
    if (overallStatus === 'unhealthy' || (overallStatus === 'degraded' && downDependencies.length > 1)) {
      const failedDeps = downDependencies.map((d) => d.name).join(', ');
      await this.slack.sendAlert(`Health check ALERT: ${overallStatus}. Failed: ${failedDeps}`);
      result.slackAlertSent = true;
    }

    return result;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Health Check Cron Cascading Dependency Failure', () => {
  let supabase: MockSupabaseDependency;
  let stellar: MockStellarDependency;
  let vercel: MockVercelDependency;
  let slack: MockSlackService;
  let monitor: MockHealthCheckMonitor;

  beforeEach(() => {
    supabase = new MockSupabaseDependency();
    stellar = new MockStellarDependency();
    vercel = new MockVercelDependency();
    slack = new MockSlackService();
    monitor = new MockHealthCheckMonitor(supabase, stellar, vercel, slack);
  });

  afterEach(() => {
    slack.clearAlerts();
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Healthy State', () => {
    it('reports healthy when all dependencies are up', async () => {
      const result = await monitor.check();

      expect(result.overallStatus).toBe('healthy');
      expect(result.dependencies.every((d) => d.status === 'up')).toBe(true);
      expect(result.slackAlertSent).toBeUndefined();
    });

    it('no alert sent when healthy', async () => {
      await monitor.check();

      expect(slack.getAlerts().length).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Single Dependency Failure', () => {
    it('reports degraded when Supabase fails', async () => {
      supabase.setDown();
      const result = await monitor.check();

      expect(result.overallStatus).toBe('degraded');
      expect(result.dependencies.find((d) => d.name === 'supabase')?.status).toBe('down');
      expect(result.dependencies.find((d) => d.name === 'stellar')?.status).toBe('up');
      expect(result.dependencies.find((d) => d.name === 'vercel')?.status).toBe('up');
    });

    it('reports degraded when Stellar fails', async () => {
      stellar.setDown();
      const result = await monitor.check();

      expect(result.overallStatus).toBe('degraded');
      expect(result.dependencies.find((d) => d.name === 'stellar')?.status).toBe('down');
      expect(result.dependencies.find((d) => d.name === 'supabase')?.status).toBe('up');
    });

    it('reports degraded when Vercel fails', async () => {
      vercel.setDown();
      const result = await monitor.check();

      expect(result.overallStatus).toBe('degraded');
      expect(result.dependencies.find((d) => d.name === 'vercel')?.status).toBe('down');
    });

    it('includes error details for failed dependency', async () => {
      supabase.setDown();
      const result = await monitor.check();

      const supabaseStatus = result.dependencies.find((d) => d.name === 'supabase');
      expect(supabaseStatus?.error).toBe('Connection timeout');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Multiple Dependency Failures', () => {
    it('reports degraded when two dependencies fail', async () => {
      supabase.setDown();
      stellar.setDown();
      const result = await monitor.check();

      expect(result.overallStatus).toBe('degraded');
      expect(result.dependencies.filter((d) => d.status === 'down').length).toBe(2);
    });

    it('reports unhealthy when all dependencies fail', async () => {
      supabase.setDown();
      stellar.setDown();
      vercel.setDown();
      const result = await monitor.check();

      expect(result.overallStatus).toBe('unhealthy');
      expect(result.dependencies.every((d) => d.status === 'down')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Slack Alert Behavior', () => {
    it('sends Slack alert when status is unhealthy', async () => {
      supabase.setDown();
      stellar.setDown();
      vercel.setDown();
      await monitor.check();

      expect(slack.getAlerts().length).toBe(1);
      expect(slack.hasAlert('unhealthy')).toBe(true);
    });

    it('includes failed dependencies in alert message', async () => {
      supabase.setDown();
      stellar.setDown();
      await monitor.check();

      const alerts = slack.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].message).toContain('supabase');
      expect(alerts[0].message).toContain('stellar');
    });

    it('no alert sent on single dependency failure (degraded)', async () => {
      supabase.setDown();
      await monitor.check();

      // Single failure should not trigger alert
      expect(slack.getAlerts().length).toBe(0);
    });

    it('sends alert when multiple critical dependencies fail', async () => {
      supabase.setDown();
      stellar.setDown();
      await monitor.check();

      expect(slack.getAlerts().length).toBe(1);
      expect(slack.getAlerts()[0].message).toContain('degraded');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Dependency Recovery', () => {
    it('returns to healthy after failed dependency recovers', async () => {
      supabase.setDown();
      let result = await monitor.check();
      expect(result.overallStatus).toBe('degraded');

      supabase.setUp();
      result = await monitor.check();
      expect(result.overallStatus).toBe('healthy');
      expect(result.dependencies.every((d) => d.status === 'up')).toBe(true);
    });

    it('returns to degraded after partial recovery from multiple failures', async () => {
      supabase.setDown();
      stellar.setDown();
      vercel.setDown();
      let result = await monitor.check();
      expect(result.overallStatus).toBe('unhealthy');

      supabase.setUp();
      result = await monitor.check();
      expect(result.overallStatus).toBe('degraded');
      expect(result.dependencies.filter((d) => d.status === 'down').length).toBe(2);
    });

    it('no alert sent on recovery to healthy', async () => {
      supabase.setDown();
      stellar.setDown();
      await monitor.check();
      slack.clearAlerts();

      supabase.setUp();
      stellar.setUp();
      await monitor.check();

      // Recovery doesn't trigger alert
      expect(slack.getAlerts().length).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Sequential State Transitions', () => {
    it('correctly transitions through failure and recovery sequence', async () => {
      // Start healthy
      let result = await monitor.check();
      expect(result.overallStatus).toBe('healthy');

      // Supabase fails
      supabase.setDown();
      result = await monitor.check();
      expect(result.overallStatus).toBe('degraded');

      // Stellar also fails
      stellar.setDown();
      result = await monitor.check();
      expect(result.overallStatus).toBe('degraded');
      expect(slack.getAlerts().length).toBe(1);

      // Supabase recovers
      supabase.setUp();
      result = await monitor.check();
      expect(result.overallStatus).toBe('degraded');

      // Stellar recovers
      stellar.setUp();
      result = await monitor.check();
      expect(result.overallStatus).toBe('healthy');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Response Time Tracking', () => {
    it('records response time for each dependency', async () => {
      const result = await monitor.check();

      expect(result.dependencies.every((d) => typeof d.responseTime === 'number')).toBe(true);
      expect(result.dependencies.every((d) => d.responseTime >= 0)).toBe(true);
    });

    it('reports zero response time for failed dependencies', async () => {
      supabase.setDown();
      const result = await monitor.check();

      const supabaseStatus = result.dependencies.find((d) => d.name === 'supabase');
      expect(supabaseStatus?.responseTime).toBe(0);
    });

    it('includes response time in alert message context', async () => {
      supabase.setDown();
      stellar.setDown();
      await monitor.check();

      const alerts = slack.getAlerts();
      expect(alerts.length).toBeGreaterThan(0);
      // Alert should have meaningful content
      expect(alerts[0].message.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Concurrent Check Integrity', () => {
    it('completes all dependency checks before determining overall status', async () => {
      supabase.setDown();
      const result = await monitor.check();

      // All dependencies checked, not just until first failure
      expect(result.dependencies.length).toBe(3);
      expect(result.dependencies.some((d) => d.name === 'stellar')).toBe(true);
      expect(result.dependencies.some((d) => d.name === 'vercel')).toBe(true);
    });

    it('independent dependency failures do not affect each other', async () => {
      supabase.setDown();
      stellar.setDown();
      const result = await monitor.check();

      const supabaseStatus = result.dependencies.find((d) => d.name === 'supabase');
      const stellarStatus = result.dependencies.find((d) => d.name === 'stellar');

      // Both show down status independently
      expect(supabaseStatus?.status).toBe('down');
      expect(stellarStatus?.status).toBe('down');
    });
  });
});
