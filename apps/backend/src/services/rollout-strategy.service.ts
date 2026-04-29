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

export class RolloutEngine {
    private _canaryPercent = 0;
    private _status: RolloutStatus = 'pending';
    private _requestCounter = 0;

    constructor(
        private readonly stable: DeploymentVersion,
        private readonly candidate: DeploymentVersion,
    ) {}

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

    routeRequest(): DeploymentVersion {
        this._requestCounter += 1;
        const useCanary = (this._requestCounter % 100) < this._canaryPercent;
        return useCanary ? this.candidate : this.stable;
    }

    simulateTraffic(requestCount: number): Record<string, number> {
        const counts: Record<string, number> = {
            [this.stable.id]: 0,
            [this.candidate.id]: 0,
        };

        for (let i = 0; i < requestCount; i += 1) {
            const servedBy = this.routeRequest();
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
