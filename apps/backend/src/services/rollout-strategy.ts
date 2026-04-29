/**
 * Deployment Rollout Strategy
 *
 * Implements canary, blue-green, and percentage-based rollout strategies.
 */

export type DeploymentColor = 'blue' | 'green';
export type RolloutStatus = 'pending' | 'in_progress' | 'promoted' | 'rolled_back';

export interface DeploymentVersion {
  id: string;
  errorRate: number;   // 0–1
  p99LatencyMs: number;
}

export interface TrafficRequest {
  id: string;
}

export interface TrafficResult {
  requestId: string;
  servedBy: string; // deployment version id
}

export const ROLLBACK_ERROR_RATE_THRESHOLD = 0.05;
export const ROLLBACK_LATENCY_THRESHOLD_MS = 2_000;

export class RolloutEngine {
  private _canaryPercent = 0;
  private _status: RolloutStatus = 'pending';
  private _requestCounter = 0;

  constructor(
    private readonly stable: DeploymentVersion,
    private readonly candidate: DeploymentVersion,
  ) {}

  get status(): RolloutStatus { return this._status; }
  get canaryPercent(): number { return this._canaryPercent; }

  /** Set the percentage of traffic routed to the candidate. */
  setTrafficPercent(pct: number): void {
    if (pct < 0 || pct > 100) throw new RangeError('pct must be 0–100');
    this._canaryPercent = pct;
    this._status = pct === 0 ? 'pending' : pct === 100 ? 'promoted' : 'in_progress';
  }

  /** Route a single request; returns which version served it. */
  route(req: TrafficRequest): TrafficResult {
    this._requestCounter++;
    const useCanary = (this._requestCounter % 100) < this._canaryPercent;
    const version = useCanary ? this.candidate : this.stable;
    return { requestId: req.id, servedBy: version.id };
  }

  /** Simulate N requests and return counts per version. */
  simulateTraffic(n: number): Record<string, number> {
    const counts: Record<string, number> = { [this.stable.id]: 0, [this.candidate.id]: 0 };
    for (let i = 0; i < n; i++) {
      const { servedBy } = this.route({ id: `req-${i}` });
      counts[servedBy] = (counts[servedBy] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Evaluate candidate health and auto-rollback if thresholds are breached.
   * Returns true if rollback was triggered.
   */
  evaluateAndMaybeRollback(): boolean {
    const shouldRollback =
      this.candidate.errorRate >= ROLLBACK_ERROR_RATE_THRESHOLD ||
      this.candidate.p99LatencyMs > ROLLBACK_LATENCY_THRESHOLD_MS;

    if (shouldRollback) {
      this._canaryPercent = 0;
      this._status = 'rolled_back';
    }
    return shouldRollback;
  }

  promote(): void {
    this._canaryPercent = 100;
    this._status = 'promoted';
  }
}

export class BlueGreenSwitcher {
  private _active: DeploymentColor;
  private _standby: DeploymentColor;

  constructor(
    private readonly blue: DeploymentVersion,
    private readonly green: DeploymentVersion,
    initial: DeploymentColor = 'blue',
  ) {
    this._active = initial;
    this._standby = initial === 'blue' ? 'green' : 'blue';
  }

  get active(): DeploymentColor { return this._active; }
  get standby(): DeploymentColor { return this._standby; }

  activeVersion(): DeploymentVersion {
    return this._active === 'blue' ? this.blue : this.green;
  }

  standbyVersion(): DeploymentVersion {
    return this._standby === 'blue' ? this.blue : this.green;
  }

  /** Switch traffic to standby if it is healthy; returns success. */
  switchToStandby(): boolean {
    const candidate = this.standbyVersion();
    const healthy =
      candidate.errorRate < ROLLBACK_ERROR_RATE_THRESHOLD &&
      candidate.p99LatencyMs <= ROLLBACK_LATENCY_THRESHOLD_MS;

    if (healthy) {
      [this._active, this._standby] = [this._standby, this._active];
    }
    return healthy;
  }

  route(req: TrafficRequest): TrafficResult {
    return { requestId: req.id, servedBy: this.activeVersion().id };
  }
}
