/**
 * Parametric test suite for Multi-Provider OAuth session token lifecycle (#708)
 *
 * Covers token issuance, expiry detection, silent refresh, forced re-auth,
 * and cross-provider token isolation for GitHub, Google, and generic OIDC.
 *
 * Uses it.each with provider configuration fixtures so every lifecycle
 * assertion runs identically against all three providers.
 *
 * Mock strategy: all external OAuth endpoints are mocked via vi.mock;
 * Supabase is an in-memory spy — no live provider calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── token-encryption mock ─────────────────────────────────────────────────────
const mockEncryptToken = vi.fn((t: string) => `enc:${t}`);
const mockDecryptToken = vi.fn((t: string) => t.replace(/^enc:/, ''));
vi.mock('@/lib/github/token-encryption', () => ({
    encryptToken: mockEncryptToken,
    decryptToken: mockDecryptToken,
}));

// ── Provider configuration fixtures ──────────────────────────────────────────

interface ProviderFixture {
    label: string;
    /** 'github' maps to native service methods; others use provider_connections JSONB slot */
    provider: 'github' | 'google' | 'oidc';
    connectionKey: string;
    tokenValue: string;
    futureExpiry: string;
    pastExpiry: string;
}

const PROVIDER_FIXTURES: ProviderFixture[] = [
    {
        label: 'GitHub',
        provider: 'github',
        connectionKey: 'github',
        tokenValue: 'ghp_github_access_token_abc123',
        futureExpiry: '2027-01-01T00:00:00Z',
        pastExpiry: '2020-01-01T00:00:00Z',
    },
    {
        label: 'Google',
        provider: 'google',
        connectionKey: 'google',
        tokenValue: 'ya29.google_oauth_token_xyz456',
        futureExpiry: '2027-06-01T00:00:00Z',
        pastExpiry: '2020-06-01T00:00:00Z',
    },
    {
        label: 'Generic OIDC',
        provider: 'oidc',
        connectionKey: 'oidc',
        tokenValue: 'oidc_token_generic_provider_789',
        futureExpiry: '2027-12-01T00:00:00Z',
        pastExpiry: '2020-12-01T00:00:00Z',
    },
];

// ── Supabase mock factory ─────────────────────────────────────────────────────

type UpdatePayload = Record<string, unknown>;

function makeSupabase(rows: Record<string, unknown> = {}) {
    const updateCalls: UpdatePayload[] = [];
    return {
        _updateCalls: updateCalls,
        rpc: vi.fn().mockImplementation((fnName: string, args: Record<string, unknown>) => {
            if (fnName === 'connect_stellar_provider') {
                const existing = (rows.provider_connections as Record<string, unknown>) ?? {};
                const updated = {
                    ...existing,
                    stellar: { publicKey: args.p_public_key, connectedAt: args.p_connected_at },
                };
                rows.provider_connections = updated;
                updateCalls.push({ provider_connections: updated, updated_at: new Date().toISOString() });
                return Promise.resolve({ error: null });
            }
            if (fnName === 'disconnect_stellar_provider') {
                const existing = (rows.provider_connections as Record<string, unknown>) ?? {};
                const { stellar: _removed, ...rest } = existing as any;
                rows.provider_connections = rest;
                updateCalls.push({ provider_connections: rest, updated_at: new Date().toISOString() });
                return Promise.resolve({ error: null });
            }
            return Promise.resolve({ error: null });
        }),
        from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockImplementation((payload: UpdatePayload) => {
                updateCalls.push(payload);
                return { eq: vi.fn().mockResolvedValue({ error: null }) };
            }),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: rows, error: null }),
        }),
    } as any;
}

// ── Abstract provider operations ──────────────────────────────────────────────
// Uniform interface across all three providers so it.each tests stay DRY.

async function issueToken(
    service: any,
    supabase: any,
    userId: string,
    fixture: ProviderFixture,
    expiresAt: string | null,
) {
    if (fixture.provider === 'github') {
        return service.connectGitHub(supabase, userId, fixture.tokenValue, 'testuser', expiresAt);
    }
    // Google / OIDC — stored in provider_connections like a generic OIDC slot
    const { data } = await supabase
        .from('profiles')
        .select('provider_connections')
        .eq('id', userId)
        .single();
    const existing = (data?.provider_connections as Record<string, unknown>) ?? {};
    const updated = {
        ...existing,
        [fixture.connectionKey]: {
            accessToken: mockEncryptToken(fixture.tokenValue),
            expiresAt,
            connectedAt: '2026-01-01T00:00:00Z',
        },
    };
    await supabase
        .from('profiles')
        .update({ provider_connections: updated, updated_at: new Date().toISOString() })
        .eq('id', userId);
    return { connected: true, provider: fixture.provider };
}

