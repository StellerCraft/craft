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
});
