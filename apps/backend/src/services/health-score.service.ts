import { analyticsService } from './analytics.service';

/** Weights must sum to 1.0 */
const WEIGHTS = {
    uptime: 0.4,
    latency: 0.3,
    errorRate: 0.2,
    rpc: 0.1,
} as const;

/**
 * Latency thresholds for score mapping (ms).
 * p95 <= GOOD_LATENCY_MS → full latency score.
 * p95 >= BAD_LATENCY_MS  → zero latency score.
 * Linear interpolation between thresholds.
 */
const GOOD_LATENCY_MS = 200;
const BAD_LATENCY_MS = 2_000;

export interface HealthScoreBreakdown {
    uptime: number;
    latency: number;
    errorRate: number;
    rpc: number;
}

export interface HealthScoreResult {
    /** Weighted overall score 0–100. */
    score: number;
    breakdown: HealthScoreBreakdown;
}

export class HealthScoreService {
    /**
     * Compute a weighted health score for a deployment from its last 24 h of
     * analytics data plus a live Soroban RPC connectivity probe.
     */
    async computeScore(
        deploymentId: string,
        sorobanRpcHealthy: boolean
    ): Promise<HealthScoreResult> {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);

        const [uptimeRows, latencyRows, errorRows] = await Promise.all([
            analyticsService.getAnalytics(deploymentId, 'uptime_check', since),
            analyticsService.getAnalytics(deploymentId, 'response_time_ms', since),
            analyticsService.getAnalytics(deploymentId, 'error', since),
        ]);

        // ── Uptime score (0–100) ──────────────────────────────────────────────
        let uptimeScore = 100;
        if (uptimeRows.length > 0) {
            const upCount = uptimeRows.filter((r) => r.metricValue === 1).length;
            uptimeScore = (upCount / uptimeRows.length) * 100;
        }

        // ── Latency score from p95 (0–100) ────────────────────────────────────
        let latencyScore = 100;
        if (latencyRows.length > 0) {
            const sorted = latencyRows.map((r) => r.metricValue).sort((a, b) => a - b);
            const p95 = sorted[Math.floor(sorted.length * 0.95)];
            if (p95 >= BAD_LATENCY_MS) {
                latencyScore = 0;
            } else if (p95 > GOOD_LATENCY_MS) {
                latencyScore = ((BAD_LATENCY_MS - p95) / (BAD_LATENCY_MS - GOOD_LATENCY_MS)) * 100;
            }
        }

        // ── Error rate score (0–100) ──────────────────────────────────────────
        let errorRateScore = 100;
        if (errorRows.length > 0 || uptimeRows.length > 0) {
            const totalRequests = uptimeRows.length + errorRows.length;
            if (totalRequests > 0) {
                const errorRate = errorRows.length / totalRequests;
                errorRateScore = Math.max(0, (1 - errorRate) * 100);
            }
        }

        // ── RPC connectivity score (0–100) ────────────────────────────────────
        const rpcScore = sorobanRpcHealthy ? 100 : 0;

        // ── Weighted aggregate ────────────────────────────────────────────────
        const score =
            round(uptimeScore)   * WEIGHTS.uptime +
            round(latencyScore)  * WEIGHTS.latency +
            round(errorRateScore) * WEIGHTS.errorRate +
            rpcScore             * WEIGHTS.rpc;

        return {
            score: round(score),
            breakdown: {
                uptime: round(uptimeScore),
                latency: round(latencyScore),
                errorRate: round(errorRateScore),
                rpc: rpcScore,
            },
        };
    }
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

export const healthScoreService = new HealthScoreService();