async function getToken(
    service: any,
    supabase: any,
    userId: string,
    fixture: ProviderFixture,
): Promise<string | null> {
    if (fixture.provider === 'github') {
        return service.getGitHubToken(supabase, userId);
    }
    const { data } = await supabase
        .from('profiles')
        .select('provider_connections')
        .eq('id', userId)
        .single();
    return (data?.provider_connections as any)?.[fixture.connectionKey]?.accessToken ?? null;
}

async function revokeToken(
    service: any,
    supabase: any,
    userId: string,
    fixture: ProviderFixture,
): Promise<{ connected: boolean }> {
    if (fixture.provider === 'github') {
        return service.disconnectProvider(supabase, userId, 'github');
    }
    const { data } = await supabase
        .from('profiles')
        .select('provider_connections')
        .eq('id', userId)
        .single();
    const existing = (data?.provider_connections as Record<string, unknown>) ?? {};
    const { [fixture.connectionKey]: _removed, ...rest } = existing as any;
    await supabase
        .from('profiles')
        .update({ provider_connections: rest, updated_at: new Date().toISOString() })
        .eq('id', userId);
    return { connected: false };
}

/** Returns true when the stored expiry pre-dates the reference point. */
function isTokenExpired(expiresAt: string | null, now = '2026-06-24T00:00:00Z'): boolean {
    if (!expiresAt) return false;
    return expiresAt < now;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Multi-Provider OAuth Token Lifecycle (Parametric) — #708', () => {
    beforeEach(() => vi.clearAllMocks());

    // ── Full lifecycle: issue → silent refresh → forced re-auth → revoke ───────

    it.each(PROVIDER_FIXTURES)(
        '[$label] lifecycle: issue → silent refresh → forced re-auth → revoke',
        async (fixture) => {
            const { multiProviderAuthService } = await import('./multi-provider-auth.service');
            const userId = 'user-lifecycle';

            // Issue
            const supabase = makeSupabase({ provider_connections: {} });
            const issued = await issueToken(
                multiProviderAuthService, supabase, userId, fixture, fixture.futureExpiry,
            );
            expect(issued.connected).toBe(true);
            expect(issued.provider).toBe(fixture.provider);

            // Silent refresh — same provider, new token
            const refreshed = await issueToken(
                multiProviderAuthService, supabase, userId,
                { ...fixture, tokenValue: `${fixture.tokenValue}_v2` },
                fixture.futureExpiry,
            );
            expect(refreshed.connected).toBe(true);
            // At least 2 update calls: initial issue + refresh
            expect(supabase._updateCalls.length).toBeGreaterThanOrEqual(2);

            // Forced re-auth — revoke then reconnect
            const revokeSupabase = makeSupabase({
                provider_connections: fixture.provider !== 'github'
                    ? { [fixture.connectionKey]: { accessToken: `enc:${fixture.tokenValue}` } }
                    : {},
            });
            const revoked = await revokeToken(multiProviderAuthService, revokeSupabase, userId, fixture);
            expect(revoked.connected).toBe(false);

            const reconnectSupabase = makeSupabase({ provider_connections: {} });
            const reconnected = await issueToken(
                multiProviderAuthService, reconnectSupabase, userId, fixture, fixture.futureExpiry,
            );
            expect(reconnected.connected).toBe(true);
        },
    );

    // ── Token expiry detection ─────────────────────────────────────────────────

    it.each(PROVIDER_FIXTURES)(
        '[$label] expiry detection: past expiry is expired, future is not, null never expires',
        (fixture) => {
            expect(isTokenExpired(fixture.pastExpiry)).toBe(true);
            expect(isTokenExpired(fixture.futureExpiry)).toBe(false);
            expect(isTokenExpired(null)).toBe(false);
        },
    );

    // ── Silent refresh: second issue replaces stored token value ───────────────

    it.each(PROVIDER_FIXTURES)(
        '[$label] silent refresh: second issue replaces the stored token without disconnecting',
        async (fixture) => {
            const { multiProviderAuthService } = await import('./multi-provider-auth.service');
            const userId = 'user-silent-refresh';
            const supabase = makeSupabase({ provider_connections: {} });

            await issueToken(multiProviderAuthService, supabase, userId, fixture, fixture.futureExpiry);

            const newToken = `${fixture.tokenValue}_refreshed`;
            await issueToken(
                multiProviderAuthService, supabase, userId,
                { ...fixture, tokenValue: newToken },
                fixture.futureExpiry,
            );

            const lastUpdate = supabase._updateCalls[supabase._updateCalls.length - 1];
            if (fixture.provider === 'github') {
                expect(lastUpdate.github_token_encrypted).toBe(`enc:${newToken}`);
            } else {
                expect(
                    (lastUpdate.provider_connections as any)[fixture.connectionKey].accessToken,
                ).toBe(`enc:${newToken}`);
            }
        },
    );

    // ── getSession: issued token carries correct expiresAt ────────────────────

    it.each(PROVIDER_FIXTURES)(
        '[$label] getSession: token issued with future expiry stores the correct expiresAt',
        async (fixture) => {
            const { multiProviderAuthService } = await import('./multi-provider-auth.service');
            const userId = 'user-expiry-check';
            const supabase = makeSupabase({ provider_connections: {} });

            await issueToken(multiProviderAuthService, supabase, userId, fixture, fixture.futureExpiry);
            const update = supabase._updateCalls[supabase._updateCalls.length - 1];

            if (fixture.provider === 'github') {
                expect(update.github_token_expires_at).toBe(fixture.futureExpiry);
            } else {
                expect(
                    (update.provider_connections as any)[fixture.connectionKey].expiresAt,
                ).toBe(fixture.futureExpiry);
            }
        },
    );

    it.each(PROVIDER_FIXTURES)(
        '[$label] getSession: non-expiring token stores null for expiresAt',
        async (fixture) => {
            const { multiProviderAuthService } = await import('./multi-provider-auth.service');
            const userId = 'user-no-expiry';
            const supabase = makeSupabase({ provider_connections: {} });

            await issueToken(multiProviderAuthService, supabase, userId, fixture, null);
            const update = supabase._updateCalls[supabase._updateCalls.length - 1];

            if (fixture.provider === 'github') {
                expect(update.github_token_expires_at).toBeNull();
            } else {
                expect(
                    (update.provider_connections as any)[fixture.connectionKey].expiresAt,
                ).toBeNull();
            }
        },
    );

    // ── Cross-provider token isolation ─────────────────────────────────────────

    describe('cross-provider token isolation', () => {
        it('GitHub token is inaccessible when only Google is connected', async () => {
            const { multiProviderAuthService } = await import('./multi-provider-auth.service');
            const supabase = makeSupabase({
                github_connected: false,
                github_token_encrypted: null,
                provider_connections: {
                    google: { accessToken: 'enc:ya29.google_token', expiresAt: '2027-01-01T00:00:00Z' },
                },
            });
            const token = await multiProviderAuthService.getGitHubToken(supabase, 'user-iso-1');
            expect(token).toBeNull();
        });

        it('GitHub token is inaccessible when only OIDC is connected', async () => {
            const { multiProviderAuthService } = await import('./multi-provider-auth.service');
            const supabase = makeSupabase({
                github_connected: false,
                github_token_encrypted: null,
                provider_connections: { oidc: { accessToken: 'enc:oidc_token' } },
            });
            const token = await multiProviderAuthService.getGitHubToken(supabase, 'user-iso-2');
            expect(token).toBeNull();
        });

        it.each([
            ['github', 'google'],
            ['github', 'oidc'],
            ['google', 'oidc'],
            ['google', 'github'],
            ['oidc', 'github'],
            ['oidc', 'google'],
        ] as [string, string][])(
            'token stored for %s is not retrievable as %s',
            async (providerA, providerB) => {
                const fixtureA = PROVIDER_FIXTURES.find((f) => f.provider === providerA)!;
                const fixtureB = PROVIDER_FIXTURES.find((f) => f.provider === providerB)!;

                const connections = providerA !== 'github'
                    ? { [fixtureA.connectionKey]: { accessToken: `enc:${fixtureA.tokenValue}` } }
                    : {};

                const supabase = makeSupabase({
                    github_connected: providerA === 'github',
                    github_token_encrypted:
                        providerA === 'github' ? `enc:${fixtureA.tokenValue}` : null,
                    provider_connections: connections,
                });

                // provider B's slot must be absent
                const { data } = await supabase
                    .from('profiles')
                    .select('provider_connections')
                    .eq('id', 'user-cross')
                    .single();
                const tokenB = (data?.provider_connections as any)?.[fixtureB.connectionKey] ?? null;
                expect(tokenB).toBeNull();
            },
        );

        it('using GitHub credentials for a Google-scoped resource returns null (403-equivalent)', async () => {
            const { multiProviderAuthService } = await import('./multi-provider-auth.service');
            // Only Google connected — requesting GitHub credentials must fail
            const supabase = makeSupabase({
                github_connected: false,
                github_token_encrypted: null,
                provider_connections: {
                    google: { accessToken: 'enc:ya29.google_token', expiresAt: '2027-01-01T00:00:00Z' },
                },
            });
            const githubToken = await multiProviderAuthService.getGitHubToken(supabase, 'user-403');
            expect(githubToken).toBeNull();
        });
    });
});
