import { describe, it, expect, vi } from 'vitest';

/**
 * API Versioning Tests (#371)
 *
 * Verifies version negotiation, backward compatibility, deprecated endpoint
 * warnings, version-specific behaviour, and migration paths.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type ApiVersion = 'v1' | 'v2' | 'v3';

interface VersionedRequest {
  path: string;
  method: string;
  version: ApiVersion;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface VersionedResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  warnings?: string[];
}

interface EndpointDefinition {
  path: string;
  method: string;
  supportedVersions: ApiVersion[];
  deprecated?: boolean;
  deprecatedSince?: ApiVersion;
  replacedBy?: string;
  handler: (req: VersionedRequest) => Record<string, unknown>;
}

// ── ApiVersionRouter ──────────────────────────────────────────────────────────

class ApiVersionRouter {
  private endpoints: EndpointDefinition[] = [];
  private readonly supportedVersions: ApiVersion[] = ['v1', 'v2', 'v3'];
  private readonly latestVersion: ApiVersion = 'v3';

  register(endpoint: EndpointDefinition): void {
    this.endpoints.push(endpoint);
  }

  handle(req: VersionedRequest): VersionedResponse {
    if (!this.supportedVersions.includes(req.version)) {
      return {
        status: 400,
        body: { error: `Unsupported API version: ${req.version}` },
        headers: { 'X-API-Version': req.version },
      };
    }

    const endpoint = this.endpoints.find(
      (e) => e.path === req.path && e.method === req.method && e.supportedVersions.includes(req.version),
    );

    if (!endpoint) {
      return {
        status: 404,
        body: { error: `${req.method} ${req.path} not found for version ${req.version}` },
        headers: { 'X-API-Version': req.version },
      };
    }

    const warnings: string[] = [];
    const headers: Record<string, string> = {
      'X-API-Version': req.version,
      'X-Latest-Version': this.latestVersion,
    };

    if (endpoint.deprecated) {
      const msg = endpoint.replacedBy
        ? `Deprecated since ${endpoint.deprecatedSince}. Use ${endpoint.replacedBy} instead.`
        : `Deprecated since ${endpoint.deprecatedSince}.`;
      warnings.push(msg);
      headers['Deprecation'] = 'true';
      headers['Sunset'] = endpoint.deprecatedSince ?? '';
    }

    if (req.version !== this.latestVersion) {
      headers['X-API-Upgrade-Available'] = this.latestVersion;
    }

    return {
      status: 200,
      body: endpoint.handler(req),
      headers,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  getSupportedVersions(): ApiVersion[] {
    return [...this.supportedVersions];
  }

  getLatestVersion(): ApiVersion {
    return this.latestVersion;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRouter(): ApiVersionRouter {
  const router = new ApiVersionRouter();

  // v1 endpoint (deprecated, replaced by v2+)
  router.register({
    path: '/api/deployments',
    method: 'GET',
    supportedVersions: ['v1'],
    deprecated: true,
    deprecatedSince: 'v2',
    replacedBy: '/api/v2/deployments',
    handler: () => ({ deployments: [], version: 'v1' }),
  });

  // v2 endpoint (still supported)
  router.register({
    path: '/api/deployments',
    method: 'GET',
    supportedVersions: ['v2', 'v3'],
    handler: (req) => ({
      deployments: [],
      version: req.version,
      pagination: { page: 1, limit: 10 },
    }),
  });

  // v3-only endpoint
  router.register({
    path: '/api/deployments/stats',
    method: 'GET',
    supportedVersions: ['v3'],
    handler: () => ({ total: 0, active: 0, failed: 0 }),
  });

  // POST available in all versions
  router.register({
    path: '/api/deployments',
    method: 'POST',
    supportedVersions: ['v1', 'v2', 'v3'],
    handler: (req) => ({ id: 'dep-1', ...req.body }),
  });

  return router;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Version negotiation', () => {
  it('returns 200 for a valid version', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    expect(res.status).toBe(200);
  });

  it('returns 400 for an unsupported version', () => {
    const router = makeRouter();
    // @ts-expect-error intentional invalid version
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v0' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported API version/);
  });

  it('includes X-API-Version header in every response', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    expect(res.headers['X-API-Version']).toBe('v2');
  });

  it('includes X-Latest-Version header pointing to latest', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    expect(res.headers['X-Latest-Version']).toBe('v3');
  });

  it('includes X-API-Upgrade-Available when not on latest version', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    expect(res.headers['X-API-Upgrade-Available']).toBe('v3');
  });

  it('does not include X-API-Upgrade-Available on latest version', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v3' });
    expect(res.headers['X-API-Upgrade-Available']).toBeUndefined();
  });

  it('getSupportedVersions returns all supported versions', () => {
    const router = makeRouter();
    expect(router.getSupportedVersions()).toEqual(['v1', 'v2', 'v3']);
  });
});

describe('Backward compatibility', () => {
  it('v1 endpoint still responds for v1 requests', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v1' });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v1');
  });

  it('v2 endpoint responds for v2 requests', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v2');
  });

  it('v2 endpoint also responds for v3 requests (multi-version support)', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v3' });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe('v3');
  });

  it('POST endpoint is available across all versions', () => {
    const router = makeRouter();
    for (const version of ['v1', 'v2', 'v3'] as ApiVersion[]) {
      const res = router.handle({ path: '/api/deployments', method: 'POST', version, body: { name: 'test' } });
      expect(res.status).toBe(200);
    }
  });

  it('v2 response includes pagination (version-specific field)', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    expect(res.body).toHaveProperty('pagination');
  });
});

describe('Deprecated endpoint warnings', () => {
  it('deprecated endpoint returns Deprecation header', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v1' });
    expect(res.headers['Deprecation']).toBe('true');
  });

  it('deprecated endpoint includes warning message', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v1' });
    expect(res.warnings).toBeDefined();
    expect(res.warnings![0]).toMatch(/Deprecated/);
  });

  it('deprecation warning includes replacement endpoint', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v1' });
    expect(res.warnings![0]).toContain('/api/v2/deployments');
  });

  it('non-deprecated endpoint has no Deprecation header', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    expect(res.headers['Deprecation']).toBeUndefined();
  });

  it('non-deprecated endpoint has no warnings', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    expect(res.warnings).toBeUndefined();
  });
});

describe('Version-specific behaviour', () => {
  it('v3-only endpoint returns 404 for v2 requests', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments/stats', method: 'GET', version: 'v2' });
    expect(res.status).toBe(404);
  });

  it('v3-only endpoint returns 200 for v3 requests', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments/stats', method: 'GET', version: 'v3' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
  });

  it('v1 endpoint returns 404 for v2 requests (not in supportedVersions)', () => {
    // The v1-only deprecated endpoint should not be found for v2
    const router = new ApiVersionRouter();
    router.register({
      path: '/api/legacy',
      method: 'GET',
      supportedVersions: ['v1'],
      handler: () => ({ legacy: true }),
    });
    const res = router.handle({ path: '/api/legacy', method: 'GET', version: 'v2' });
    expect(res.status).toBe(404);
  });

  it('response body reflects the requested version', () => {
    const router = makeRouter();
    const v2 = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    const v3 = router.handle({ path: '/api/deployments', method: 'GET', version: 'v3' });
    expect(v2.body.version).toBe('v2');
    expect(v3.body.version).toBe('v3');
  });
});

describe('Version migration paths', () => {
  it('v1 response shape is a subset of v2 response shape', () => {
    const router = makeRouter();
    const v1 = router.handle({ path: '/api/deployments', method: 'GET', version: 'v1' });
    const v2 = router.handle({ path: '/api/deployments', method: 'GET', version: 'v2' });
    // Both have deployments array
    expect(v1.body).toHaveProperty('deployments');
    expect(v2.body).toHaveProperty('deployments');
  });

  it('migrating from v1 to v2 preserves core fields', () => {
    const router = makeRouter();
    const v1 = router.handle({ path: '/api/deployments', method: 'POST', version: 'v1', body: { name: 'my-app' } });
    const v2 = router.handle({ path: '/api/deployments', method: 'POST', version: 'v2', body: { name: 'my-app' } });
    expect(v1.body.name).toBe('my-app');
    expect(v2.body.name).toBe('my-app');
  });

  it('getLatestVersion returns v3', () => {
    const router = makeRouter();
    expect(router.getLatestVersion()).toBe('v3');
  });

  it('upgrade header guides clients to latest version', () => {
    const router = makeRouter();
    const res = router.handle({ path: '/api/deployments', method: 'GET', version: 'v1' });
    expect(res.headers['X-API-Upgrade-Available']).toBe('v3');
  });
});
