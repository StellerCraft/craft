import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, withDeploymentAuth } from './with-auth';

// --- Supabase server mock ---
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

const makeRequest = () => new NextRequest('http://localhost/api/test');

describe('withAuth', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns 401 when no session exists', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

        const handler = withAuth(async () => NextResponse.json({ ok: true }));
        const res = await handler(makeRequest(), { params: {} });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 when getUser returns an error', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('jwt expired') });

        const handler = withAuth(async () => NextResponse.json({ ok: true }));
        const res = await handler(makeRequest(), { params: {} });

        expect(res.status).toBe(401);
    });

    it('calls the handler with user and supabase when authenticated and not soft-deleted', async () => {
        const fakeUser = { id: 'user-1', email: 'a@b.com' };
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
        mockFrom.mockImplementation(() => ({
            select: () => ({
                eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: { id: 'user-1' } }) }) }),
            }),
        }));

        const inner = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const handler = withAuth(inner);
        const res = await handler(makeRequest(), { params: {} });

        expect(res.status).toBe(200);
        expect(inner).toHaveBeenCalledOnce();
        expect(inner.mock.calls[0][1].user).toEqual(fakeUser);
        expect(inner.mock.calls[0][1].supabase).toBeDefined();
    });

    it('returns 401 when user is soft-deleted', async () => {
        const fakeUser = { id: 'user-1', email: 'a@b.com' };
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
        mockFrom.mockImplementation(() => ({
            select: () => ({
                eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: null }) }) }),
            }),
        }));

        const handler = withAuth(async () => NextResponse.json({ ok: true }));
        const res = await handler(makeRequest(), { params: {} });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
    });
});

describe('withDeploymentAuth', () => {
    const fakeUser = { id: 'user-1', email: 'a@b.com' };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 403 when deployment not found', async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'profiles') {
                return {
                    select: () => ({ eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: { id: 'user-1' } } ) }) }) }),
                };
            }
            return {
                select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
            };
        });

        const handler = withDeploymentAuth(async () => NextResponse.json({ ok: true }));
        const res = await handler(makeRequest(), { params: { id: 'dep-1' } });

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Forbidden' });
    });

    it('returns 403 when deployment belongs to a different user', async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'profiles') {
                return {
                    select: () => ({ eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: { id: 'user-1' } } ) }) }) }),
                };
            }
            return {
                select: () => ({
                    eq: () => ({ single: () => Promise.resolve({ data: { user_id: 'other-user' } }) }),
                }),
            };
        });

        const handler = withDeploymentAuth(async () => NextResponse.json({ ok: true }));
        const res = await handler(makeRequest(), { params: { id: 'dep-1' } });

        expect(res.status).toBe(403);
    });

    it('calls the handler when user owns the deployment', async () => {
        mockFrom.mockImplementation((table: string) => {
            if (table === 'profiles') {
                return {
                    select: () => ({ eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: { id: 'user-1' } } ) }) }) }),
                };
            }
            return {
                select: () => ({
                    eq: () => ({ single: () => Promise.resolve({ data: { user_id: fakeUser.id } }) }),
                }),
            };
        });

        const inner = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const handler = withDeploymentAuth(inner);
        const res = await handler(makeRequest(), { params: { id: 'dep-1' } });

        expect(res.status).toBe(200);
        expect(inner).toHaveBeenCalledOnce();
    });

    it('returns 401 when unauthenticated (inherits withAuth behaviour)', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

        const handler = withDeploymentAuth(async () => NextResponse.json({ ok: true }));
        const res = await handler(makeRequest(), { params: { id: 'dep-1' } });

        expect(res.status).toBe(401);
    });

    it('returns 401 when user is soft-deleted (inherits withAuth behaviour)', async () => {
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
        mockFrom.mockImplementation((table: string) => {
            if (table === 'profiles') {
                return {
                    select: () => ({ eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: null }) }) }) }),
                };
            }
            return {
                select: () => ({
                    eq: () => ({ single: () => Promise.resolve({ data: { user_id: fakeUser.id } }) }),
                }),
            };
        });

        const handler = withDeploymentAuth(async () => NextResponse.json({ ok: true }));
        const res = await handler(makeRequest(), { params: { id: 'dep-1' } });

        expect(res.status).toBe(401);
    });
});
