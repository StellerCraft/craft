import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { AuthService } from './auth.service';

// --- Supabase mock ---
const mockSignUp = vi.fn();
const mockProfileInsert = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { signUp: mockSignUp },
        from: (_table: string) => ({ insert: mockProfileInsert }),
    }),
}));

// --- Arbitraries ---

/** Valid email: localpart@domain.tld — no special chars that Supabase rejects */
const validEmail = fc
    .tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{3,10}$/),
        fc.stringMatching(/^[a-z]{3,8}$/),
        fc.constantFrom('com', 'org', 'net', 'io')
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Valid password: 8–32 printable ASCII chars */
const validPassword = fc.string({ minLength: 8, maxLength: 32, unit: 'binary' }).filter(
    (s) => /^[\x21-\x7e]+$/.test(s) // printable, non-space ASCII
);

/** Valid profile payload combinations */
const validProfile = fc.record({
    email: validEmail,
    password: validPassword,
});

// --- Property 1: signUp accepts any valid (email, password) pair ---
describe('Property 1 — signUp accepts valid generated credentials', () => {
    beforeEach(() => vi.clearAllMocks());

    it('always returns a user with matching email and free tier for 100 valid inputs', async () => {
        await fc.assert(
            fc.asyncProperty(validProfile, async ({ email, password }) => {
                const userId = `user-${Math.random().toString(36).slice(2)}`;

                mockSignUp.mockResolvedValue({
                    data: {
                        user: { id: userId, email, created_at: new Date().toISOString() },
                        session: {
                            access_token: 'tok',
                            refresh_token: 'rtok',
                            expires_at: Math.floor(Date.now() / 1000) + 3600,
                        },
                    },
                    error: null,
                });
                mockProfileInsert.mockResolvedValue({ error: null });

                const service = new AuthService();
                const result = await service.signUp(email, password);

                // Invariants
                expect(result.error).toBeNull();
                expect(result.user).not.toBeNull();
                expect(result.user!.email).toBe(email);
                expect(result.user!.id).toBe(userId);
                expect(result.user!.subscriptionTier).toBe('free');   // new accounts always start free
                expect(result.user!.githubConnected).toBe(false);      // github not connected on creation
                expect(result.session).not.toBeNull();
                expect(result.session!.accessToken).toBe('tok');
            }),
            { numRuns: 100 }
        );
    });

    it('always returns error (never a user) when the provider rejects any input', async () => {
        await fc.assert(
            fc.asyncProperty(validProfile, async ({ email, password }) => {
                mockSignUp.mockResolvedValue({
                    data: { user: null, session: null },
                    error: { code: 'provider_error', message: 'Rejected by provider' },
                });

                const service = new AuthService();
                const result = await service.signUp(email, password);

                expect(result.user).toBeNull();
                expect(result.session).toBeNull();
                expect(result.error).not.toBeNull();
                expect(result.error!.code).toBe('provider_error');
            }),
            { numRuns: 100 }
        );
    });

    it('always returns PROFILE_CREATION_ERROR when profile insert fails for any valid input', async () => {
        await fc.assert(
            fc.asyncProperty(validProfile, async ({ email, password }) => {
                mockSignUp.mockResolvedValue({
                    data: {
                        user: { id: 'uid', email, created_at: new Date().toISOString() },
                        session: null,
                    },
                    error: null,
                });
                mockProfileInsert.mockResolvedValue({ error: { message: 'db error' } });

                const service = new AuthService();
                const result = await service.signUp(email, password);

                expect(result.user).toBeNull();
                expect(result.error!.code).toBe('PROFILE_CREATION_ERROR');
            }),
            { numRuns: 100 }
        );
    });
});
