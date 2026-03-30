import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';

// --- Supabase mock ---
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

const FREE_PROFILE = { subscription_tier: 'free', github_connected: false, github_username: null };

describe('AuthService', () => {
    let service: AuthService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AuthService();
    });

    // ------------------------------------------------------------------ signUp
    describe('signUp', () => {
        it('returns user and session on success', async () => {
            mockSignUp.mockResolvedValue({ data: { user: MOCK_USER, session: MOCK_SESSION }, error: null });
            mockProfileInsert.mockResolvedValue({ error: null });

            const result = await service.signUp('test@example.com', 'password123');

            expect(result.error).toBeNull();
            expect(result.user).toMatchObject({ id: 'user-123', email: 'test@example.com', subscriptionTier: 'free' });
            expect(result.session?.accessToken).toBe('access-token');
            expect(result.session?.refreshToken).toBe('refresh-token');
        });

        it('returns null session when Supabase returns no session', async () => {
            mockSignUp.mockResolvedValue({ data: { user: MOCK_USER, session: null }, error: null });
            mockProfileInsert.mockResolvedValue({ error: null });

            const result = await service.signUp('test@example.com', 'password123');

            expect(result.session).toBeNull();
            expect(result.user).not.toBeNull();
        });

        it('returns provider error when auth.signUp fails', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'email_taken', message: 'User already registered' },
            });

            const result = await service.signUp('taken@example.com', 'password123');

            expect(result.user).toBeNull();
            expect(result.session).toBeNull();
            expect(result.error?.code).toBe('email_taken');
        });

        it('returns SIGNUP_ERROR code when provider error has no code', async () => {
            mockSignUp.mockResolvedValue({
                data: { user: null, session: null },
                error: { message: 'Something went wrong' },
            });

            const result = await service.signUp('test@example.com', 'password123');

            expect(result.error?.code).toBe('SIGNUP_ERROR');
        });

        it('returns NO_USER when user is null with no error', async () => {
            mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: null });

            const result = await service.signUp('test@example.com', 'password123');

            expect(result.error?.code).toBe('NO_USER');
        });

        it('returns PROFILE_CREATION_ERROR when profile insert fails', async () => {
            mockSignUp.mockResolvedValue({ data: { user: MOCK_USER, session: MOCK_SESSION }, error: null });
            mockProfileInsert.mockResolvedValue({ error: { message: 'duplicate key value' } });

            const result = await service.signUp('test@example.com', 'password123');

            expect(result.error?.code).toBe('PROFILE_CREATION_ERROR');
            expect(result.user).toBeNull();
        });
    });

    // ------------------------------------------------------------------ signIn
    describe('signIn', () => {
        it('returns user and session with profile data on success', async () => {
            mockSignInWithPassword.mockResolvedValue({ data: { user: MOCK_USER, session: MOCK_SESSION }, error: null });
            mockProfileSelect.mockResolvedValue({ data: { subscription_tier: 'pro', github_connected: true, github_username: 'octocat' } });

            const result = await service.signIn('test@example.com', 'password123');

            expect(result.error).toBeNull();
            expect(result.user?.subscriptionTier).toBe('pro');
            expect(result.user?.githubConnected).toBe(true);
            expect(result.user?.githubUsername).toBe('octocat');
            expect(result.session?.accessToken).toBe('access-token');
        });

        it('falls back to free tier when profile row is missing', async () => {
            mockSignInWithPassword.mockResolvedValue({ data: { user: MOCK_USER, session: MOCK_SESSION }, error: null });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'password123');

            expect(result.user?.subscriptionTier).toBe('free');
            expect(result.user?.githubConnected).toBe(false);
        });

        it('returns readable error for invalid credentials', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
            });

            const result = await service.signIn('test@example.com', 'wrong-password');

            expect(result.user).toBeNull();
            expect(result.error?.message).toBe('Invalid email or password. Please try again.');
        });

        it('returns readable error for unconfirmed email', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
            });

            const result = await service.signIn('test@example.com', 'password123');

            expect(result.error?.message).toContain('confirm your email');
        });

        it('returns NO_USER when user is null with no error', async () => {
            mockSignInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null });

            const result = await service.signIn('test@example.com', 'password123');

            expect(result.error?.code).toBe('NO_USER');
        });

        it('preserves unknown error messages verbatim', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { code: 'unknown', message: 'Some unexpected error' },
            });

            const result = await service.signIn('test@example.com', 'password123');

            expect(result.error?.message).toBe('Some unexpected error');
        });

        it('uses SIGNIN_ERROR code when provider error has no code', async () => {
            mockSignInWithPassword.mockResolvedValue({
                data: { user: null, session: null },
                error: { message: 'Invalid login credentials' },
            });

            const result = await service.signIn('test@example.com', 'wrong');

            expect(result.error?.code).toBe('SIGNIN_ERROR');
        });

        it('returns correct session expiry from provider', async () => {
            const expiresAt = 1800000000;
            mockSignInWithPassword.mockResolvedValue({
                data: { user: MOCK_USER, session: { ...MOCK_SESSION, expires_at: expiresAt } },
                error: null,
            });
            mockProfileSelect.mockResolvedValue({ data: null });

            const result = await service.signIn('test@example.com', 'password123');

            expect(result.session?.expiresAt).toEqual(new Date(expiresAt * 1000));
        });
    });

    // ----------------------------------------------------------------- signOut
    describe('signOut', () => {
        it('delegates to supabase.auth.signOut', async () => {
            mockSignOut.mockResolvedValue({});

            await service.signOut();

            expect(mockSignOut).toHaveBeenCalledOnce();
        });

        it('resolves without error on successful sign-out', async () => {
            mockSignOut.mockResolvedValue({});

            await expect(service.signOut()).resolves.toBeUndefined();
        });
    });

    // ---------------------------------------------------------- getCurrentUser
    describe('getCurrentUser', () => {
        it('returns user with profile data when authenticated', async () => {
            mockGetUser.mockResolvedValue({ data: { user: MOCK_USER } });
            mockProfileSelect.mockResolvedValue({ data: { subscription_tier: 'pro', github_connected: true, github_username: 'octocat' } });

            const user = await service.getCurrentUser();

            expect(user?.id).toBe('user-123');
            expect(user?.email).toBe('test@example.com');
            expect(user?.subscriptionTier).toBe('pro');
            expect(user?.githubConnected).toBe(true);
            expect(user?.githubUsername).toBe('octocat');
        });

        it('returns null when no session exists', async () => {
            mockGetUser.mockResolvedValue({ data: { user: null } });

            const user = await service.getCurrentUser();

            expect(user).toBeNull();
        });

        it('falls back to free tier when profile row is missing', async () => {
            mockGetUser.mockResolvedValue({ data: { user: MOCK_USER } });
            mockProfileSelect.mockResolvedValue({ data: null });

            const user = await service.getCurrentUser();

            expect(user?.subscriptionTier).toBe('free');
            expect(user?.githubConnected).toBe(false);
        });
    });

    // --------------------------------------------------------------- updateProfile
    describe('updateProfile', () => {
        it('updates email and returns updated user', async () => {
            mockUpdateUser.mockResolvedValue({ error: null });
            mockGetUser.mockResolvedValue({ data: { user: { ...MOCK_USER, email: 'new@example.com' } } });
            mockProfileSelect.mockResolvedValue({ data: FREE_PROFILE });

            const user = await service.updateProfile('user-123', { email: 'new@example.com' });

            expect(mockUpdateUser).toHaveBeenCalledWith({ email: 'new@example.com' });
            expect(user.email).toBe('new@example.com');
        });

        it('skips auth.updateUser when no email is provided', async () => {
            mockGetUser.mockResolvedValue({ data: { user: MOCK_USER } });
            mockProfileSelect.mockResolvedValue({ data: FREE_PROFILE });

            const user = await service.updateProfile('user-123', { fullName: 'New Name' });

            expect(mockUpdateUser).not.toHaveBeenCalled();
            expect(user.email).toBe('test@example.com');
        });

        it('throws when email update fails', async () => {
            mockUpdateUser.mockResolvedValue({ error: { message: 'Email already in use' } });

            await expect(service.updateProfile('user-123', { email: 'taken@example.com' })).rejects.toThrow(
                'Failed to update email: Email already in use'
            );
        });

        it('throws when getUser returns null after update', async () => {
            mockUpdateUser.mockResolvedValue({ error: null });
            mockGetUser.mockResolvedValue({ data: { user: null } });

            await expect(service.updateProfile('user-123', { email: 'new@example.com' })).rejects.toThrow(
                'User not found'
            );
        });

        it('throws when getUser returns null with no email update', async () => {
            mockGetUser.mockResolvedValue({ data: { user: null } });

            await expect(service.updateProfile('user-123', {})).rejects.toThrow('User not found');
        });
    });
});
