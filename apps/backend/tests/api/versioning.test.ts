import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ApiVersionRouter } from '@/lib/api/versioning';

/**
 * API Versioning Tests (#371)
 *
 * Verifies version negotiation, backward compatibility, deprecated endpoint
 * warnings, version-specific behaviour, and migration paths using the
 * production ApiVersionRouter from @/lib/api/versioning.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(url: string, method: string, version?: string, body?: unknown): NextRequest {
  const headers: Record<string, string> = {};
  if (version) headers['API-Version'] = version;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    return new NextRequest(url, { method, headers, body: JSON.stringify(body) });
  }
  return new NextRequest(url, { method, headers });
}

async function parseJson(res: NextResponse): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Multi-version deployments router for testing.
 * Simulates a future state where v1–v3 are all supported and v3 is current.
 */
function makeDeploymentsRouter(): ApiVersionRouter {
  const router = new ApiVersionRouter({
    supportedVersions: ['v1', 'v2', 'v3'],
    currentVersion: 'v3',
  });

  // v1 GET (deprecated, replaced by v2+)
  router.register('GET', {
    supportedVersions: ['v1'],
    deprecated: true,
    deprecatedSince: 'v2',
    replacedBy: '/api/v2/deployments',
    handler: async () => NextResponse.json({ deployments: [], version: 'v1' }),
  });

  // v2/v3 GET (not individually deprecated)
  router.register('GET', {
    supportedVersions: ['v2', 'v3'],
    handler: async (req: any) => {
      const version = req.headers.get('API-Version') ?? 'v3';
      return NextResponse.json({
        deployments: [],
        version,
        pagination: { page: 1, limit: 10 },
      });
    },
  });

  // POST available in all versions
  router.register('POST', {
    supportedVersions: ['v1', 'v2', 'v3'],
    handler: async (req: any) => {
      let body: Record<string, unknown> = {};
      try { body = await req.json(); } catch { /* empty body */ }
      return NextResponse.json({ id: 'dep-1', ...body });
    },
  });

  return router;
}

/** Stats endpoint router — only available in v3. */
function makeStatsRouter(): ApiVersionRouter {
  const router = new ApiVersionRouter({
    supportedVersions: ['v1', 'v2', 'v3'],
    currentVersion: 'v3',
  });

  router.register('GET', {
    supportedVersions: ['v3'],
    handler: async () => NextResponse.json({ total: 0, active: 0, failed: 0 }),
  });

  return router;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Version negotiation', () => {
  it('returns 200 for a valid version', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 for an unsupported version', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v0'),
      'GET',
      {},
    );
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toMatch(/Unsupported API version/);
    expect(body.supportedVersions).toEqual(['v1', 'v2', 'v3']);
  });

  it('defaults to current version when API-Version header is absent', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET'),
      'GET',
      {},
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-API-Version')).toBe('v3');
  });

  it('includes X-API-Version header in every response', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    expect(res.headers.get('X-API-Version')).toBe('v2');
  });

  it('includes X-Latest-Version header pointing to current version', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    expect(res.headers.get('X-Latest-Version')).toBe('v3');
  });

  it('includes X-API-Upgrade-Available when not on current version', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    expect(res.headers.get('X-API-Upgrade-Available')).toBe('v3');
  });

  it('does not include X-API-Upgrade-Available on current version', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v3'),
      'GET',
      {},
    );
    expect(res.headers.get('X-API-Upgrade-Available')).toBeNull();
  });

  it('getSupportedVersions returns all supported versions', () => {
    const router = makeDeploymentsRouter();
    expect(router.getSupportedVersions()).toEqual(['v1', 'v2', 'v3']);
  });
});

