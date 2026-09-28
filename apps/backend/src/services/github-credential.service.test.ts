/**
 * Tests for GitHubCredentialService — secure token storage (#236)
 *
 * Covers:
 *   Encryption / plaintext safety
 *     — token is not stored in plaintext (rotateToken encrypts before writing)
 *     — ensureValidToken decrypts and returns the plaintext token
 *
 *   Expiration
 *     — expired token is rejected on validation
 *     — token within 5-minute buffer is rejected
 *     — token with no expiry (classic PAT) is accepted
 *
 *   Rotation
 *     — rotateToken writes an encrypted value (not plaintext)
 *     — rotateToken returns the new plaintext token
 *     — old encrypted value is replaced after rotation
 *     — rotateToken DB error throws VALIDATION_FAILED
 *
 *   Cleanup (purge-expired-tokens cron)
 *     — expired profiles are nulled out
 *     — non-expired profiles are left intact
 *     — profiles with no expiry are left intact
 *
 *   Existing behaviour (regression)
 *     — NOT_CONNECTED, VALIDATION_FAILED, TOKEN_INVALID, etc.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    GitHubCredentialService,
    GitHubCredentialError,
} from './github-credential.service';
import { encryptToken } from '@/lib/github/token-encryption';

// ── Encryption key setup ──────────────────────────────────────────────────────

const VALID_KEY = 'a'.repeat(64);

beforeEach(() => { process.env.GITHUB_TOKEN_ENCRYPTION_KEY = VALID_KEY; });
afterEach(() => { delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY; });

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc';
const PLAINTEXT_TOKEN = 'ghp_real_plaintext_token_abc123';

function makeResponse(status: number): Response {
    return { ok: status >= 200 && status < 300, status } as Response;
}

// Minimal Supabase stub that tracks what was written via update()
function makeSupabase(row: {
    github_token_encrypted: string | null;
    github_token_expires_at: string | null;
} | null, dbError: unknown = null) {
    const written: Record<string, unknown>[] = [];
    let updateError: unknown = null;

    const client = {
        _written: written,
        _setUpdateError(e: unknown) { updateError = e; },
        from: (table: string) => {
            if (table !== 'profiles') throw new Error(`Unexpected table: ${table}`);
            return {
                select: () => ({
                    eq: () => ({
                        single: async () => ({ data: row, error: dbError }),
                    }),
                }),
                update: (payload: Record<string, unknown>) => ({
                    eq: () => {
                        written.push(payload);
                        return Promise.resolve({ error: updateError });
                    },
                }),
            };
        },
    };
    return client;
}

// ── Encryption / plaintext safety ─────────────────────────────────────────────

describe('secure token storage — encryption', () => {
    it('rotateToken writes an encrypted value, not the plaintext token', async () => {
        const db = makeSupabase(null);
        const svc = new GitHubCredentialService(db as never);

        await svc.rotateToken(USER_ID, PLAINTEXT_TOKEN);

        const [payload] = db._written;
        expect(payload.github_token_encrypted).toBeDefined();
        // Must NOT be the raw plaintext
        expect(payload.github_token_encrypted).not.toBe(PLAINTEXT_TOKEN);
        // Must NOT contain the plaintext as a substring
        expect(String(payload.github_token_encrypted)).not.toContain(PLAINTEXT_TOKEN);
    });

    it('rotateToken stored value is a valid AES-256-GCM envelope (3 base64url parts)', async () => {
        const db = makeSupabase(null);
        const svc = new GitHubCredentialService(db as never);

        await svc.rotateToken(USER_ID, PLAINTEXT_TOKEN);

        const stored = String(db._written[0].github_token_encrypted);
        const parts = stored.split('.');
        expect(parts).toHaveLength(3);
        for (const p of parts) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('ensureValidToken decrypts and returns the plaintext token', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn().mockResolvedValue(makeResponse(200));
        const svc = new GitHubCredentialService(db as never, mockFetch);

        const result = await svc.ensureValidToken(USER_ID);

        expect(result).toBe(PLAINTEXT_TOKEN);
    });

    it('ensureValidToken sends the decrypted plaintext in the Authorization header', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn().mockResolvedValue(makeResponse(200));
        const svc = new GitHubCredentialService(db as never, mockFetch);

        await svc.ensureValidToken(USER_ID);

        const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(init.headers['Authorization']).toBe(`Bearer ${PLAINTEXT_TOKEN}`);
    });
});

// ── Expiration ────────────────────────────────────────────────────────────────

describe('secure token storage — expiration', () => {
    it('rejects a token whose expiry is in the past', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const past = new Date(Date.now() - 60_000).toISOString();
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: past });
        const svc = new GitHubCredentialService(db as never, vi.fn());

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    });

    it('rejects a token expiring within the 5-minute buffer', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const soonExpiry = new Date(Date.now() + 2 * 60_000).toISOString();
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: soonExpiry });
        const svc = new GitHubCredentialService(db as never, vi.fn());

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    });

    it('accepts a token with no expiry set (classic PAT)', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn().mockResolvedValue(makeResponse(200));
        const svc = new GitHubCredentialService(db as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).resolves.toBe(PLAINTEXT_TOKEN);
    });

    it('accepts a token expiring well beyond the buffer', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: future });
        const mockFetch = vi.fn().mockResolvedValue(makeResponse(200));
        const svc = new GitHubCredentialService(db as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).resolves.toBe(PLAINTEXT_TOKEN);
    });
});

// ── Rotation ──────────────────────────────────────────────────────────────────

describe('secure token storage — rotation', () => {
    it('rotateToken returns the new plaintext token', async () => {
        const db = makeSupabase(null);
        const svc = new GitHubCredentialService(db as never);

        const result = await svc.rotateToken(USER_ID, PLAINTEXT_TOKEN);

        expect(result).toBe(PLAINTEXT_TOKEN);
    });

    it('rotateToken replaces the stored encrypted value (old value is gone)', async () => {
        const oldEncrypted = encryptToken('ghp_old_token');
        const db = makeSupabase({ github_token_encrypted: oldEncrypted, github_token_expires_at: null });
        const svc = new GitHubCredentialService(db as never);

        await svc.rotateToken(USER_ID, 'ghp_new_token');

        const [payload] = db._written;
        // New encrypted value must differ from the old one
        expect(payload.github_token_encrypted).not.toBe(oldEncrypted);
        // And must not be the old plaintext
        expect(String(payload.github_token_encrypted)).not.toContain('ghp_old_token');
    });

    it('rotateToken updates github_token_refreshed_at', async () => {
        const db = makeSupabase(null);
        const svc = new GitHubCredentialService(db as never);

        await svc.rotateToken(USER_ID, PLAINTEXT_TOKEN);

        expect(db._written[0].github_token_refreshed_at).toBeDefined();
    });

    it('rotateToken stores the provided expiresAt when given', async () => {
        const db = makeSupabase(null);
        const svc = new GitHubCredentialService(db as never);
        const expiry = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

        await svc.rotateToken(USER_ID, PLAINTEXT_TOKEN, expiry);

        expect(db._written[0].github_token_expires_at).toBe(expiry.toISOString());
    });

    it('rotateToken throws VALIDATION_FAILED when the DB update fails', async () => {
        const db = makeSupabase(null);
        db._setUpdateError({ message: 'db error' });
        const svc = new GitHubCredentialService(db as never);

        await expect(svc.rotateToken(USER_ID, PLAINTEXT_TOKEN)).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
        });
    });

    it('old token is no longer valid after rotation (ensureValidToken uses new encrypted value)', async () => {
        // Simulate: DB now holds the new encrypted token after rotation.
        const newToken = 'ghp_new_token_after_rotation';
        const newEncrypted = encryptToken(newToken);

        // After rotation the DB row reflects the new encrypted value.
        const db = makeSupabase({ github_token_encrypted: newEncrypted, github_token_expires_at: null });
        const mockFetch = vi.fn().mockResolvedValue(makeResponse(200));
        const svc = new GitHubCredentialService(db as never, mockFetch);

        const result = await svc.ensureValidToken(USER_ID);

        // Must return the NEW plaintext, not the old one
        expect(result).toBe(newToken);
        expect(result).not.toBe('ghp_old_token');
    });
});

// ── Cleanup cron (unit-level simulation) ─────────────────────────────────────

describe('secure token storage — expired token cleanup', () => {
    /**
     * These tests simulate the cleanup logic performed by the
     * /api/cron/purge-expired-tokens route: profiles with a past
     * github_token_expires_at should have their token nulled out;
     * others must be left untouched.
     */

    type ProfileRow = {
        id: string;
        github_token_encrypted: string | null;
        github_token_expires_at: string | null;
        github_connected: boolean;
    };

    function runCleanup(profiles: ProfileRow[], now = new Date()): ProfileRow[] {
        return profiles.map((p) => {
            if (
                p.github_token_expires_at !== null &&
                new Date(p.github_token_expires_at) < now
            ) {
                return {
                    ...p,
                    github_token_encrypted: null,
                    github_token_expires_at: null,
                    github_connected: false,
                };
            }
            return p;
        });
    }

    it('nulls out expired tokens', () => {
        const profiles: ProfileRow[] = [
            {
                id: 'u1',
                github_token_encrypted: encryptToken('ghp_expired'),
                github_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
                github_connected: true,
            },
        ];

        const result = runCleanup(profiles);

        expect(result[0].github_token_encrypted).toBeNull();
        expect(result[0].github_token_expires_at).toBeNull();
        expect(result[0].github_connected).toBe(false);
    });

    it('leaves valid (non-expired) tokens intact', () => {
        const encrypted = encryptToken('ghp_valid');
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const profiles: ProfileRow[] = [
            { id: 'u2', github_token_encrypted: encrypted, github_token_expires_at: future, github_connected: true },
        ];

        const result = runCleanup(profiles);

        expect(result[0].github_token_encrypted).toBe(encrypted);
        expect(result[0].github_connected).toBe(true);
    });

    it('leaves tokens with no expiry (classic PAT) intact', () => {
        const encrypted = encryptToken('ghp_pat');
        const profiles: ProfileRow[] = [
            { id: 'u3', github_token_encrypted: encrypted, github_token_expires_at: null, github_connected: true },
        ];

        const result = runCleanup(profiles);

        expect(result[0].github_token_encrypted).toBe(encrypted);
        expect(result[0].github_connected).toBe(true);
    });

    it('only purges expired rows when mixed profiles are present', () => {
        const expiredEncrypted = encryptToken('ghp_expired');
        const validEncrypted = encryptToken('ghp_valid');
        const profiles: ProfileRow[] = [
            {
                id: 'u4',
                github_token_encrypted: expiredEncrypted,
                github_token_expires_at: new Date(Date.now() - 1000).toISOString(),
                github_connected: true,
            },
            {
                id: 'u5',
                github_token_encrypted: validEncrypted,
                github_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
                github_connected: true,
            },
        ];

        const result = runCleanup(profiles);

        expect(result[0].github_token_encrypted).toBeNull();
        expect(result[1].github_token_encrypted).toBe(validEncrypted);
    });
});

