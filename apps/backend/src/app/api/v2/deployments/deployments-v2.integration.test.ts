/**
 * Integration test: GET /api/v2/deployments (Issue #1165)
 *
 * v2 is the "internal" / latest format (see version-migration.middleware.ts) —
 * it is the shape every other version is migrated *into*, so a request that
 * already targets v2 should be served directly, with no schema migration in
 * the loop. This suite is the v2 counterpart to the (separately tracked) v1
 * deployments route coverage gap.
 *
 * What's tested:
 *   - The route responds with the v2 (internal) response shape directly:
 *     camelCase fields including the v2-only `updatedAt` / `vercelDeploymentId`
 *     additions, plus the `pagination` envelope — none of which exist on v1.
 *   - Query-parameter validation (`filter`, `sort`, `limit`) and the auth/error
 *     paths that guard the v2 handler.
 *   - Deprecation-header behaviour: a request that resolves to v2 — whether
 *     via an explicit versioned `Accept` header or by relying on the
 *     versioned `/api/v2/deployments` path alone — never carries a
 *     deprecation warning, because v2 is the current, non-deprecated version.
 *
 * Note on version negotiation for this route:
 *   `GET /api/v2/deployments` is wrapped in `withVersion` (see
 *   `with-version.ts`), whose `negotiateVersion` resolves the version from
 *   the URL path first, before it ever looks at a header or query param (see
 *   `version-negotiation.ts`). Because this route already lives at the
 *   versioned `/api/v2/...` path, negotiation always resolves via
 *   `source: 'path'` to version 2 here — an `Accept: application/vnd.craft.v2+json`
 *   header and no header at all are therefore equivalent for this route, and
 *   both correctly omit the deprecation header since v2 is not flagged as
 *   deprecated. That equivalence is exactly what's asserted below.
 *
 * Issue: #1165
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Module-level mocks ────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_USER = { id: 'user-v2-int-001', email: 'dev@example.com' };

/** Raw (snake_case) rows as they'd come back from Supabase. */
const RAW_ROWS = [
    {
        id: 'dep-1',
        name: 'my-app',
        status: 'completed',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        deployment_url: 'https://my-app.example.com',
        vercel_deployment_id: 'vercel-dep-1',
    },
    {
        id: 'dep-2',
        name: 'other-app',
        status: 'building',
        created_at: '2026-01-03T00:00:00.000Z',
        updated_at: '2026-01-03T01:00:00.000Z',
        deployment_url: null,
        vercel_deployment_id: 'vercel-dep-2',
    },
];

/**
 * Chainable Supabase query-builder mock matching the shape the v2 route
 * uses: .select().eq()[.eq()].order().limit() — where `.limit()` is the
 * terminal call that resolves the query.
 */
function makeDeploymentsTable(result: { data: unknown; error: unknown }) {
    const eqCalls: unknown[][] = [];
    const orderCalls: unknown[][] = [];

    const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn((...args: unknown[]) => {
            eqCalls.push(args);
            return builder;
        }),
        order: vi.fn((...args: unknown[]) => {
            orderCalls.push(args);
            return builder;
        }),
        limit: vi.fn(() => Promise.resolve(result)),
    };

    return { builder, eqCalls, orderCalls };
}