describe('Backward compatibility', () => {
  it('v1 endpoint still responds for v1 requests', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v1'),
      'GET',
      {},
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.version).toBe('v1');
  });

  it('v2 endpoint responds for v2 requests', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.version).toBe('v2');
  });

  it('v2 endpoint also responds for v3 requests (multi-version support)', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v3'),
      'GET',
      {},
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.version).toBe('v3');
  });

  it('POST endpoint is available across all versions', async () => {
    const router = makeDeploymentsRouter();
    for (const version of ['v1', 'v2', 'v3']) {
      const res = await router.handle(
        makeRequest('http://localhost/api/deployments', 'POST', version, { name: 'test' }),
        'POST',
        {},
      );
      expect(res.status).toBe(200);
    }
  });

  it('v2 response includes pagination (version-specific field)', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    const body = await parseJson(res);
    expect(body).toHaveProperty('pagination');
  });
});

describe('Deprecated endpoint warnings', () => {
  it('deprecated handler returns Deprecation header', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v1'),
      'GET',
      {},
    );
    expect(res.headers.get('Deprecation')).toBe('true');
  });

  it('deprecated handler includes Sunset header with deprecatedSince version', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v1'),
      'GET',
      {},
    );
    expect(res.headers.get('Sunset')).toBe('v2');
  });

  it('non-current version returns Deprecation header', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    expect(res.headers.get('Deprecation')).toBe('true');
  });

  it('current version handler with no deprecation flag has no Deprecation header', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v3'),
      'GET',
      {},
    );
    expect(res.headers.get('Deprecation')).toBeNull();
  });
});

describe('Version-specific behaviour', () => {
  it('v3-only endpoint returns 404 for v2 requests', async () => {
    const router = makeStatsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments/stats', 'GET', 'v2'),
      'GET',
      {},
    );
    expect(res.status).toBe(404);
  });

  it('v3-only endpoint returns 200 for v3 requests', async () => {
    const router = makeStatsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments/stats', 'GET', 'v3'),
      'GET',
      {},
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body).toHaveProperty('total');
  });

  it('v1-only handler returns 404 for v2 requests (not in supportedVersions)', async () => {
    const router = new ApiVersionRouter({
      supportedVersions: ['v1', 'v2', 'v3'],
      currentVersion: 'v3',
    });
    router.register('GET', {
      supportedVersions: ['v1'],
      handler: async () => NextResponse.json({ legacy: true }),
    });
    const res = await router.handle(
      makeRequest('http://localhost/api/legacy', 'GET', 'v2'),
      'GET',
      {},
    );
    expect(res.status).toBe(404);
  });

  it('response body reflects the requested version', async () => {
    const router = makeDeploymentsRouter();
    const v2Res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    const v3Res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v3'),
      'GET',
      {},
    );
    const v2Body = await parseJson(v2Res);
    const v3Body = await parseJson(v3Res);
    expect(v2Body.version).toBe('v2');
    expect(v3Body.version).toBe('v3');
  });
});

describe('Version migration paths', () => {
  it('v1 response shape is a subset of v2 response shape', async () => {
    const router = makeDeploymentsRouter();
    const v1Res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v1'),
      'GET',
      {},
    );
    const v2Res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v2'),
      'GET',
      {},
    );
    const v1Body = await parseJson(v1Res);
    const v2Body = await parseJson(v2Res);
    expect(v1Body).toHaveProperty('deployments');
    expect(v2Body).toHaveProperty('deployments');
  });

  it('migrating from v1 to v2 preserves core fields', async () => {
    const router = makeDeploymentsRouter();
    const v1Res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'POST', 'v1', { name: 'my-app' }),
      'POST',
      {},
    );
    const v2Res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'POST', 'v2', { name: 'my-app' }),
      'POST',
      {},
    );
    const v1Body = await parseJson(v1Res);
    const v2Body = await parseJson(v2Res);
    expect(v1Body.name).toBe('my-app');
    expect(v2Body.name).toBe('my-app');
  });

  it('getCurrentVersion returns the current version', () => {
    const router = makeDeploymentsRouter();
    expect(router.getCurrentVersion()).toBe('v3');
  });

  it('upgrade header guides clients to current version', async () => {
    const router = makeDeploymentsRouter();
    const res = await router.handle(
      makeRequest('http://localhost/api/deployments', 'GET', 'v1'),
      'GET',
      {},
    );
    expect(res.headers.get('X-API-Upgrade-Available')).toBe('v3');
  });
});
