import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from './route';

// ── Supabase Mock ────────────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockAuditLog = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
    }),
}));

vi.mock('@/services/auth.service', () => ({
    authService: {
        getCurrentUser: vi.fn(),
        updateProfile: vi.fn(),
    },
}));

vi.mock('@/lib/api/logger', () => ({
    resolveIpAddress: () => '192.168.1.1',
}));

// ── Import mocked services ────────────────────────────────────────────────────

import { authService } from '@/services/auth.service';

// ── Helpers & Fixtures ────────────────────────────────────────────────────────

const createGetRequest = (url = 'http://localhost/api/auth/profile') =>
    new NextRequest(url, { method: 'GET' });

const createPatchRequest = (body: any, url = 'http://localhost/api/auth/profile') =>
    new NextRequest(url, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    });

const mockAuthService = authService as any;

describe('GET /api/auth/profile (Integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Authentication', () => {
        it('returns 401 when user is unauthenticated', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null,
            });

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(401);
        });

        it('returns 401 when auth error occurs', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: new Error('Auth failed'),
            });

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(401);
        });
    });

    describe('Authenticated user profile retrieval', () => {
        it('returns 200 with current user profile when authenticated', async () => {
            const userId = 'user-123';
            const mockProfile = {
                id: userId,
                email: 'user@example.com',
                fullName: 'John Doe',
                avatarUrl: 'https://example.com/avatar.jpg',
            };

            mockGetUser.mockResolvedValue({
                data: { user: { id: userId } },
                error: null,
            });

            mockAuthService.getCurrentUser.mockResolvedValue(mockProfile);

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual(mockProfile);
        });

        it('returns 404 when profile not found', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });

            mockAuthService.getCurrentUser.mockResolvedValue(null);

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body).toEqual({ error: 'Profile not found' });
        });

        it('returns 500 when service throws error', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });

            mockAuthService.getCurrentUser.mockRejectedValue(
                new Error('Database connection failed')
            );

            const req = createGetRequest();
            const res = await GET(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toHaveProperty('error');
        });
    });
});

describe('PATCH /api/auth/profile (Integration)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Authentication', () => {
        it('returns 401 when user is unauthenticated', async () => {
            mockGetUser.mockResolvedValue({
                data: { user: null },
                error: null,
            });

            const req = createPatchRequest({ fullName: 'Jane Doe' });
            const res = await PATCH(req);

            expect(res.status).toBe(401);
        });
    });

    describe('Input validation', () => {
        beforeEach(() => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });
        });

        it('returns 400 with validation error for invalid email', async () => {
            const req = createPatchRequest({ email: 'not-an-email' });
            const res = await PATCH(req);

            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body).toHaveProperty('error', 'Invalid input');
            expect(body).toHaveProperty('details');
        });

        it('returns 400 with validation error for empty string fullName', async () => {
            const req = createPatchRequest({ fullName: '' });
            const res = await PATCH(req);

            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body).toHaveProperty('error', 'Invalid input');
        });

        it('returns 400 with validation error for invalid avatar URL', async () => {
            const req = createPatchRequest({ avatarUrl: 'not-a-url' });
            const res = await PATCH(req);

            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body).toHaveProperty('error', 'Invalid input');
        });

        it('returns 400 when no fields provided for update', async () => {
            const req = createPatchRequest({});
            const res = await PATCH(req);

            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body).toEqual({ error: 'No fields to update' });
        });

        it('returns 400 for unknown fields (strict mode)', async () => {
            const req = createPatchRequest({
                fullName: 'Jane',
                unknownField: 'should fail',
            });
            const res = await PATCH(req);

            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body).toHaveProperty('error');
        });
    });

    describe('Successful profile updates', () => {
        beforeEach(() => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });
        });

        it('updates fullName and returns updated profile', async () => {
            const updatedProfile = {
                id: 'user-123',
                fullName: 'Jane Doe',
                email: 'user@example.com',
                avatarUrl: null,
            };

            mockAuthService.updateProfile.mockResolvedValue(updatedProfile);

            const req = createPatchRequest({ fullName: 'Jane Doe' });
            const res = await PATCH(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual(updatedProfile);
            expect(mockAuthService.updateProfile).toHaveBeenCalledWith('user-123', {
                fullName: 'Jane Doe',
            });
        });

        it('updates email and returns updated profile', async () => {
            const updatedProfile = {
                id: 'user-123',
                fullName: 'John Doe',
                email: 'newemail@example.com',
                avatarUrl: null,
            };

            mockAuthService.updateProfile.mockResolvedValue(updatedProfile);

            const req = createPatchRequest({ email: 'newemail@example.com' });
            const res = await PATCH(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual(updatedProfile);
        });

        it('updates multiple fields simultaneously', async () => {
            const updatedProfile = {
                id: 'user-123',
                fullName: 'Jane Smith',
                email: 'jane@example.com',
                avatarUrl: 'https://example.com/new-avatar.jpg',
            };

            mockAuthService.updateProfile.mockResolvedValue(updatedProfile);

            const req = createPatchRequest({
                fullName: 'Jane Smith',
                email: 'jane@example.com',
                avatarUrl: 'https://example.com/new-avatar.jpg',
            });
            const res = await PATCH(req);

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toEqual(updatedProfile);
        });
    });

    describe('Error handling', () => {
        beforeEach(() => {
            mockGetUser.mockResolvedValue({
                data: { user: { id: 'user-123' } },
                error: null,
            });
        });

        it('returns 500 when service throws error', async () => {
            mockAuthService.updateProfile.mockRejectedValue(
                new Error('Database connection failed')
            );

            const req = createPatchRequest({ fullName: 'Jane Doe' });
            const res = await PATCH(req);

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toHaveProperty('error');
        });
    });
});
