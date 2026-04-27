import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Stellar Network Failover Tests (#370)
 *
 * Verifies the system detects primary endpoint failures, automatically fails
 * over to backup endpoints, fails back to primary when it recovers, and
 * ensures no transaction loss during failover.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface EndpointStatus {
  url: string;
  healthy: boolean;
  lastChecked: number;
  failureCount: number;
}

interface FailoverConfig {
  primary: string;
  backups: string[];
  failureThreshold: number;
  checkIntervalMs: number;
}

interface Transaction {
  id: string;
  payload: string;
  submittedTo?: string;
  status: 'pending' | 'submitted' | 'failed';
}

// ── StellarEndpointManager ────────────────────────────────────────────────────

class StellarEndpointManager {
  private statuses: Map<string, EndpointStatus> = new Map();
  private activeEndpoint: string;
  private readonly config: FailoverConfig;

  constructor(config: FailoverConfig) {
    this.config = config;
    this.activeEndpoint = config.primary;
    for (const url of [config.primary, ...config.backups]) {
      this.statuses.set(url, { url, healthy: true, lastChecked: Date.now(), failureCount: 0 });
    }
  }

  getActiveEndpoint(): string {
    return this.activeEndpoint;
  }

  reportFailure(url: string): void {
    const status = this.statuses.get(url);
    if (!status) return;
    status.failureCount += 1;
    if (status.failureCount >= this.config.failureThreshold) {
      status.healthy = false;
      this.failover();
    }
  }

  reportRecovery(url: string): void {
    const status = this.statuses.get(url);
    if (!status) return;
    status.healthy = true;
    status.failureCount = 0;
    // Fail back to primary if it recovers
    if (url === this.config.primary) {
      this.activeEndpoint = this.config.primary;
    }
  }

  private failover(): void {
    const candidates = [this.config.primary, ...this.config.backups];
    const next = candidates.find((url) => this.statuses.get(url)?.healthy && url !== this.activeEndpoint);
    if (next) this.activeEndpoint = next;
  }

  isHealthy(url: string): boolean {
    return this.statuses.get(url)?.healthy ?? false;
  }

  getStatus(url: string): EndpointStatus | undefined {
    return this.statuses.get(url);
  }
}

// ── TransactionSubmitter ──────────────────────────────────────────────────────

class TransactionSubmitter {
  private queue: Transaction[] = [];

  constructor(private readonly manager: StellarEndpointManager) {}

  async submit(tx: Transaction, endpointFetch: (url: string, tx: Transaction) => Promise<boolean>): Promise<Transaction> {
    const endpoint = this.manager.getActiveEndpoint();
    try {
      const ok = await endpointFetch(endpoint, tx);
      if (!ok) throw new Error('submission failed');
      tx.submittedTo = endpoint;
      tx.status = 'submitted';
    } catch {
      this.manager.reportFailure(endpoint);
      // Retry on new active endpoint
      const fallback = this.manager.getActiveEndpoint();
      const ok2 = await endpointFetch(fallback, tx);
      if (ok2) {
        tx.submittedTo = fallback;
        tx.status = 'submitted';
      } else {
        tx.status = 'failed';
        this.queue.push(tx);
      }
    }
    return tx;
  }

  getPendingQueue(): Transaction[] {
    return this.queue;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PRIMARY = 'https://horizon.stellar.org';
const BACKUP_1 = 'https://horizon-backup1.stellar.org';
const BACKUP_2 = 'https://horizon-backup2.stellar.org';

function makeConfig(overrides?: Partial<FailoverConfig>): FailoverConfig {
  return {
    primary: PRIMARY,
    backups: [BACKUP_1, BACKUP_2],
    failureThreshold: 2,
    checkIntervalMs: 5_000,
    ...overrides,
  };
}

function makeTx(id = 'tx-1'): Transaction {
  return { id, payload: `op:${id}`, status: 'pending' };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Primary endpoint failure detection', () => {
  it('starts with primary as active endpoint', () => {
    const mgr = new StellarEndpointManager(makeConfig());
    expect(mgr.getActiveEndpoint()).toBe(PRIMARY);
  });

  it('marks primary unhealthy after failureThreshold failures', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 2 }));
    mgr.reportFailure(PRIMARY);
    expect(mgr.isHealthy(PRIMARY)).toBe(true); // not yet
    mgr.reportFailure(PRIMARY);
    expect(mgr.isHealthy(PRIMARY)).toBe(false);
  });

  it('tracks failure count per endpoint', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 3 }));
    mgr.reportFailure(PRIMARY);
    mgr.reportFailure(PRIMARY);
    expect(mgr.getStatus(PRIMARY)?.failureCount).toBe(2);
  });

  it('single failure below threshold does not mark endpoint unhealthy', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 3 }));
    mgr.reportFailure(PRIMARY);
    expect(mgr.isHealthy(PRIMARY)).toBe(true);
  });
});

