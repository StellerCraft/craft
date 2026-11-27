import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { deriveRegionHealthState, HEALTHY_RESPONSE_TIME_MS } from './health-status.ts';

Deno.test('returns "down" when both database and auth are unhealthy', () => {
  assertEquals(deriveRegionHealthState(false, false, 0), 'down');
  assertEquals(deriveRegionHealthState(false, false, 500), 'down');
  assertEquals(deriveRegionHealthState(false, false, HEALTHY_RESPONSE_TIME_MS + 1), 'down');
});

Deno.test('returns "degraded" when database is unhealthy and auth is healthy', () => {
  assertEquals(deriveRegionHealthState(false, true, 200), 'degraded');
});

Deno.test('returns "degraded" when database is healthy and auth is unhealthy', () => {
  assertEquals(deriveRegionHealthState(true, false, 200), 'degraded');
});

Deno.test('returns "degraded" when response time exceeds the 1000 ms boundary', () => {
  assertEquals(deriveRegionHealthState(true, true, HEALTHY_RESPONSE_TIME_MS + 1), 'degraded');
});

Deno.test('returns "healthy" when both services are up and response time is exactly at the boundary', () => {
  // responseTime > HEALTHY_RESPONSE_TIME_MS, so equal is not degraded.
  assertEquals(deriveRegionHealthState(true, true, HEALTHY_RESPONSE_TIME_MS), 'healthy');
});

Deno.test('returns "healthy" when both services are up and response time is well under the boundary', () => {
  assertEquals(deriveRegionHealthState(true, true, 200), 'healthy');
});

Deno.test('returns "healthy" when response time is 0', () => {
  assertEquals(deriveRegionHealthState(true, true, 0), 'healthy');
});
