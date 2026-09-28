import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// ── Supabase Mock ────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
    }),
}));

vi.mock('@/services/auth.service', () => ({
    authService: {
        getCurrentUser: vi.fn(),
    },
}));

// ── Import mocked service ────────────────────────────────────────────────────

import { authService } from '@/services/auth.service';

// ── Helpers & Fixtures ────────────────────────────────────────────────────────

const createGetRequest = (url = 'http://localhost/api/auth/user') =>
    new NextRequest(url, { method: 'GET' });

const mockAuthService = authService as any;

describe('GET /api/auth/user (Integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Authentication validation', () => {
        it('returns 401 when user is not authenticated', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null,
            });

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(401);
        });

        it('returns 401 when getUser encounters authentication error', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: new Error('Invalid session token'),
            });

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(401);
        });
    });

    describe('Successful authenticated user retrieval', () => {
        it('returns 200 with current user data for authenticated user', async () => {
            const userId = 'user-001';
            const mockUser = {
                id: userId,
                email: 'user@example.com',
                fullName: 'Alice Johnson',
                avatarUrl: 'https://example.com/avatar.jpg',
                createdAt: '2026-01-15T10:30:00.000Z',
                role: 'user',
            };

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId } },
                error: null,
            });

            mockAuthService.getCurrentUser.mockResolvedValue(mockUser);

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual(mockUser);
            expect(mockAuthService.getCurrentUser).toHaveBeenCalled();
        });

        it('returns correctly formatted user with all expected fields', async () => {
            const userId = 'user-002';
            const mockUser = {
                id: userId,
                email: 'developer@example.com',
                fullName: 'Bob Smith',
                avatarUrl: null,
                createdAt: '2025-12-01T08:00:00.000Z',
                role: 'admin',
                metadata: {
                    subscription_tier: 'pro',
                    github_username: 'bobsmith',
                },
            };

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId } },
                error: null,
            });

            mockAuthService.getCurrentUser.mockResolvedValue(mockUser);

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.id).toBe(userId);
            expect(body.email).toBe('developer@example.com');
            expect(body.role).toBe('admin');
        });
    });

    describe('User not found scenarios', () => {
        it('returns 404 when getCurrentUser returns null', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });

            mockAuthService.getCurrentUser.mockResolvedValue(null);

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body).toEqual({ error: 'User not found' });
        });

        it('returns 404 when profile lookup fails silently', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-nonexistent' } },
                error: null,
            });

            mockAuthService.getCurrentUser.mockResolvedValue(null);

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error).toBe('User not found');
        });
    });

    describe('Error handling', () => {
        beforeEach(() => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });
        });

        it('returns 500 when auth service throws database error', async () => {
            mockAuthService.getCurrentUser.mockRejectedValue(
                new Error('Database connection timeout')
            );

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toHaveProperty('error');
            expect(body.error).toContain('Database connection timeout');
        });

        it('returns 500 with generic message when error has no message property', async () => {
            mockAuthService.getCurrentUser.mockRejectedValue({});

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toEqual({ error: 'Failed to fetch user' });
        });

        it('surfaces custom error messages from auth service', async () => {
            const customError = new Error('User record corrupted: missing required fields');
            mockAuthService.getCurrentUser.mockRejectedValue(customError);

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body.error).toContain('corrupted');
        });
    });

    describe('Request handling', () => {
        it('ignores request body if present', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });

            const mockUser = {
                id: 'user-123',
                email: 'user@example.com',
            };

            mockAuthService.getCurrentUser.mockResolvedValue(mockUser);

            const req = new NextRequest('http://localhost/api/auth/user', {
                method: 'GET',
                body: JSON.stringify({ someField: 'should-be-ignored' }),
            });

            const res = await GET(req);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual(mockUser);
        });

        it('works with various URL formats', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });

            const mockUser = { id: 'user-123', email: 'user@example.com' };
            mockAuthService.getCurrentUser.mockResolvedValue(mockUser);

            const urls = [
                'http://localhost/api/auth/user',
                'http://example.com/api/auth/user',
                'https://api.example.com/api/auth/user',
            ];

            for (const url of urls) {
                mockAuthService.getCurrentUser.mockClear();
                const req = createGetRequest(url);
                const res = await GET(req);
                expect(res.status).toBe(200);
            }
        });
    });
});
