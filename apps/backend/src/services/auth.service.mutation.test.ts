import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';

/**
 * MUTATION TESTING TEST FILE FOR AUTHSERVICE
 * 
 * This file contains boundary condition tests specifically designed to catch
 * surviving mutants in critical security areas:
 * - Token expiry time calculations
 * - Null/undefined fallback chains
 * - Error code handling
 * - Boolean conditions
 * - Error message transformations
 * 
 * These tests validate exact behavior that standard line coverage may miss.
 */

// --- Supabase mock (same as auth.service.test.ts) ---
const mockSignUp = vi.fn();
const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockProfileInsert = vi.fn();
const mockProfileSelect = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: {
            signUp: mockSignUp,
            signInWithPassword: mockSignInWithPassword,
            signOut: mockSignOut,
            getUser: mockGetUser,
            updateUser: mockUpdateUser,
        },
        from: (_table: string) => ({
            insert: mockProfileInsert,
            select: (_cols: string) => ({
                eq: (_col: string, _val: string) => ({
                    single: mockProfileSelect,
                }),
            }),
        }),
    }),
}));

// --- Fixtures ---
const MOCK_USER = {
    id: 'user-123',
    email: 'test@example.com',
    created_at: '2024-01-01T00:00:00Z',
};

const MOCK_SESSION = {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_at: 1800000000,
};

