export type DeploymentColor = 'blue' | 'green';
export type RolloutStatus = 'pending' | 'in_progress' | 'promoted' | 'rolled_back';

export interface DeploymentVersion {
    id: string;
    errorRate: number;
    p99LatencyMs: number;
}

export const ROLLBACK_ERROR_RATE_THRESHOLD = 0.05;
export const ROLLBACK_LATENCY_THRESHOLD_MS = 2_000;
export const DEFAULT_CANARY_STEPS = [5, 25, 50] as const;

interface FlagDecisionCacheEntry {
    decision: boolean;
    timestamp: number;
}

const FLAG_CACHE_TTL_MS = 5_000;
const MAX_FLAG_CACHE_ENTRIES = 10_000;
const flagEvaluationCache = new Map<string, FlagDecisionCacheEntry>();

function buildFlagCacheKey(userId: string, flagKey: string): string {
    return `${userId}:${flagKey}`;
}

function invalidateFlagCache(flagKey?: string): void {
    if (flagKey) {
        for (const [key] of flagEvaluationCache) {
            if (key.endsWith(`:${flagKey}`)) {
                flagEvaluationCache.delete(key);
            }
        }
    } else {
        flagEvaluationCache.clear();
    }
}

function hashIdentityToBucket(identity: string): number {
    let hash = 2166136261;
    for (let i = 0; i < identity.length; i++) {
        hash ^= identity.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0) % 100;
}

export class RolloutEngine {
    private _canaryPercent = 0;
    private _status: RolloutStatus = 'pending';
    private _requestCounter = 0;

    constructor(
        private readonly stable: DeploymentVersion,
        private readonly candidate: DeploymentVersion,
    ) {}

    evaluateFlagWithCache(userId: string, flagKey: string, evaluator: () => boolean): boolean {
        const cacheKey = buildFlagCacheKey(userId, flagKey);
        const now = Date.now();

        const cached = flagEvaluationCache.get(cacheKey);
        if (cached && now - cached.timestamp < FLAG_CACHE_TTL_MS) {
            return cached.decision;
        }

        const decision = evaluator();

        if (flagEvaluationCache.size >= MAX_FLAG_CACHE_ENTRIES) {
            const firstKey = flagEvaluationCache.keys().next().value;
            if (firstKey) flagEvaluationCache.delete(firstKey);
        }

        flagEvaluationCache.set(cacheKey, { decision, timestamp: now });
        return decision;
    }

    clearFlagCache(flagKey?: string): void {
        invalidateFlagCache(flagKey);
    }

    get status(): RolloutStatus {
        return this._status;
    }

    get canaryPercent(): number {
        return this._canaryPercent;
    }

    setTrafficPercent(percent: number): void {
        if (percent < 0 || percent > 100) {
            throw new RangeError('percent must be between 0 and 100');
        }

        this._canaryPercent = percent;
        this._status = percent === 0 ? 'pending' : percent === 100 ? 'promoted' : 'in_progress';
    }

    /**
     * Routes a request to either candidate (canary) or stable deployment.
     * When an identity is provided (e.g. userId, sessionId), routing is deterministic
     * and sticky across requests for the same rollout configuration.
     * If no identity is provided, falls back to a shared request counter.
     */
    routeRequest(identity?: string): DeploymentVersion {
        if (identity !== undefined && identity !== '') {
            const bucket = hashIdentityToBucket(identity);
            const useCanary = bucket < this._canaryPercent;
            return useCanary ? this.candidate : this.stable;
        }

        this._requestCounter += 1;
        const useCanary = (this._requestCounter % 100) < this._canaryPercent;
        return useCanary ? this.candidate : this.stable;
    }

    simulateTraffic(
        requestCount: number,
        identityGenerator?: (index: number) => string
    ): Record<string, number> {
        const counts: Record<string, number> = {
            [this.stable.id]: 0,
            [this.candidate.id]: 0,
        };

        for (let i = 0; i < requestCount; i += 1) {
            const identity = identityGenerator
                ? identityGenerator(i)
                : `user-sim-${i}`;
            const servedBy = this.routeRequest(identity);
            counts[servedBy.id] = (counts[servedBy.id] ?? 0) + 1;
        }

        return counts;
    }

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

    get active(): DeploymentColor {
        return this._active;
    }

    get standby(): DeploymentColor {
        return this._standby;
    }

    activeVersion(): DeploymentVersion {
        return this._active === 'blue' ? this.blue : this.green;
    }

    standbyVersion(): DeploymentVersion {
        return this._standby === 'blue' ? this.blue : this.green;
    }

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
}
