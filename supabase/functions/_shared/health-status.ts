export type RegionHealthState = 'healthy' | 'degraded' | 'down';

export const HEALTHY_RESPONSE_TIME_MS = 1000;

export function deriveRegionHealthState(
  databaseHealthy: boolean,
  authHealthy: boolean,
  responseTime: number,
): RegionHealthState {
  if (!databaseHealthy && !authHealthy) return 'down';
  if (!databaseHealthy || !authHealthy || responseTime > HEALTHY_RESPONSE_TIME_MS) {
    return 'degraded';
  }
  return 'healthy';
}