describe('AuthService - Mutation Testing (Boundary Conditions)', () => {
    let service: AuthService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AuthService();
    });

    // ===== TOKEN EXPIRY TIME TESTS =====
    // These tests catch mutations in timestamp conversion (e.g., * 100, / 1000)
    describe('Token Expiry - Timestamp Accuracy', () => {
        it('converts Unix seconds to JavaScript milliseconds correctly (MUTATION: * multiplier)', async () => {
            const unixSeconds = 1700000000;
            mockSignInWithPassword.mockResolvedValue({
                data: {
                    user: MOCK_USER,
                    session: { ...MOCK_SESSION, expires_at: unixSeconds },
                },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Mutants caught: * 100, * 10000, / 1000, no multiplication
            expect(result.session?.expiresAt.getTime()).toBe(unixSeconds * 1000);
        });

        it('handles boundary Unix timestamp at epoch (MUTATION: boundary 0)', async () => {
            const epochSeconds = 0;
            mockSignInWithPassword.mockResolvedValue({
                data: {
                    user: MOCK_USER,
                    session: { ...MOCK_SESSION, expires_at: epochSeconds },
                },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches mutations that don't handle 0 correctly
            expect(result.session?.expiresAt.getTime()).toBe(0);
            expect(result.session?.expiresAt.getTime()).not.toBeGreaterThan(0);
        });

        it('handles future Unix timestamps (MUTATION: boundary large value)', async () => {
            const futureSeconds = 2000000000; // Year 2033
            mockSignInWithPassword.mockResolvedValue({
                data: {
                    user: MOCK_USER,
                    session: { ...MOCK_SESSION, expires_at: futureSeconds },
                },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.session?.expiresAt.getTime()).toBe(futureSeconds * 1000);
        });

        it('creates valid Date object from timestamp (MUTATION: wrong multiplier creates invalid date)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches mutations that produce NaN dates
            expect(result.session?.expiresAt).toBeInstanceOf(Date);
            expect(result.session?.expiresAt.getTime()).toBeGreaterThan(0);
            expect(isNaN(result.session?.expiresAt.getTime()!)).toBe(false);
        });

        it('includes session when expires_at is present (MUTATION: condition inversion)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: if (!data.session) → if (data.session)
            expect(result.session).not.toBeNull();
        });

        it('omits session when session is null (MUTATION: condition inversion)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: null },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches inverted condition
            expect(result.session).toBeNull();
        });
    });

    // ===== NULL/UNDEFINED FALLBACK TESTS =====
    // These tests catch mutations in || and ?? operators, default values
    describe('Subscription Tier Fallback - All Cases', () => {
        it('uses actual tier when profile has tier (MUTATION: remove value)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'pro', github_connected: false, github_username: null },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: profile?.subscription_tier is removed
            expect(result.user?.subscriptionTier).toBe('pro');
            expect(result.user?.subscriptionTier).not.toBe('free');
        });

        it('falls back to free when profile is null (MUTATION: remove fallback)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: || 'free' is removed
            expect(result.user?.subscriptionTier).toBe('free');
            expect(result.user?.subscriptionTier).not.toBeUndefined();
        });

        it('falls back to free when subscription_tier is undefined (MUTATION: || → ??)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: undefined, github_connected: false, github_username: null },
            });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.user?.subscriptionTier).toBe('free');
        });

        it('falls back to free when subscription_tier is null (MUTATION: || → ??)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: null, github_connected: false, github_username: null },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: Using ?? instead of ||
            expect(result.user?.subscriptionTier).toBe('free');
        });

        it('falls back to free when subscription_tier is empty string (MUTATION: || → ??)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: '', github_connected: false, github_username: null },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: Using ?? instead of || (empty string would pass through)
            expect(result.user?.subscriptionTier).toBe('free');
            expect(result.user?.subscriptionTier).not.toBe('');
        });

        it('falls back to free when subscription_tier is zero (MUTATION: || → ??)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 0, github_connected: false, github_username: null },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: Using ?? instead of ||
            expect(result.user?.subscriptionTier).toBe('free');
        });
    });

    // ===== GITHUB CONNECTED BOOLEAN TESTS =====
    describe('GitHub Connected - Boolean Handling', () => {
        it('preserves false when explicitly set (MUTATION: false → true, inverted condition)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: false, github_username: null },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: condition inversion or default change
            expect(result.user?.githubConnected).toBe(false);
            expect(result.user?.githubConnected).not.toBe(true);
        });

        it('preserves true when explicitly set (MUTATION: true → false, inverted condition)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: true, github_username: 'octocat' },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: inverted condition
            expect(result.user?.githubConnected).toBe(true);
            expect(result.user?.githubConnected).not.toBe(false);
        });

        it('defaults to false when profile is missing (MUTATION: default false → true)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: false being changed to true (security issue!)
            expect(result.user?.githubConnected).toBe(false);
        });

        it('defaults to false when github_connected is undefined (MUTATION: || → ??)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: undefined, github_username: null },
            });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.user?.githubConnected).toBe(false);
        });
    });

    // ===== GITHUB USERNAME NULLISH COALESCING TESTS =====
    // ?? catches null/undefined but not falsy, unlike ||
    describe('GitHub Username - Nullish Coalescing vs Logical OR', () => {
        it('uses actual username when provided (MUTATION: ?? → ||)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: true, github_username: 'octocat' },
            });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.user?.githubUsername).toBe('octocat');
        });

        it('uses null when github_username is null (MUTATION: ?? → ||)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: false, github_username: null },
            });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.user?.githubUsername).toBeNull();
        });

        it('uses null when github_username is undefined (MUTATION: ?? → ||)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: false, github_username: undefined },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: Using || instead of ??
            expect(result.user?.githubUsername).toBeNull();
        });

        it('preserves empty string for github_username (MUTATION: ?? → ||)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: false, github_username: '' },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // This is the KEY difference: ?? allows empty string, || doesn't
            expect(result.user?.githubUsername).toBe('');
            expect(result.user?.githubUsername).not.toBeNull();
        });

        it('preserves false for github_username if it were boolean (MUTATION: ?? → ||)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: false, github_username: false as any },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // With ??: false is preserved. With ||: converts to null
            expect(result.user?.githubUsername).toBe(false);
        });

        it('preserves zero for github_username if it were numeric (MUTATION: ?? → ||)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: 'free', github_connected: false, github_username: 0 as any },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // With ??: 0 is preserved. With ||: converts to null
            expect(result.user?.githubUsername).toBe(0);
        });
    });

    // ===== ERROR CODE HANDLING TESTS =====
    // These catch mutations in || fallbacks for error codes
    describe('Error Code Handling - Null Coalescing', () => {
        it('uses provided error code when present (MUTATION: remove first operand)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'email_already_exists', message: 'Email taken' },
            });

            const result = await service.signUp('test@example.com', 'pass');

            // Catches: error.code being removed
            expect(result.error?.code).toBe('email_already_exists');
        });

        it('falls back to SIGNUP_ERROR when code is missing (MUTATION: remove fallback)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { message: 'Unknown error' },
            });

            const result = await service.signUp('test@example.com', 'pass');

            // Catches: || 'SIGNUP_ERROR' being removed
            expect(result.error?.code).toBe('SIGNUP_ERROR');
            expect(result.error?.code).not.toBeUndefined();
        });

        it('falls back to SIGNUP_ERROR when code is null (MUTATION: || → ??)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: null, message: 'Unknown error' },
            });

            const result = await service.signUp('test@example.com', 'pass');

            expect(result.error?.code).toBe('SIGNUP_ERROR');
        });

        it('falls back to SIGNUP_ERROR when code is empty string (MUTATION: || → ??)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: '', message: 'Unknown error' },
            });

            const result = await service.signUp('test@example.com', 'pass');

            // Catches: Using ?? instead of || (empty string would pass through)
            expect(result.error?.code).toBe('SIGNUP_ERROR');
            expect(result.error?.code).not.toBe('');
        });

        it('falls back to SIGNUP_ERROR when code is 0 (MUTATION: || → ??)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 0, message: 'Unknown error' },
            });

            const result = await service.signUp('test@example.com', 'pass');

            // Catches: Using ?? instead of ||
            expect(result.error?.code).toBe('SIGNUP_ERROR');
        });
    });

    describe('Error Code - SignIn Variant (MUTATION: wrong fallback string)', () => {
        it('uses SIGNIN_ERROR as fallback for signIn', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { message: 'Auth failed' },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: Using 'SIGNUP_ERROR' or other wrong code
            expect(result.error?.code).toBe('SIGNIN_ERROR');
            expect(result.error?.code).not.toBe('SIGNUP_ERROR');
        });
    });

    // ===== ERROR MESSAGE TRANSFORMATION TESTS =====
    // These catch mutations in string.includes(), regex, and return values
    describe('Error Message Transformation - String Matching', () => {
        it('transforms invalid credentials error message (MUTATION: substring change)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
            });

            const result = await service.signIn('test@example.com', 'wrong');

            // Catches: substring being wrong or removed
            expect(result.error?.message).toBe('Invalid email or password. Please try again.');
            expect(result.error?.message).not.toBe('Invalid login credentials');
        });

        it('is case-sensitive for error matching (MUTATION: case-insensitive check)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'error', message: 'invalid login credentials' }, // lowercase
            });

            const result = await service.signIn('test@example.com', 'wrong');

            // Catches: if matching were case-insensitive
            expect(result.error?.message).toBe('invalid login credentials'); // Not transformed
            expect(result.error?.message).not.toBe('Invalid email or password. Please try again.');
        });

        it('transforms email not confirmed error (MUTATION: substring change)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'error', message: 'Email not confirmed' },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: substring being changed
            expect(result.error?.message).toContain('confirm your email');
        });

        it('transforms user already registered error (MUTATION: substring change)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'error', message: 'User already registered' },
            });

            const result = await service.signUp('taken@example.com', 'pass');

            // Catches: substring being changed
            expect(result.error?.message).toContain('account with this email already exists');
        });

        it('preserves unknown error messages unchanged (MUTATION: remove default return)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'error', message: 'Database connection timeout' },
            });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: if default return `message` is removed
            expect(result.error?.message).toBe('Database connection timeout');
        });
    });

    // ===== BOOLEAN CONDITION TESTS =====
    // These catch negation and truthiness mutations
    describe('Boolean Conditions - Negation and Truthiness', () => {
        it('handles null user on signup (MUTATION: !data.user → data.user)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: null,
            });

            const result = await service.signUp('test@example.com', 'pass');

            // Catches: if (data.user) instead of if (!data.user)
            expect(result.error?.code).toBe('NO_USER');
            expect(result.user).toBeNull();
        });

        it('handles non-null user on signup (MUTATION: !data.user → data.user)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileInsert.mockResolvedValue({ error: null });

            const result = await service.signUp('test@example.com', 'pass');

            // Catches: inverted condition
            expect(result.user).not.toBeNull();
            expect(result.error).toBeNull();
        });

        it('includes session when present (MUTATION: data.session → !data.session)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: if (!data.session) instead of if (data.session)
            expect(result.session).not.toBeNull();
            expect(result.session?.accessToken).toBe(MOCK_SESSION.access_token);
        });

        it('excludes session when absent (MUTATION: data.session → !data.session)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: null },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            // Catches: inverted condition
            expect(result.session).toBeNull();
        });

        it('returns NO_USER when user is null in signUp (MUTATION: !data.user → data.user)', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: null,
            });

            const result = await service.signUp('test@example.com', 'pass');

            expect(result.error?.code).toBe('NO_USER');
        });

        it('returns NO_USER when user is null in signIn (MUTATION: !data.user → data.user)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: null,
            });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.error?.code).toBe('NO_USER');
        });

        it('handles error truthy check (MUTATION: if (error) → if (!error))', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'signup_error', message: 'Failed' },
            });

            const result = await service.signUp('test@example.com', 'pass');

            // Catches: error condition being inverted
            expect(result.error).not.toBeNull();
            expect(result.user).toBeNull();
        });
    });

    // ===== EDGE CASES =====
    describe('Edge Cases', () => {
        it('handles very old timestamps (MUTATION: wrong calculation)', async () => {
            const y2kSeconds = 946684800; // Jan 1, 2000
            mockSignInWithPassword.mockResolvedValue({
                data: {
                    user: MOCK_USER,
                    session: { ...MOCK_SESSION, expires_at: y2kSeconds },
                },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.session?.expiresAt.getTime()).toBe(y2kSeconds * 1000);
        });

        it('handles negative Unix timestamps (MUTATION: sign change)', async () => {
            const beforeEpoch = -86400; // 1 day before Jan 1, 1970
            mockSignInWithPassword.mockResolvedValue({
                data: {
                    user: MOCK_USER,
                    session: { ...MOCK_SESSION, expires_at: beforeEpoch },
                },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.session?.expiresAt.getTime()).toBe(beforeEpoch * 1000);
        });

        it('handles profile with all falsy subscription data (MUTATION: || → ??)', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: MOCK_SESSION },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({
                data: { subscription_tier: '', github_connected: false, github_username: '' },
            });

            const result = await service.signIn('test@example.com', 'pass');

            expect(result.user?.subscriptionTier).toBe('free');
            expect(result.user?.githubConnected).toBe(false);
            expect(result.user?.githubUsername).toBe('');
        });
    });
});
