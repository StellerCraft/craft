/**
 * Tests for PATCH /api/auth/github-connection
 *
 * Mocks:
 *   @/lib/supabase/server — stubbed so no real DB calls are made.
 *   withAuth              — bypassed via the supabase mock.
 *
 * Coverage:
 *   — connect with valid username → 200, returns githubConnected: true + username
 *   — disconnect → 200, returns githubConnected: false, githubUsername: null
 *   — missing username when connecting → 400
 *   — invalid JSON body → 400
 *   — DB update error → 500
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockUpdate = vi.fn();
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: () => ({
            update: () => ({ eq: mockUpdate }),
        }),
    }),
}));

const MOCK_USER = { id: 'user-1', email: 'a@b.com' };

function makeRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/auth/github-connection', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('PATCH /api/auth/github-connection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
        mockUpdate.mockResolvedValue({ error: null });
    });

    // Lazy import so the vi.mock above is applied first.
    async function handler() {
        const { PATCH } = await import('./route');
        return PATCH;
    }

    it('connects GitHub and returns the username', async () => {
        const PATCH = await handler();
        const res = await PATCH(makeRequest({ connected: true, username: 'octocat' }), { params: {} } as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ githubConnected: true, githubUsername: 'octocat' });
    });

    it('disconnects GitHub and returns null username', async () => {
        const PATCH = await handler();
        const res = await PATCH(makeRequest({ connected: false }), { params: {} } as never);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({ githubConnected: false, githubUsername: null });
    });

    it('returns 400 when connecting without a username', async () => {
        const PATCH = await handler();
        const res = await PATCH(makeRequest({ connected: true }), { params: {} } as never);

        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON', async () => {
        const PATCH = await handler();
        const req = new NextRequest('http://localhost/api/auth/github-connection', {
            method: 'PATCH',
            body: 'not-json',
        });
        const res = await PATCH(req, { params: {} } as never);

        expect(res.status).toBe(400);
    });

    it('returns 500 when the DB update fails', async () => {
        mockUpdate.mockResolvedValue({ error: { message: 'db error' } });
        const PATCH = await handler();
        const res = await PATCH(makeRequest({ connected: true, username: 'octocat' }), { params: {} } as never);

        expect(res.status).toBe(500);
    });
});
