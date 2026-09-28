export interface RegionEndpoint {
  region: string;
  baseUrl: string;
  priority: number;
}

export class NoHealthyRegionsError extends Error {
  constructor() {
    super('No healthy regions are available; retry after regional health recovers');
    this.name = 'NoHealthyRegionsError';
  }
}

export function orderHealthyEndpoints(
  endpoints: RegionEndpoint[],
  healthStatus: ReadonlyMap<string, boolean>,
  detectedRegion: string,
): RegionEndpoint[] {
  if (!endpoints.some((endpoint) => healthStatus.get(endpoint.region) === true)) {
    throw new NoHealthyRegionsError();
  }

  return [...endpoints].sort((a, b) => {
    const aHealthy = healthStatus.get(a.region) ?? false;
    const bHealthy = healthStatus.get(b.region) ?? false;
    if (aHealthy !== bHealthy) return aHealthy ? -1 : 1;

    const aMatches = a.region === detectedRegion ? 1 : 0;
    const bMatches = b.region === detectedRegion ? 1 : 0;
    return bMatches - aMatches;
  });
}