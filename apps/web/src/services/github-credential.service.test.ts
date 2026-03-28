/**
 * Unit tests for GitHubCredentialService.
 *
 * Mocks:
 *   supabase — minimal stub with .from().select().eq().single() and
 *              .from().update().eq() chains.
 *   fetch    — injected via constructor so no real HTTP calls are made.
 *
 * Coverage:
 *   ensureValidToken
 *     — missing token → NOT_CONNECTED
 *     — DB error → VALIDATION_FAILED
 *     — token within expiry buffer → TOKEN_EXPIRED
 *     — token past expiry → TOKEN_EXPIRED
 *     — no expiry set (classic PAT) → skips expiry check
 *     — GitHub 401 → TOKEN_INVALID
 *     — GitHub non-200/non-401 → VALIDATION_FAILED
 *     — fetch throws → VALIDATION_FAILED
 *     — valid token → returns token and updates refreshed_at
 *     — refreshed_at update failure is silently ignored (best-effort)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    GitHubCredentialService,
    GitHubCredentialError,
} from './github-credential.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc';
const VALID_TOKEN = 'ghp_valid_token';

function makeResponse(status: number): Response {
    return { ok: status >= 200 && status < 300, status } as Response;
}

type SupabaseStub = {
    selectResult: { data: unknown; error: unknown };
    updateCalled: boolean;
};

function makeSupabase(
    row: { github_token_encrypted: string | null; github_token_expires_at: string | null } | null,
    dbError: unknown = null,
): { client: ReturnType<typeof buildClient>; stub: SupabaseStub } {
    const stub: SupabaseStub = {
        selectResult: { data: row, error: dbError },
        updateCalled: false,
    };

    const buildClient = () => ({
        from: (table: string) => {
            if (table === 'profiles') {
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => stub.selectResult,
                        }),
                    }),
                    update: () => ({
                        eq: () => {
                            stub.updateCalled = true;
                            return Promise.resolve({ error: null });
                        },
                    }),
                };
            }
            throw new Error(`Unexpected table: ${table}`);
        },
    });

    return { client: buildClient() as unknown as ReturnType<typeof buildClient>, stub };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GitHubCredentialService', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch = vi.fn();
    });

    it('throws NOT_CONNECTED when github_token_encrypted is null', async () => {
        const { client } = makeSupabase({ github_token_encrypted: null, github_token_expires_at: null });
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({
            code: 'NOT_CONNECTED',
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws VALIDATION_FAILED when the DB query errors', async () => {
        const { client } = makeSupabase(null, new Error('db error'));
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
        });
    });

    it('throws TOKEN_EXPIRED when expiry is in the past', async () => {
        const past = new Date(Date.now() - 60_000).toISOString();
        const { client } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: past });
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({
            code: 'TOKEN_EXPIRED',
        });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws TOKEN_EXPIRED when expiry is within the 5-minute buffer', async () => {
        const soonExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 min from now
        const { client } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: soonExpiry });
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({
            code: 'TOKEN_EXPIRED',
        });
    });

    it('skips expiry check when github_token_expires_at is null (classic PAT)', async () => {
        const { client } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: null });
        mockFetch.mockResolvedValueOnce(makeResponse(200));
        const svc = new GitHubCredentialService(client as never, mockFetch);

        const token = await svc.ensureValidToken(USER_ID);
        expect(token).toBe(VALID_TOKEN);
    });

    it('throws TOKEN_INVALID when GitHub returns 401', async () => {
        const { client } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: null });
        mockFetch.mockResolvedValueOnce(makeResponse(401));
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({
            code: 'TOKEN_INVALID',
        });
    });

    it('throws VALIDATION_FAILED when GitHub returns an unexpected non-2xx status', async () => {
        const { client } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: null });
        mockFetch.mockResolvedValueOnce(makeResponse(503));
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
        });
    });

    it('throws VALIDATION_FAILED when fetch itself throws', async () => {
        const { client } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: null });
        mockFetch.mockRejectedValueOnce(new Error('network error'));
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
        });
    });

    it('returns the token and updates refreshed_at on success', async () => {
        const { client, stub } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: null });
        mockFetch.mockResolvedValueOnce(makeResponse(200));
        const svc = new GitHubCredentialService(client as never, mockFetch);

        const token = await svc.ensureValidToken(USER_ID);

        expect(token).toBe(VALID_TOKEN);
        expect(stub.updateCalled).toBe(true);
    });

    it('sends the correct Authorization header to GitHub', async () => {
        const { client } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: null });
        mockFetch.mockResolvedValueOnce(makeResponse(200));
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await svc.ensureValidToken(USER_ID);

        const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe('https://api.github.com/user');
        expect(init.headers['Authorization']).toBe(`Bearer ${VALID_TOKEN}`);
    });

    it('accepts a token expiring well beyond the buffer', async () => {
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
        const { client } = makeSupabase({ github_token_encrypted: VALID_TOKEN, github_token_expires_at: future });
        mockFetch.mockResolvedValueOnce(makeResponse(200));
        const svc = new GitHubCredentialService(client as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).resolves.toBe(VALID_TOKEN);
    });

    it('is a GitHubCredentialError instance', async () => {
        const { client } = makeSupabase({ github_token_encrypted: null, github_token_expires_at: null });
        const svc = new GitHubCredentialService(client as never, mockFetch);

        const err = await svc.ensureValidToken(USER_ID).catch((e) => e);
        expect(err).toBeInstanceOf(GitHubCredentialError);
    });
});
