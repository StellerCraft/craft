/**
 * Feature Flag Targeting Rules Engine
 *
 * Feature flag evaluation engine with user-segment targeting and
 * deterministic percentage-based rollouts.
 *
 * Not to be confused with `./rollout-strategy.service.ts`, which implements
 * the canary/blue-green deployment rollout classes (`RolloutEngine`,
 * `BlueGreenSwitcher`).
 */

import { createHmac } from 'crypto';

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

// ── Feature Flag Targeting Rules Engine ──────────────────────────────────────

export type Variant = 'on' | 'off' | string;

export interface TargetingRule {
  attribute: string;
  operator: 'eq' | 'in' | 'gte' | 'lte';
  value: unknown;
}

export interface FlagDefinition {
  key: string;
  defaultVariant: Variant;
  rolloutPercent: number;
  rules: TargetingRule[];
  variants: Record<string, Variant>;
}

export interface UserContext {
  id: string;
  attributes: Record<string, unknown>;
}

export interface EvaluationEvent {
  flagKey: string;
  variant: Variant;
  userId: string;
}

const BUCKET_HMAC_KEY = 'flag-bucket-key';

/** Deterministic bucket: HMAC-SHA256(userId + flagKey) % 100 */
export function deterministicBucket(userId: string, flagKey: string): number {
  const hmac = createHmac('sha256', BUCKET_HMAC_KEY);
  hmac.update(`${userId}:${flagKey}`);
  const digest = hmac.digest();
  const num = digest.readUInt32BE(0);
  return num % 100;
}

export function matchesRule(rule: TargetingRule, ctx: UserContext): boolean {
  const val = ctx.attributes[rule.attribute];
  switch (rule.operator) {
    case 'eq':  return val === rule.value;
    case 'in':  return Array.isArray(rule.value) && rule.value.includes(val);
    case 'gte': return typeof val === 'number' && val >= (rule.value as number);
    case 'lte': return typeof val === 'number' && val <= (rule.value as number);
    default:    return false;
  }
}

export function evaluateFlag(flag: FlagDefinition, ctx: UserContext): Variant {
  if (flag.rules.some((r) => matchesRule(r, ctx))) {
    return flag.variants['targeted'] ?? 'on';
  }

  if (deterministicBucket(ctx.id, flag.key) < flag.rolloutPercent) {
    return flag.variants['rollout'] ?? 'on';
  }

  return flag.defaultVariant;
}

export type ChangeListener = (flagKey: string, variant: Variant) => void;

export class FlagEngine {
  private flags = new Map<string, FlagDefinition>();
  private overrides = new Map<string, Map<string, Variant>>();
  private listeners: ChangeListener[] = [];
  readonly analyticsEvents: EvaluationEvent[] = [];

  register(flag: FlagDefinition): void {
    this.flags.set(flag.key, flag);
  }

  getFlag(key: string): FlagDefinition | undefined {
    return this.flags.get(key);
  }

  listFlags(): FlagDefinition[] {
    return Array.from(this.flags.values());
  }

  removeFlag(key: string): void {
    this.flags.delete(key);
    this.overrides.delete(key);
  }

  setOverride(flagKey: string, userId: string, variant: Variant): void {
    if (!this.overrides.has(flagKey)) this.overrides.set(flagKey, new Map());
    this.overrides.get(flagKey)!.set(userId, variant);
  }

  clearOverride(flagKey: string, userId: string): void {
    this.overrides.get(flagKey)?.delete(userId);
  }

  updateFlag(flagKey: string, patch: Partial<FlagDefinition>): void {
    const existing = this.flags.get(flagKey);
    if (!existing) throw new Error(`Unknown flag: ${flagKey}`);
    const updated = { ...existing, ...patch };
    this.flags.set(flagKey, updated);
    this.listeners.forEach((l) => l(flagKey, updated.defaultVariant));
  }

  onFlagChange(listener: ChangeListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  evaluate(flagKey: string, ctx: UserContext): Variant {
    const flag = this.flags.get(flagKey);
    if (!flag) return 'off';

    let variant: Variant;

    const override = this.overrides.get(flagKey)?.get(ctx.id);
    if (override !== undefined) {
      variant = override;
    } else {
      variant = evaluateFlag(flag, ctx);
    }

    this.analyticsEvents.push({ flagKey, variant, userId: ctx.id });
    return variant;
  }
}


