/**
 * Regional Health Check Edge Function
 * 
 * Monitors regional Supabase instances and provides health status.
 * Used by client SDKs to determine which regions are healthy
 * and to implement intelligent failover routing.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { SUPPORTED_REGIONS, getRegionalEndpointConfig } from '../_shared/regions.ts';
import { getRegionalSupabaseClient } from '../regional-auth/auth-utils.ts';

interface RegionHealthStatus {
  region: string;
  healthy: boolean;
  responseTime: number;
  timestamp: string;
  details?: {
    database: boolean;
    auth: boolean;
    error?: string;
  };
}

interface HealthCheckResponse {
  timestamp: string;
  regions: RegionHealthStatus[];
  healthyRegions: string[];
  allHealthy: boolean;
}

/**
 * Check health of a specific region.
 *
 * Two checks are performed:
 *   1. Database – a lightweight `SELECT count` on the `profiles` table.
 *   2. Auth service – a real network request to the region's
 *      `/auth/v1/health` endpoint.  This is the key fix for issue #978:
 *      the previous implementation called `supabase.auth.getSession()` which
 *      resolves locally (no I/O) in a stateless edge function context,
 *      making `authHealthy` effectively always `true` even when the remote
 *      auth service is completely down.  We now hit the auth health endpoint
 *      directly so that a network failure or non-2xx response correctly
 *      marks the region as unhealthy and triggers failover in the router.
 */
async function checkRegionHealth(region: string): Promise<RegionHealthStatus> {
  const startTime = Date.now();

  try {
    const supabase = getRegionalSupabaseClient(region);

    // ── Check 1: Database connectivity ──────────────────────────────────────
    const { error: dbError } = await supabase
      .from('profiles')
      .select('count', { count: 'exact', head: true });

    const dbHealthy = !dbError;

    // ── Check 2: Auth service reachability (real network round-trip) ─────────
    //
    // We fetch the Supabase auth service's built-in /health endpoint.
    // A 200 response means the auth service is reachable and operational.
    // Any network error, timeout, or non-2xx status means the service is
    // unreachable — we set authHealthy = false so the router fails over.
    //
    // This replaces the previous `supabase.auth.getSession()` call which
    // did no I/O and was therefore a no-op false-positive probe.
    let authHealthy = false;
    try {
      const regionConfig = getRegionalEndpointConfig(region);
      // Supabase exposes an unauthenticated health endpoint at /auth/v1/health
      const authHealthUrl = `${regionConfig.supabaseUrl}/auth/v1/health`;
      const authResponse = await fetch(authHealthUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        // 5-second timeout: a hung auth service should be considered unhealthy
        signal: AbortSignal.timeout(5000),
      });
      authHealthy = authResponse.ok; // true only for 2xx status codes
    } catch {
      // Network error, DNS failure, or AbortError (timeout) → auth is down
      authHealthy = false;
    }

    const responseTime = Date.now() - startTime;
    const healthy = dbHealthy && authHealthy;

    return {
      region,
      healthy,
      responseTime,
      timestamp: new Date().toISOString(),
      details: {
        database: dbHealthy,
        // authHealthy now reflects actual auth service reachability, not a
        // local no-op getSession() call.
        auth: authHealthy,
        error: !healthy ? `DB: ${dbHealthy}, Auth: ${authHealthy}` : undefined,
      },
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return {
      region,
      healthy: false,
      responseTime,
      timestamp: new Date().toISOString(),
      details: {
        database: false,
        auth: false,
        error: String(error),
      },
    };
  }
}

/**
 * Check health of all regions in parallel
 */
async function checkAllRegionsHealth(): Promise<RegionHealthStatus[]> {
  const healthChecks = await Promise.all(
    SUPPORTED_REGIONS.map((region) => checkRegionHealth(region))
  );

  return healthChecks;
}

/**
 * Health check handler
 */
async function handleHealthCheck(req: Request): Promise<Response> {
  try {
    // Get query parameters
    const url = new URL(req.url);
    const region = url.searchParams.get('region');
    const detailed = url.searchParams.get('detailed') === 'true';

    let regionStatuses: RegionHealthStatus[];

    if (region && (SUPPORTED_REGIONS as readonly string[]).includes(region)) {
      // Check specific region
      const status = await checkRegionHealth(region);
      regionStatuses = [status];
    } else {
      // Check all regions
      regionStatuses = await checkAllRegionsHealth();
    }

    const healthyRegions = regionStatuses
      .filter((r) => r.healthy)
      .map((r) => r.region);

    const response: HealthCheckResponse = {
      timestamp: new Date().toISOString(),
      regions: detailed ? regionStatuses : regionStatuses.map(({ region, healthy, responseTime }) => ({ region, healthy, responseTime, timestamp: new Date().toISOString() })),
      healthyRegions,
      allHealthy: healthyRegions.length === regionStatuses.length,
    };

    const status = healthyRegions.length > 0 ? 200 : 503;

    return new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Health check error:', error);

    return new Response(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        regions: [],
        healthyRegions: [],
        allHealthy: false,
        error: 'Health check failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle OPTIONS requests for CORS
 */
function handleOptions(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/**
 * Main edge function handler
 */
serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return handleOptions(req);
  }

  // Only accept GET requests
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({
        error: 'Only GET requests are allowed',
      }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const response = await handleHealthCheck(req);

  // Add CORS headers
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Cache-Control', 'no-cache, max-age=10');

  return response;
});