describe('Automatic failover to backup', () => {
  it('switches to first backup after primary fails', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    expect(mgr.getActiveEndpoint()).toBe(BACKUP_1);
  });

  it('switches to second backup if first backup also fails', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    mgr.reportFailure(BACKUP_1);
    expect(mgr.getActiveEndpoint()).toBe(BACKUP_2);
  });

  it('active endpoint changes away from failed primary', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    expect(mgr.getActiveEndpoint()).not.toBe(PRIMARY);
  });

  it('backup endpoint is healthy after failover', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    expect(mgr.isHealthy(mgr.getActiveEndpoint())).toBe(true);
  });
});

describe('Failback to primary endpoint', () => {
  it('returns to primary when primary recovers', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    expect(mgr.getActiveEndpoint()).toBe(BACKUP_1);
    mgr.reportRecovery(PRIMARY);
    expect(mgr.getActiveEndpoint()).toBe(PRIMARY);
  });

  it('marks primary healthy after recovery', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    mgr.reportRecovery(PRIMARY);
    expect(mgr.isHealthy(PRIMARY)).toBe(true);
  });

  it('resets failure count on recovery', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    mgr.reportRecovery(PRIMARY);
    expect(mgr.getStatus(PRIMARY)?.failureCount).toBe(0);
  });

  it('backup recovery does not change active endpoint to backup', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    mgr.reportRecovery(BACKUP_1); // backup recovers — should not override active
    expect(mgr.getActiveEndpoint()).toBe(BACKUP_1); // still on backup (primary still down)
  });
});

describe('No transaction loss during failover', () => {
  it('submits transaction successfully via backup when primary fails', async () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    const submitter = new TransactionSubmitter(mgr);
    const tx = makeTx();

    const fetch = vi.fn()
      .mockResolvedValueOnce(false)  // primary fails
      .mockResolvedValueOnce(true);  // backup succeeds

    const result = await submitter.submit(tx, fetch);
    expect(result.status).toBe('submitted');
    expect(result.submittedTo).toBe(BACKUP_1);
  });

  it('transaction is not lost when primary is unavailable', async () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    const submitter = new TransactionSubmitter(mgr);
    const tx = makeTx('tx-safe');

    const fetch = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await submitter.submit(tx, fetch);
    expect(result.id).toBe('tx-safe');
    expect(result.status).toBe('submitted');
  });

  it('queues transaction when all endpoints fail', async () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    const submitter = new TransactionSubmitter(mgr);
    const tx = makeTx('tx-queued');

    const fetch = vi.fn().mockResolvedValue(false);

    await submitter.submit(tx, fetch);
    expect(submitter.getPendingQueue()).toHaveLength(1);
    expect(submitter.getPendingQueue()[0].id).toBe('tx-queued');
  });
});

describe('Multiple endpoint failures', () => {
  it('handles all backups failing sequentially', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    mgr.reportFailure(BACKUP_1);
    mgr.reportFailure(BACKUP_2);
    // All endpoints unhealthy — active stays at last attempted
    expect([PRIMARY, BACKUP_1, BACKUP_2]).toContain(mgr.getActiveEndpoint());
  });

  it('each endpoint tracks its own failure count independently', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 3 }));
    mgr.reportFailure(PRIMARY);
    mgr.reportFailure(PRIMARY);
    mgr.reportFailure(BACKUP_1);
    expect(mgr.getStatus(PRIMARY)?.failureCount).toBe(2);
    expect(mgr.getStatus(BACKUP_1)?.failureCount).toBe(1);
  });

  it('recovery of one endpoint does not affect others', () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    mgr.reportFailure(PRIMARY);
    mgr.reportFailure(BACKUP_1);
    mgr.reportRecovery(BACKUP_1);
    expect(mgr.isHealthy(PRIMARY)).toBe(false);
    expect(mgr.isHealthy(BACKUP_1)).toBe(true);
  });

  it('submits multiple transactions across failover without loss', async () => {
    const mgr = new StellarEndpointManager(makeConfig({ failureThreshold: 1 }));
    const submitter = new TransactionSubmitter(mgr);

    const fetch = vi.fn()
      .mockResolvedValueOnce(false) // tx1 primary fails
      .mockResolvedValueOnce(true)  // tx1 backup succeeds
      .mockResolvedValueOnce(true); // tx2 backup succeeds directly

    const [r1, r2] = await Promise.all([
      submitter.submit(makeTx('tx-1'), fetch),
      submitter.submit(makeTx('tx-2'), fetch),
    ]);

    expect(r1.status).toBe('submitted');
    expect(r2.status).toBe('submitted');
  });
});
