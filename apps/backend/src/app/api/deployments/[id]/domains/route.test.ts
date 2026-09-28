import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

const fakeUser = { id: 'user-1', email: 'user@example.com' };
const params = { id: 'dep-1' };

function makeRequest(body: unknown = { customDomain: 'app.example.com' }) {
    return new NextRequest('http://localhost/api/deployments/dep-1/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

type QueryResult = { data: Record<string, unknown> | null; error: { message: string } | null };

function makeSupabaseQuery(results: QueryResult[]) {
    return {
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue(results.shift() ?? { data: null, error: null }),
            })),
        })),
        update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue(results.shift() ?? { data: null, error: null }),
        })),
    };
}

describe('POST /api/deployments/[id]/domains', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { POST } = await import('./route');

        const res = await POST(makeRequest(), { params });

        expect(res.status).toBe(401);
    });

    it('returns 403 when the deployment belongs to another user', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: 'other-user' }, error: null }]),
        );
        const { POST } = await import('./route');

        const res = await POST(makeRequest(), { params });

        expect(res.status).toBe(403);
    });

    it('returns 400 for an empty domain', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
        );
        const { POST } = await import('./route');

        const res = await POST(makeRequest({ customDomain: '' }), { params });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('DOMAIN_EMPTY');
    });

    it('returns 400 for an invalid domain format', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
        );
        const { POST } = await import('./route');

        const res = await POST(makeRequest({ customDomain: 'https://bad-domain.com/path' }), { params });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('DOMAIN_INVALID_FORMAT');
    });

    it('returns 400 for a reserved domain', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
        );
        const { POST } = await import('./route');

        const res = await POST(makeRequest({ customDomain: 'example.com' }), { params });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('DOMAIN_RESERVED');
    });

    it('returns 400 for invalid JSON body', async () => {
        mockFrom.mockReturnValue(
            makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
        );
        const { POST } = await import('./route');

        const req = new NextRequest('http://localhost/api/deployments/dep-1/domains', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not-json',
        });
        const res = await POST(req, { params });

        expect(res.status).toBe(400);
    });

    it('returns 500 when the database update fails', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: null, error: { message: 'db error' } }]),
            );
        const { POST } = await import('./route');

        const res = await POST(makeRequest(), { params });

        expect(res.status).toBe(500);
    });

    it('returns 200 with DNS config for a valid apex domain', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: null, error: null }]),
            );
        const { POST } = await import('./route');

        const res = await POST(makeRequest({ customDomain: 'myapp.io' }), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.domain).toBe('myapp.io');
        expect(body.records.some((r: { type: string }) => r.type === 'A')).toBe(true);
        expect(body.records.some((r: { type: string }) => r.type === 'AAAA')).toBe(true);
        expect(body.providerInstructions.length).toBeGreaterThan(0);
        expect(Array.isArray(body.notes)).toBe(true);
    });

    it('returns 200 with a CNAME record for a valid subdomain', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: null, error: null }]),
            );
        const { POST } = await import('./route');

        const res = await POST(makeRequest({ customDomain: 'app.example.com' }), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.domain).toBe('app.example.com');
        expect(body.records.some((r: { type: string }) => r.type === 'CNAME')).toBe(true);
    });

    // ── Domain Uniqueness Enforcement ──────────────────────────────────────────

    it('returns 409 when domain is already attached to another deployment', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{
                    data: null,
                    error: { message: 'duplicate key value violates unique constraint "deployments_custom_domain_key"' }
                }]),
            );
        const { POST } = await import('./route');

        const res = await POST(makeRequest({ customDomain: 'app.example.com' }), { params });

        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.error).toContain('already attached');
    });

    it('returns 409 (not 500) when unique constraint violation occurs on domain attach', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{
                    data: null,
                    error: { message: 'Unique constraint violation' }
                }]),
            );
        const { POST } = await import('./route');

        const res = await POST(makeRequest({ customDomain: 'myapp.io' }), { params });

        expect(res.status).toBe(409);
    });

    it('allows attaching domain to first deployment without uniqueness error', async () => {
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: fakeUser.id }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: null, error: null }]),
            );
        const { POST } = await import('./route');

        const res = await POST(makeRequest({ customDomain: 'unique-domain-1.io' }), { params });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.domain).toBe('unique-domain-1.io');
    });

    it('simulates concurrent attach race: first request succeeds, second gets 409', async () => {
        const domain = 'shared-domain.io';

        // First deployment: attachment succeeds
        mockFrom
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: 'user-1' }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: null, error: null }]),
            )
            // Second deployment: uniqueness constraint violation
            .mockReturnValueOnce(
                makeSupabaseQuery([{ data: { user_id: 'user-2' }, error: null }]),
            )
            .mockReturnValueOnce(
                makeSupabaseQuery([{
                    data: null,
                    error: { message: 'duplicate key value violates unique constraint' }
                }]),
            );

        const { POST } = await import('./route');

        // First request succeeds
        const res1 = await POST(makeRequest({ customDomain: domain }), { params: { id: 'dep-1' } });
        expect(res1.status).toBe(200);

        // Second concurrent request fails with 409
        const res2 = await POST(makeRequest({ customDomain: domain }), { params: { id: 'dep-2' } });
        expect(res2.status).toBe(409);
        const body = await res2.json();
        expect(body.error).toContain('already attached');
    });
});
