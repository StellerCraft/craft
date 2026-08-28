/**
 * Regional Router Edge Function
 * 
 * Intelligent request router that:
 * - Detects user's geographic location
 * - Routes to the nearest healthy region
 * - Falls back to other regions if primary is unavailable
 * - Provides latency optimization and failover routing
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { SUPPORTED_REGIONS, getRegionalEndpointConfig, detectRegionFromRequest } from '../_shared/regions.ts';

interface RegionEndpoint {
  region: string;
  baseUrl: string;
  priority: number;
}

interface RoutingDecision {
  targetRegion: string;
  endpoints: RegionEndpoint[];
  reason: string;
  selectedEndpoint: string;
}

/**
 * Get regional endpoint configuration
 */
function getRegionalEndpoints(): RegionEndpoint[] {
  return SUPPORTED_REGIONS.map((region) => {
    const config = getRegionalEndpointConfig(region);
    return { region, baseUrl: config.baseUrl, priority: 1 };
  });
}


/**
 * Fetch health status of regions
 */
async function getRegionHealthStatus(): Promise<Map<string, boolean>> {
  const healthMap = new Map<string, boolean>();
  const endpoints = getRegionalEndpoints();

  const probeTimeoutMs = parseInt(
    Deno.env.get('REGION_HEALTH_PROBE_TIMEOUT_MS') ?? '2000',
    10,
  );
  const safeTimeout = Number.isFinite(probeTimeoutMs) && probeTimeoutMs > 0 ? probeTimeoutMs : 2000;

  // Check health of each region in parallel
  const healthPromises = endpoints.map(async (endpoint) => {
    try {
      const healthCheckUrl = `${endpoint.baseUrl}/functions/v1/regional-health-check`;
      const response = await fetch(healthCheckUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(safeTimeout),
      });

      const data = await response.json() as { allHealthy: boolean };
      return { region: endpoint.region, healthy: data.allHealthy ?? response.ok };
    } catch {
      return { region: endpoint.region, healthy: false };
    }
  });

  const results = await Promise.all(healthPromises);

  for (const { region, healthy } of results) {
    healthMap.set(region, healthy);
  }

  return healthMap;
}

/**
 * Decide which region to route to
 */
async function makeRoutingDecision(
  req: Request,
  endpoints: RegionEndpoint[]
): Promise<RoutingDecision> {
  const detectedRegion = detectRegionFromRequest(req);

  // Get health status of regions
  const healthStatus = await getRegionHealthStatus();

  // Sort endpoints by health and then by whether they match detected region
  const sortedEndpoints = [...endpoints].sort((a, b) => {
    const aHealthy = healthStatus.get(a.region) ?? false;
    const bHealthy = healthStatus.get(b.region) ?? false;

    // Prioritize healthy regions
    if (aHealthy !== bHealthy) {
      return aHealthy ? -1 : 1;
    }

    // Among healthy/unhealthy, prioritize detected region
    const aMatches = a.region === detectedRegion ? 1 : 0;
    const bMatches = b.region === detectedRegion ? 1 : 0;

    return bMatches - aMatches;
  });

  const selectedEndpoint = sortedEndpoints[0];
  const reason =
    healthStatus.get(selectedEndpoint.region)
      ? `Primary region ${detectedRegion} is healthy`
      : `Primary region ${detectedRegion} is unhealthy, routing to ${selectedEndpoint.region}`;

  const regionHealth: Record<string, boolean> = {};
  for (const ep of endpoints) {
    regionHealth[ep.region] = healthStatus.get(ep.region) ?? false;
  }

  console.log(JSON.stringify({
    event: 'routing_decision',
    targetRegion: selectedEndpoint.region,
    reason,
    regionHealth,
    detectedRegion,
  }));

  return {
    targetRegion: selectedEndpoint.region,
    endpoints: sortedEndpoints,
    reason,
    selectedEndpoint: selectedEndpoint.baseUrl,
  };
}

/**
 * Route request to the appropriate regional endpoint
 */
async function handleRouting(req: Request): Promise<Response> {
  try {
    // Parse the target service and path from the URL
    const url = new URL(req.url);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    // Expected format: /router/service/path
    // service: auth, storage, etc.
    // path: the rest of the path
    if (pathSegments.length < 2) {
      return new Response(
        JSON.stringify({
          error: 'Invalid request format. Expected: /router/{service}/{path}',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const service = pathSegments[1];
    const servicePathSegments = pathSegments.slice(2);

    const endpoints = getRegionalEndpoints();
    const decision = await makeRoutingDecision(req, endpoints);

    // Construct the target URL
    const targetPath = `/functions/v1/${service}/${servicePathSegments.join('/')}`;
    const targetUrl = new URL(targetPath, decision.selectedEndpoint).toString();

    // Copy request headers and add routing metadata
    const headers = new Headers(req.headers);
    headers.set('x-routed-from', url.host);
    headers.set('x-routed-region', decision.targetRegion);
    headers.set('x-routing-reason', decision.reason);

    // Forward the request to the target region
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
    });

    // Add routing information to response headers
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-served-by-region', decision.targetRegion);
    responseHeaders.set('x-routing-metadata', JSON.stringify(decision));

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Routing error:', error);

    return new Response(
      JSON.stringify({
        error: 'Routing failed',
        details: String(error),
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Get routing information without forwarding
 */
async function handleRoutingInfo(req: Request): Promise<Response> {
  try {
    const endpoints = getRegionalEndpoints();
    const decision = await makeRoutingDecision(req, endpoints);

    return new Response(JSON.stringify(decision), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Routing info error:', error);

    return new Response(
      JSON.stringify({
        error: 'Failed to get routing information',
        details: String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle OPTIONS requests for CORS
 */
function handleOptions(req: Request): Response {
  const origin = req.headers.get('origin') || '*';

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-region-override',
      'Access-Control-Allow-Credentials': 'true',
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

  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  // Check if this is an info request
  if (pathSegments[2] === 'info' || url.searchParams.get('info') === 'true') {
    return handleRoutingInfo(req);
  }

  // Otherwise, route the request
  const response = await handleRouting(req);

  // Add CORS headers
  response.headers.set('Access-Control-Allow-Origin', req.headers.get('origin') || '*');

  return response;
});
