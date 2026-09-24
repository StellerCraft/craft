/**
 * Tests for GET /api/auth/user
 *
 * Covers:
 *   - authenticated request returns the current user with expected fields
 *   - unauthenticated request returns 401
 *   - user not found returns 404
 *   - response shape does not expose sensitive internal fields
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock Supabase (required by withAuth) ───────────────────────────────────

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(),
  }),
}));

// ── Mock authService ──────────────────────────────────────────────────────

const mockGetCurrentUser = vi.fn();
vi.mock('@/services/auth.service', () => ({
  authService: { getCurrentUser: mockGetCurrentUser },
}));

// ── Helpers ───────────────────────────────────────────────────────────────

const fakeUser = {
  id: 'user-authenticated-1',
  email: 'authenticated@example.com',
};

const fakeUserProfile = {
  id: 'user-authenticated-1',
  email: 'authenticated@example.com',
  displayName: 'Test User',
  subscriptionTier: 'free',
  createdAt: new Date('2024-01-15').toISOString(),
  githubConnected: false,
};

function makeRequest(url = 'http://localhost/api/auth/user'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('GET /api/auth/user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
  });

  it('returns 401 when unauthenticated (no session)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeRequest(), { params: {} });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 404 when authenticated but user profile not found', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('./route');
    const res = await GET(makeRequest(), { params: {} });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/user not found/i);
  });

  it('returns 200 with user profile on authenticated request', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUserProfile);
    const { GET } = await import('./route');
    const res = await GET(makeRequest(), { params: {} });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('user-authenticated-1');
    expect(body.email).toBe('authenticated@example.com');
    expect(body.displayName).toBe('Test User');
  });

  it('returns expected user fields without exposing sensitive internal data', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUserProfile);
    const { GET } = await import('./route');
    const res = await GET(makeRequest(), { params: {} });
    expect(res.status).toBe(200);
    const body = await res.json();
    const keys = Object.keys(body);

    // Should contain expected fields
    expect(keys).toContain('id');
    expect(keys).toContain('email');
    expect(keys).toContain('displayName');

    // Should not contain sensitive internal fields
    expect(JSON.stringify(body)).not.toContain('password');
    expect(JSON.stringify(body)).not.toContain('session_secret');
    expect(JSON.stringify(body)).not.toContain('encrypted_token');
  });

  it('returns consistent shape across multiple requests', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUserProfile);
    const { GET } = await import('./route');

    const res1 = await GET(makeRequest(), { params: {} });
    const body1 = await res1.json();

    const res2 = await GET(makeRequest(), { params: {} });
    const body2 = await res2.json();

    expect(Object.keys(body1).sort()).toEqual(Object.keys(body2).sort());
  });

  it('handles getCurrentUser throwing an error gracefully', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('Database connection failed'));
    const { GET } = await import('./route');
    const res = await GET(makeRequest(), { params: {} });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('includes subscription tier and GitHub connection status', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUserProfile);
    const { GET } = await import('./route');
    const res = await GET(makeRequest(), { params: {} });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscriptionTier).toBe('free');
    expect(body.githubConnected).toBe(false);
  });

  it('snapshots the authenticated user response shape', async () => {
    mockGetCurrentUser.mockResolvedValue(fakeUserProfile);
    const { GET } = await import('./route');
    const res = await GET(makeRequest(), { params: {} });
    const body = await res.json();

    // Define expected response shape
    expect(body).toMatchObject({
      id: expect.any(String),
      email: expect.any(String),
      displayName: expect.any(String),
      subscriptionTier: expect.any(String),
      createdAt: expect.any(String),
      githubConnected: expect.any(Boolean),
    });
  });
});
