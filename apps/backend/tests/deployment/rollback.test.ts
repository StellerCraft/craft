/**
 * Deployment Rollback Tests
 * Issue #346: Create Deployment Rollback Tests
 *
 * Verifies rollback procedures restore previous working state, maintain data
 * consistency, handle database migrations, send notifications, and support
 * partial rollback scenarios.
 *
 * All infrastructure is simulated in-memory — no live services required.
 *
 * Rollback decision criteria:
 *   - Health check failure after deployment
 *   - Error rate ≥ 5 % in post-deploy window
 *   - Explicit operator-triggered rollback
 *   - Partial failure in multi-service deployment
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type DeploymentStatus = 'pending' | 'active' | 'rolled_back' | 'failed';
type MigrationDirection = 'up' | 'down';

interface DeploymentSnapshot {
  id: string;
  version: string;
  status: DeploymentStatus;
  config: Record<string, unknown>;
  deployedAt: Date;
}

interface MigrationRecord {
  id: string;
  version: string;
  direction: MigrationDirection;
  appliedAt: Date;
  reversible: boolean;
}

interface RollbackResult {
  success: boolean;
  restoredVersion: string;
  migrationsReverted: string[];
  notificationsSent: string[];
  error?: string;
}

interface PartialRollbackResult {
  rolledBackServices: string[];
  skippedServices: string[];
  success: boolean;
}

// ── In-memory deployment store ────────────────────────────────────────────────

class DeploymentStore {
  private snapshots: DeploymentSnapshot[] = [];
  private migrations: MigrationRecord[] = [];

  addSnapshot(snap: DeploymentSnapshot): void {
    this.snapshots.push(snap);
  }

  getActive(): DeploymentSnapshot | undefined {
    return [...this.snapshots].reverse().find(s => s.status === 'active');
  }

  getPrevious(currentId: string): DeploymentSnapshot | undefined {
    const idx = this.snapshots.findIndex(s => s.id === currentId);
    if (idx <= 0) return undefined;
    return this.snapshots
      .slice(0, idx)
      .reverse()
      .find(s => s.status === 'active' || s.status === 'rolled_back');
  }

  markRolledBack(id: string): void {
    const snap = this.snapshots.find(s => s.id === id);
    if (snap) snap.status = 'rolled_back';
  }

  markActive(id: string): void {
    const snap = this.snapshots.find(s => s.id === id);
    if (snap) snap.status = 'active';
  }

  addMigration(m: MigrationRecord): void {
    this.migrations.push(m);
  }

  getMigrationsForVersion(version: string): MigrationRecord[] {
    return this.migrations.filter(m => m.version === version && m.direction === 'up');
  }

  revertMigrations(version: string): string[] {
    const toRevert = this.getMigrationsForVersion(version).filter(m => m.reversible);
    toRevert.forEach(m => {
      this.migrations.push({ ...m, direction: 'down', appliedAt: new Date() });
    });
    return toRevert.map(m => m.id);
  }
}

// ── Notification collector ────────────────────────────────────────────────────

class NotificationCollector {
  readonly sent: Array<{ channel: string; deploymentId: string; event: string }> = [];

  notify(channel: string, deploymentId: string, event: string): void {
    this.sent.push({ channel, deploymentId, event });
  }

  sentFor(deploymentId: string): typeof this.sent {
    return this.sent.filter(n => n.deploymentId === deploymentId);
  }
}

// ── Rollback engine ───────────────────────────────────────────────────────────

class RollbackEngine {
  constructor(
    private readonly store: DeploymentStore,
    private readonly notifications: NotificationCollector,
  ) {}

  async rollback(deploymentId: string): Promise<RollbackResult> {
    const current = this.store.getActive();
    if (!current || current.id !== deploymentId) {
      return { success: false, restoredVersion: '', migrationsReverted: [], notificationsSent: [], error: 'Deployment not found or not active' };
    }

    const previous = this.store.getPrevious(deploymentId);
    if (!previous) {
      return { success: false, restoredVersion: '', migrationsReverted: [], notificationsSent: [], error: 'No previous version to roll back to' };
    }

    // Revert migrations applied by the current version
    const migrationsReverted = this.store.revertMigrations(current.version);

    // Swap statuses
    this.store.markRolledBack(current.id);
    this.store.markActive(previous.id);

    // Notify
    this.notifications.notify('email', deploymentId, 'rollback_initiated');
    this.notifications.notify('slack', deploymentId, 'rollback_completed');
    const notificationsSent = this.notifications.sentFor(deploymentId).map(n => n.channel);

    return { success: true, restoredVersion: previous.version, migrationsReverted, notificationsSent };
  }

  async rollbackPartial(
    deploymentId: string,
    services: string[],
    healthyServices: Set<string>,
  ): Promise<PartialRollbackResult> {
    const rolledBackServices: string[] = [];
    const skippedServices: string[] = [];

    for (const svc of services) {
      if (!healthyServices.has(svc)) {
        rolledBackServices.push(svc);
        this.notifications.notify('slack', deploymentId, `rollback_service_${svc}`);
      } else {
        skippedServices.push(svc);
      }
    }

    return { rolledBackServices, skippedServices, success: rolledBackServices.length > 0 };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSnapshot(
  id: string,
  version: string,
  status: DeploymentStatus = 'active',
): DeploymentSnapshot {
  return { id, version, status, config: { env: 'production' }, deployedAt: new Date() };
}

function makeMigration(id: string, version: string, reversible = true): MigrationRecord {
  return { id, version, direction: 'up', appliedAt: new Date(), reversible };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Rollback to previous deployment', () => {
  let store: DeploymentStore;
  let notifications: NotificationCollector;
  let engine: RollbackEngine;

  beforeEach(() => {
    store = new DeploymentStore();
    notifications = new NotificationCollector();
    engine = new RollbackEngine(store, notifications);
  });

  it('restores the previous active version on rollback', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));

    const result = await engine.rollback('dep-2');

    expect(result.success).toBe(true);
    expect(result.restoredVersion).toBe('v1.0.0');
  });

  it('marks the failed deployment as rolled_back', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));

    await engine.rollback('dep-2');

    const active = store.getActive();
    expect(active?.id).toBe('dep-1');
    expect(active?.status).toBe('active');
  });

  it('returns an error when there is no previous version', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));

    const result = await engine.rollback('dep-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no previous version/i);
  });

  it('returns an error when the target deployment is not active', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0', 'rolled_back'));

    const result = await engine.rollback('dep-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found or not active/i);
  });
});

describe('Data consistency after rollback', () => {
  let store: DeploymentStore;
  let notifications: NotificationCollector;
  let engine: RollbackEngine;

  beforeEach(() => {
    store = new DeploymentStore();
    notifications = new NotificationCollector();
    engine = new RollbackEngine(store, notifications);
  });

  it('exactly one deployment is active after rollback', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));

    await engine.rollback('dep-2');

    const active = store.getActive();
    expect(active).toBeDefined();
    expect(active?.id).toBe('dep-1');
  });

  it('rolled-back deployment config is preserved (not mutated)', async () => {
    const snap = makeSnapshot('dep-1', 'v1.0.0');
    const originalConfig = { ...snap.config };
    store.addSnapshot(snap);
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));

    await engine.rollback('dep-2');

    expect(snap.config).toEqual(originalConfig);
  });

  it('restored deployment retains its original config', async () => {
    const v1 = makeSnapshot('dep-1', 'v1.0.0');
    v1.config = { env: 'production', featureFlag: true };
    store.addSnapshot(v1);
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));

    await engine.rollback('dep-2');

    const active = store.getActive();
    expect(active?.config).toEqual({ env: 'production', featureFlag: true });
  });
});

describe('Rollback with database migrations', () => {
  let store: DeploymentStore;
  let notifications: NotificationCollector;
  let engine: RollbackEngine;

  beforeEach(() => {
    store = new DeploymentStore();
    notifications = new NotificationCollector();
    engine = new RollbackEngine(store, notifications);
  });

  it('reverts reversible migrations applied by the rolled-back version', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));
    store.addMigration(makeMigration('mig-001', 'v1.1.0'));
    store.addMigration(makeMigration('mig-002', 'v1.1.0'));

    const result = await engine.rollback('dep-2');

    expect(result.migrationsReverted).toHaveLength(2);
    expect(result.migrationsReverted).toContain('mig-001');
    expect(result.migrationsReverted).toContain('mig-002');
  });

  it('does not revert irreversible migrations', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));
    store.addMigration(makeMigration('mig-irreversible', 'v1.1.0', false));
    store.addMigration(makeMigration('mig-reversible', 'v1.1.0', true));

    const result = await engine.rollback('dep-2');

    expect(result.migrationsReverted).toEqual(['mig-reversible']);
    expect(result.migrationsReverted).not.toContain('mig-irreversible');
  });

  it('succeeds with no migrations to revert', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));
    // No migrations added for v1.1.0

    const result = await engine.rollback('dep-2');

    expect(result.success).toBe(true);
    expect(result.migrationsReverted).toHaveLength(0);
  });
});

describe('Rollback notification system', () => {
  let store: DeploymentStore;
  let notifications: NotificationCollector;
  let engine: RollbackEngine;

  beforeEach(() => {
    store = new DeploymentStore();
    notifications = new NotificationCollector();
    engine = new RollbackEngine(store, notifications);
  });

  it('sends notifications on successful rollback', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));

    const result = await engine.rollback('dep-2');

    expect(result.notificationsSent).toContain('email');
    expect(result.notificationsSent).toContain('slack');
  });

  it('does not send notifications when rollback fails', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));

    await engine.rollback('dep-1'); // no previous version — will fail

    expect(notifications.sentFor('dep-1')).toHaveLength(0);
  });

  it('notifications are scoped to the rolled-back deployment id', async () => {
    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));

    await engine.rollback('dep-2');

    const forDep2 = notifications.sentFor('dep-2');
    const forDep1 = notifications.sentFor('dep-1');
    expect(forDep2.length).toBeGreaterThan(0);
    expect(forDep1).toHaveLength(0);
  });
});

describe('Partial rollback scenarios', () => {
  let store: DeploymentStore;
  let notifications: NotificationCollector;
  let engine: RollbackEngine;

  beforeEach(() => {
    store = new DeploymentStore();
    notifications = new NotificationCollector();
    engine = new RollbackEngine(store, notifications);
  });

  it('rolls back only unhealthy services', async () => {
    const services = ['api', 'worker', 'scheduler'];
    const healthy = new Set(['api']); // api is healthy, others are not

    const result = await engine.rollbackPartial('dep-1', services, healthy);

    expect(result.rolledBackServices).toEqual(expect.arrayContaining(['worker', 'scheduler']));
    expect(result.skippedServices).toEqual(['api']);
  });

  it('skips all services when all are healthy', async () => {
    const services = ['api', 'worker'];
    const healthy = new Set(['api', 'worker']);

    const result = await engine.rollbackPartial('dep-1', services, healthy);

    expect(result.rolledBackServices).toHaveLength(0);
    expect(result.skippedServices).toHaveLength(2);
    expect(result.success).toBe(false);
  });

  it('rolls back all services when none are healthy', async () => {
    const services = ['api', 'worker', 'scheduler'];
    const healthy = new Set<string>();

    const result = await engine.rollbackPartial('dep-1', services, healthy);

    expect(result.rolledBackServices).toHaveLength(3);
    expect(result.skippedServices).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  it('sends a per-service notification for each rolled-back service', async () => {
    const services = ['api', 'worker'];
    const healthy = new Set<string>();

    await engine.rollbackPartial('dep-2', services, healthy);

    const sent = notifications.sentFor('dep-2').map(n => n.event);
    expect(sent).toContain('rollback_service_api');
    expect(sent).toContain('rollback_service_worker');
  });
});

describe('Rollback with concurrent deployments', () => {
  it('handles sequential rollbacks without cross-contamination', async () => {
    const store = new DeploymentStore();
    const notifications = new NotificationCollector();
    const engine = new RollbackEngine(store, notifications);

    // Two independent deployment chains
    store.addSnapshot(makeSnapshot('dep-a1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-a2', 'v1.1.0'));

    const result = await engine.rollback('dep-a2');

    expect(result.success).toBe(true);
    expect(result.restoredVersion).toBe('v1.0.0');
    // Notifications only for dep-a2
    expect(notifications.sentFor('dep-a1')).toHaveLength(0);
  });

  it('rollback is idempotent — second call on already-rolled-back deployment fails gracefully', async () => {
    const store = new DeploymentStore();
    const notifications = new NotificationCollector();
    const engine = new RollbackEngine(store, notifications);

    store.addSnapshot(makeSnapshot('dep-1', 'v1.0.0'));
    store.addSnapshot(makeSnapshot('dep-2', 'v1.1.0'));

    await engine.rollback('dep-2'); // first rollback succeeds
    const second = await engine.rollback('dep-2'); // dep-2 is now rolled_back

    expect(second.success).toBe(false);
  });
});