function getRequest(query = '', headers: Record<string, string> = {}): NextRequest {
    const qs = query ? `?${query}` : '';
    return new NextRequest(`http://localhost/api/v2/deployments${qs}`, {
        method: 'GET',
        headers,
    });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v2/deployments — internal-format response (integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: FAKE_USER }, error: null });
    });

    it('returns 401 when the request is unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./route');
        const res = await GET(getRequest(), { params: {} as never });
        expect(res.status).toBe(401);
    });

    it('serves the v2 (internal) shape directly, without any v1 → internal migration', async () => {
        const { builder } = makeDeploymentsTable({ data: RAW_ROWS, error: null });
        mockFrom.mockImplementation((table: string) => {
            expect(table).toBe('deployments');
            return builder;
        });

        const { GET } = await import('./route');
        const res = await GET(getRequest(), { params: {} as never });

        expect(res.status).toBe(200);
        const body = await res.json();

        // v2 response envelope: `deployments` + `pagination`, no v1 wrapping
        // and no `repositoryName`-style v1 field ever passes through, since
        // v2 IS the internal format (migrateV2ToInternal is an identity
        // transform) — there's nothing to migrate here.
        expect(body).toEqual({
            deployments: [
                {
                    id: 'dep-1',
                    name: 'my-app',
                    status: 'completed',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-02T00:00:00.000Z',
                    deploymentUrl: 'https://my-app.example.com',
                    vercelDeploymentId: 'vercel-dep-1',
                },
                {
                    id: 'dep-2',
                    name: 'other-app',
                    status: 'building',
                    createdAt: '2026-01-03T00:00:00.000Z',
                    updatedAt: '2026-01-03T01:00:00.000Z',
                    deploymentUrl: null,
                    vercelDeploymentId: 'vercel-dep-2',
                },
            ],
            pagination: { count: 2, limit: 50 },
        });

        // Only fields the v2 route actually projects — nothing gets dropped
        // or renamed via a migration step.
        for (const deployment of body.deployments) {
            expect(Object.keys(deployment).sort()).toEqual(
                [
                    'createdAt',
                    'deploymentUrl',
                    'id',
                    'name',
                    'status',
                    'updatedAt',
                    'vercelDeploymentId',
                ].sort(),
            );
        }
    });

    it('scopes the query to the authenticated user and defaults sort/limit', async () => {
        const { builder, eqCalls, orderCalls } = makeDeploymentsTable({ data: [], error: null });
        mockFrom.mockImplementation(() => builder);

        const { GET } = await import('./route');
        const res = await GET(getRequest(), { params: {} as never });

        expect(res.status).toBe(200);
        expect(eqCalls).toEqual([['user_id', FAKE_USER.id]]);
        expect(orderCalls).toEqual([['created_at', { ascending: false }]]);
        expect(builder.limit).toHaveBeenCalledWith(50);
    });

    it('applies an optional status filter as an additional eq() clause', async () => {
        const { builder, eqCalls } = makeDeploymentsTable({ data: [], error: null });
        mockFrom.mockImplementation(() => builder);

        const { GET } = await import('./route');
        const res = await GET(getRequest('filter=building'), { params: {} as never });

        expect(res.status).toBe(200);
        expect(eqCalls).toEqual([
            ['user_id', FAKE_USER.id],
            ['status', 'building'],
        ]);
    });

    it('rejects an invalid filter with 400', async () => {
        const { GET } = await import('./route');
        const res = await GET(getRequest('filter=not-a-status'), { params: {} as never });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Invalid filter/);
    });

    it('rejects an invalid sort with 400', async () => {
        const { GET } = await import('./route');
        const res = await GET(getRequest('sort=bogus_field'), { params: {} as never });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Invalid sort/);
    });

    it('rejects a non-numeric limit with 400', async () => {
        const { GET } = await import('./route');
        const res = await GET(getRequest('limit=abc'), { params: {} as never });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Invalid limit/);
    });

    it('caps an oversized limit at 100', async () => {
        const { builder } = makeDeploymentsTable({ data: [], error: null });
        mockFrom.mockImplementation(() => builder);

        const { GET } = await import('./route');
        const res = await GET(getRequest('limit=500'), { params: {} as never });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.pagination.limit).toBe(100);
        expect(builder.limit).toHaveBeenCalledWith(100);
    });

    it('returns 500 with the underlying message on a Supabase error', async () => {
        const { builder } = makeDeploymentsTable({
            data: null,
            error: { message: 'connection reset' },
        });
        mockFrom.mockImplementation(() => builder);

        const { GET } = await import('./route');
        const res = await GET(getRequest(), { params: {} as never });

        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.error).toBe('connection reset');
    });
});

describe('GET /api/v2/deployments — deprecation-header absence (integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: FAKE_USER }, error: null });
        const { builder } = makeDeploymentsTable({ data: [], error: null });
        mockFrom.mockImplementation(() => builder);
    });

    it('carries no deprecation header when v2 is requested explicitly via a versioned Accept header', async () => {
        const { GET } = await import('./route');
        const res = await GET(
            getRequest('', { accept: 'application/vnd.craft.v2+json' }),
            { params: {} as never },
        );

        expect(res.status).toBe(200);
        expect(res.headers.get('deprecation')).toBeNull();
        expect(res.headers.get('api-version')).toBe('2');
    });

    it('carries no deprecation header on an otherwise unversioned request to the v2 path', async () => {
        const { GET } = await import('./route');
        const res = await GET(getRequest(), { params: {} as never });

        expect(res.status).toBe(200);
        expect(res.headers.get('deprecation')).toBeNull();
        expect(res.headers.get('api-version')).toBe('2');
    });

    it('produces identical version headers whether v2 is requested explicitly or left unversioned', async () => {
        // The route is mounted at the versioned /api/v2/deployments path, so
        // negotiateVersion() resolves the version from the path (highest
        // priority) before it ever inspects a header. An explicit v2 Accept
        // header and no header at all therefore both resolve to the same
        // version — and since v2 isn't flagged as deprecated, neither
        // carries a deprecation warning.
        const { GET } = await import('./route');

        const explicit = await GET(
            getRequest('', { accept: 'application/vnd.craft.v2+json' }),
            { params: {} as never },
        );
        const unversioned = await GET(getRequest(), { params: {} as never });

        expect(explicit.headers.get('deprecation')).toBe(unversioned.headers.get('deprecation'));
        expect(explicit.headers.get('deprecation')).toBeNull();
        expect(explicit.headers.get('api-version')).toBe(unversioned.headers.get('api-version'));
        expect(explicit.headers.get('api-version')).toBe('2');
    });
});