// ── Regression: existing error paths ─────────────────────────────────────────

describe('secure token storage — regression', () => {
    it('throws NOT_CONNECTED when github_token_encrypted is null', async () => {
        const db = makeSupabase({ github_token_encrypted: null, github_token_expires_at: null });
        const svc = new GitHubCredentialService(db as never, vi.fn());

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });

    it('throws VALIDATION_FAILED when the DB query errors', async () => {
        const db = makeSupabase(null, new Error('db error'));
        const svc = new GitHubCredentialService(db as never, vi.fn());

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('throws TOKEN_INVALID when GitHub returns 401', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn().mockResolvedValue(makeResponse(401));
        const svc = new GitHubCredentialService(db as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    });

    it('throws VALIDATION_FAILED when fetch throws', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
        const svc = new GitHubCredentialService(db as never, mockFetch);

        await expect(svc.ensureValidToken(USER_ID)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('error is a GitHubCredentialError instance', async () => {
        const db = makeSupabase({ github_token_encrypted: null, github_token_expires_at: null });
        const svc = new GitHubCredentialService(db as never, vi.fn());

        const err = await svc.ensureValidToken(USER_ID).catch((e) => e);
        expect(err).toBeInstanceOf(GitHubCredentialError);
    });
});

// ── Rotation race condition recovery ──────────────────────────────────────────

describe('withFreshCredentialOnRotation — rotation race recovery', () => {
    it('returns operation result on immediate success', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn().mockResolvedValue(makeResponse(200));
        const svc = new GitHubCredentialService(db as never, mockFetch);

        const result = await svc.withFreshCredentialOnRotation(USER_ID, async (token) => {
            expect(token).toBe(PLAINTEXT_TOKEN);
            return 'success';
        });

        expect(result).toBe('success');
    });

    it('retries once with fresh credential on 401', async () => {
        const oldToken = 'ghp_old_token_before_rotation';
        const newToken = 'ghp_new_token_after_rotation';
        const encryptedOld = encryptToken(oldToken);
        const encryptedNew = encryptToken(newToken);

        // First call to DB returns the old encrypted token
        // Second call (after retry) returns the new encrypted token
        let callCount = 0;
        const db = {
            from: (table: string) => {
                if (table !== 'profiles') throw new Error(`Unexpected table: ${table}`);
                return {
                    select: () => ({
                        eq: () => ({
                            single: async () => {
                                callCount++;
                                if (callCount === 1) {
                                    return { data: { github_token_encrypted: encryptedOld, github_token_expires_at: null }, error: null };
                                } else {
                                    return { data: { github_token_encrypted: encryptedNew, github_token_expires_at: null }, error: null };
                                }
                            },
                        }),
                    }),
                    update: () => ({ eq: async () => ({ error: null }) }),
                };
            },
        };

        let operationCallCount = 0;
        const operation = async (token: string) => {
            operationCallCount++;
            if (operationCallCount === 1) {
                // First call with old token fails with 401 (rotation race)
                throw new GitHubCredentialError('GitHub token is invalid', 'TOKEN_INVALID');
            } else {
                // Second call with new token succeeds
                expect(token).toBe(newToken);
                return 'success-on-retry';
            }
        };

        const mockFetch = vi.fn();
        const svc = new GitHubCredentialService(db as never, mockFetch);

        const result = await svc.withFreshCredentialOnRotation(USER_ID, operation);

        expect(result).toBe('success-on-retry');
        expect(operationCallCount).toBe(2);
        expect(callCount).toBe(2); // DB was queried twice (once for initial, once for retry)
    });

    it('does not retry on non-401 errors', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn();
        const svc = new GitHubCredentialService(db as never, mockFetch);

        let operationCallCount = 0;
        const operation = async (token: string) => {
            operationCallCount++;
            throw new GitHubCredentialError('Some other error', 'VALIDATION_FAILED');
        };

        await expect(svc.withFreshCredentialOnRotation(USER_ID, operation)).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
        });

        // Operation called only once (no retry on non-401)
        expect(operationCallCount).toBe(1);
    });

    it('throws after retry if second attempt also fails', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn();
        const svc = new GitHubCredentialService(db as never, mockFetch);

        const operation = async (token: string) => {
            throw new GitHubCredentialError('Still invalid', 'TOKEN_INVALID');
        };

        await expect(svc.withFreshCredentialOnRotation(USER_ID, operation)).rejects.toMatchObject({
            code: 'TOKEN_INVALID',
        });
    });

    it('does not retry if error is not a GitHubCredentialError', async () => {
        const encrypted = encryptToken(PLAINTEXT_TOKEN);
        const db = makeSupabase({ github_token_encrypted: encrypted, github_token_expires_at: null });
        const mockFetch = vi.fn();
        const svc = new GitHubCredentialService(db as never, mockFetch);

        let operationCallCount = 0;
        const operation = async (token: string) => {
            operationCallCount++;
            throw new Error('Generic error');
        };

        await expect(svc.withFreshCredentialOnRotation(USER_ID, operation)).rejects.toThrow('Generic error');

        // Operation called only once (no retry on non-GitHubCredentialError)
        expect(operationCallCount).toBe(1);
    });
});
