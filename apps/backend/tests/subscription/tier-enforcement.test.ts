// @vitest-environment node
/**
 * Tests for subscription tier enforcement middleware (#767)
 *
 * Covers:
 *   - Free tier can access free routes
 *   - Free tier is blocked from pro routes (402)
 *   - Pro tier can access pro routes
 *   - Pro tier is blocked from enterprise routes (402)
 *   - Enterprise tier can access all routes
 *   - 402 response contains upgradeUrl
 *   - Tier is re-read from Supabase (not JWT)
 *   - Unauthenticated requests get 401
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Supabase mock factory ─────────────────────────────────────────────────────

function makeSupabaseMock(tier: string | null, authenticated = true) {
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: authenticated ? { id: 'user-1' } : null },
                error: authenticated ? null : new Error('unauthenticated'),
            }),
        },
        from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
                data: tier !== null ? { subscription_tier: tier } : null,
                error: null,
            }),
        }),
    };
}

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
const mockCreateClient = vi.mocked(createClient);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(path = '/api/deployments'): NextRequest {
    return new NextRequest(`http://localhost${path}`, { method: 'GET' });
}

const okHandler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('withTierEnforcement', () => {
    beforeEach(() => {
        vi.resetModules();
        okHandler.mockClear();
    });

    async function load() {
        const { withTierEnforcement } = await import('@/lib/tier-enforcement.middleware');
        return withTierEnforcement;
    }

    it('allows free-tier user to access a free-required route', async () => {
        mockCreateClient.mockReturnValue(makeSupabaseMock('free') as any);
        const withTierEnforcement = await load();
        const handler = withTierEnforcement('free', okHandler);
        const res = await handler(makeRequest(), { params: {} });
        expect(res.status).toBe(200);
        expect(okHandler).toHaveBeenCalledOnce();
    });

    it('blocks free-tier user from a pro-required route with 402', async () => {
        mockCreateClient.mockReturnValue(makeSupabaseMock('free') as any);
        const withTierEnforcement = await load();
        const handler = withTierEnforcement('pro', okHandler);
        const res = await handler(makeRequest(), { params: {} });
        expect(res.status).toBe(402);
        expect(okHandler).not.toHaveBeenCalled();
    });

    it('allows pro-tier user to access a pro-required route', async () => {
        mockCreateClient.mockReturnValue(makeSupabaseMock('pro') as any);
        const withTierEnforcement = await load();
        const handler = withTierEnforcement('pro', okHandler);
        const res = await handler(makeRequest(), { params: {} });
        expect(res.status).toBe(200);
        expect(okHandler).toHaveBeenCalledOnce();
    });

    it('blocks pro-tier user from an enterprise-required route with 402', async () => {
        mockCreateClient.mockReturnValue(makeSupabaseMock('pro') as any);
        const withTierEnforcement = await load();
        const handler = withTierEnforcement('enterprise', okHandler);
        const res = await handler(makeRequest(), { params: {} });
        expect(res.status).toBe(402);
        expect(okHandler).not.toHaveBeenCalled();
    });

    it('allows enterprise-tier user to access any route', async () => {
        mockCreateClient.mockReturnValue(makeSupabaseMock('enterprise') as any);
        const withTierEnforcement = await load();

        for (const tier of ['free', 'pro', 'enterprise'] as const) {
            const handler = withTierEnforcement(tier, okHandler);
            const res = await handler(makeRequest(), { params: {} });
            expect(res.status).toBe(200);
        }
    });

    it('includes upgradeUrl in 402 response body', async () => {
        mockCreateClient.mockReturnValue(makeSupabaseMock('free') as any);
        const withTierEnforcement = await load();
        const handler = withTierEnforcement('pro', okHandler);
        const res = await handler(makeRequest(), { params: {} });
        const body = await res.json();
        expect(body).toHaveProperty('upgradeUrl', '/pricing');
    });

    it('re-reads tier from Supabase, not JWT', async () => {
        const mock = makeSupabaseMock('pro');
        mockCreateClient.mockReturnValue(mock as any);
        const withTierEnforcement = await load();
        const handler = withTierEnforcement('pro', okHandler);
        await handler(makeRequest(), { params: {} });
        // Verify the profiles table was queried
        expect(mock.from).toHaveBeenCalledWith('profiles');
    });

    it('returns 401 for unauthenticated requests', async () => {
        mockCreateClient.mockReturnValue(makeSupabaseMock(null, false) as any);
        const withTierEnforcement = await load();
        const handler = withTierEnforcement('free', okHandler);
        const res = await handler(makeRequest(), { params: {} });
        expect(res.status).toBe(401);
        expect(okHandler).not.toHaveBeenCalled();
    });

    it('defaults to free tier when profile row is missing', async () => {
        const mock = makeSupabaseMock(null); // null tier → no profile row
        mockCreateClient.mockReturnValue(mock as any);
        const withTierEnforcement = await load();

        // free required → should pass (null treated as free)
        const freeHandler = withTierEnforcement('free', okHandler);
        const res = await freeHandler(makeRequest(), { params: {} });
        expect(res.status).toBe(200);
    });

    it('logs database query errors and fails closed to free tier (returning 402 for pro)', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mock = {
            auth: {
                getUser: vi.fn().mockResolvedValue({
                    data: { user: { id: 'user-1' } },
                    error: null,
                }),
            },
            from: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'connection timeout to Supabase', code: 'PGRST504' },
                }),
            }),
        };
        mockCreateClient.mockReturnValue(mock as any);
        const withTierEnforcement = await load();

        const handler = withTierEnforcement('pro', okHandler);
        const res = await handler(makeRequest('/api/deployments/analytics'), { params: {} });

        expect(res.status).toBe(402);
        expect(okHandler).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalled();
        const logged = consoleErrorSpy.mock.calls[0]?.[0];
        expect(logged).toContain('Database error during subscription tier lookup');
        consoleErrorSpy.mockRestore();
    });

    it('does not log error for legitimate free-tier user with no database error', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCreateClient.mockReturnValue(makeSupabaseMock('free') as any);
        const withTierEnforcement = await load();

        const handler = withTierEnforcement('pro', okHandler);
        const res = await handler(makeRequest('/api/deployments/analytics'), { params: {} });

        expect(res.status).toBe(402);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });
});
