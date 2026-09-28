import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withRole } from './with-role';

// --- Supabase server mock ---
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
    }),
}));

const makeRequest = () => new NextRequest('http://localhost/api/admin/stats');

describe('withRole', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.ADMIN_USER_IDS;
    });

    afterEach(() => {
        delete process.env.ADMIN_USER_IDS;
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

        const handler = vi.fn();
        const wrapped = withRole('admin', handler);
        const res = await wrapped(makeRequest(), { params: {} });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Unauthorized' });
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 401 when getUser returns an error', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('jwt expired') });

        const handler = vi.fn();
        const wrapped = withRole('admin', handler);
        const res = await wrapped(makeRequest(), { params: {} });

        expect(res.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 403 when the authenticated user has a different role', async () => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: 'user-1', user_metadata: { role: 'member' } } },
            error: null,
        });

        const handler = vi.fn();
        const wrapped = withRole('admin', handler);
        const res = await wrapped(makeRequest(), { params: {} });

        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Forbidden: insufficient role' });
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 403 when the user has no role metadata and is not in the ADMIN_USER_IDS fallback', async () => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: 'user-1', user_metadata: {} } },
            error: null,
        });

        const handler = vi.fn();
        const wrapped = withRole('admin', handler);
        const res = await wrapped(makeRequest(), { params: {} });

        expect(res.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('calls the handler when user_metadata.role matches the required role', async () => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: 'user-1', user_metadata: { role: 'admin' } } },
            error: null,
        });

        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withRole('admin', handler);
        const res = await wrapped(makeRequest(), { params: {} });

        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][1]).toMatchObject({ userId: 'user-1' });
    });

    it('calls the handler when the user id is in the ADMIN_USER_IDS fallback allowlist', async () => {
        process.env.ADMIN_USER_IDS = 'user-2, user-3';
        mockGetUser.mockResolvedValue({
            data: { user: { id: 'user-3', user_metadata: {} } },
            error: null,
        });

        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withRole('admin', handler);
        const res = await wrapped(makeRequest(), { params: {} });

        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledOnce();
    });

    it('does not grant access via ADMIN_USER_IDS when the user id is not listed', async () => {
        process.env.ADMIN_USER_IDS = 'user-2, user-3';
        mockGetUser.mockResolvedValue({
            data: { user: { id: 'user-99', user_metadata: {} } },
            error: null,
        });

        const handler = vi.fn();
        const wrapped = withRole('admin', handler);
        const res = await wrapped(makeRequest(), { params: {} });

        expect(res.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    describe('role-source precedence', () => {
        it('grants access via user_metadata even when ADMIN_USER_IDS does not list the user', async () => {
            process.env.ADMIN_USER_IDS = 'someone-else';
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-1', user_metadata: { role: 'admin' } } },
                error: null,
            });

            const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
            const res = await withRole('admin', handler)(makeRequest(), { params: {} });

            expect(res.status).toBe(200);
            expect(handler).toHaveBeenCalledOnce();
        });

        it('falls back to ADMIN_USER_IDS when user_metadata carries a non-admin role', async () => {
            process.env.ADMIN_USER_IDS = 'user-1';
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-1', user_metadata: { role: 'member' } } },
                error: null,
            });

            const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
            const res = await withRole('admin', handler)(makeRequest(), { params: {} });

            expect(res.status).toBe(200);
            expect(handler).toHaveBeenCalledOnce();
        });

        it('uses the fallback when user_metadata is missing entirely', async () => {
            process.env.ADMIN_USER_IDS = 'user-1';
            mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

            const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
            const res = await withRole('admin', handler)(makeRequest(), { params: {} });

            expect(res.status).toBe(200);
        });

        it('does not consult ADMIN_USER_IDS for an unauthenticated request', async () => {
            process.env.ADMIN_USER_IDS = 'user-1';
            mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

            const handler = vi.fn();
            const res = await withRole('admin', handler)(makeRequest(), { params: {} });

            expect(res.status).toBe(401);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('ADMIN_USER_IDS whitespace handling', () => {
        it.each([
            ['leading/trailing spaces', '  user-1  ,user-2'],
            ['tabs and newlines', 'user-2,\tuser-1\n'],
            ['spaces on both sides of every entry', ' user-2 , user-1 , user-3 '],
        ])('trims %s around allowlisted IDs', async (_label, allowlist) => {
            process.env.ADMIN_USER_IDS = allowlist;
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-1', user_metadata: {} } },
                error: null,
            });

            const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
            const res = await withRole('admin', handler)(makeRequest(), { params: {} });

            expect(res.status).toBe(200);
        });

        it('does not match a partial ID substring', async () => {
            process.env.ADMIN_USER_IDS = 'user-10, user-11';
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-1', user_metadata: {} } },
                error: null,
            });

            const handler = vi.fn();
            const res = await withRole('admin', handler)(makeRequest(), { params: {} });

            expect(res.status).toBe(403);
        });

        it('denies with 403 when ADMIN_USER_IDS is an empty string', async () => {
            process.env.ADMIN_USER_IDS = '';
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-1', user_metadata: {} } },
                error: null,
            });

            const handler = vi.fn();
            const res = await withRole('admin', handler)(makeRequest(), { params: {} });

            expect(res.status).toBe(403);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    it('passes userId, correlationId and log to the handler on success', async () => {
        mockGetUser.mockResolvedValue({
            data: { user: { id: 'user-1', user_metadata: { role: 'admin' } } },
            error: null,
        });

        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        await withRole('admin', handler)(makeRequest(), { params: {} });

        const ctx = handler.mock.calls[0][1];
        expect(ctx.userId).toBe('user-1');
        expect(typeof ctx.correlationId).toBe('string');
        expect(ctx.correlationId.length).toBeGreaterThan(0);
        expect(typeof ctx.log.info).toBe('function');
    });
});
