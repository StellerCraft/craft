/**
 * Tests for POST /api/auth/signup
 *
 * Covers:
 *   - duplicate-email sign-up → 409 with error
 *   - validation-style sign-up failure (not duplicate) → 400
 *   - successful sign-up → 201 with user + session
 *   - invalid input (short password) → 400
 *   - invalid input (malformed email) → 400
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock authService ──────────────────────────────────────────────────────

const mockSignUp = vi.fn();
vi.mock('@/services/auth.service', () => ({
  authService: { signUp: mockSignUp },
}));

// ── Mock rate limiter ─────────────────────────────────────────────────────

const mockCheckRateLimit = vi.fn();
vi.mock('@/lib/api/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getRateLimitKey: (req: NextRequest, key: string) => `${key}:127.0.0.1`,
  AUTH_RATE_LIMIT: { limit: 10, windowMs: 900000 },
}));

vi.stubEnv('RATE_LIMIT_DISABLED', 'false');

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockRateLimitPassed() {
  mockCheckRateLimit.mockReturnValue({
    allowed: true,
    remaining: 9,
    resetAt: Date.now() + 900000,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitPassed();
  });

  it('returns 409 for duplicate-email sign-up with PROFILE_CREATION_ERROR', async () => {
    mockSignUp.mockResolvedValue({
      error: { code: 'PROFILE_CREATION_ERROR', message: 'Email already registered' },
      user: null,
      session: null,
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'existing@example.com', password: 'password123' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/email already registered/i);
  });

  it('returns 400 for validation-style sign-up failure (non-PROFILE_CREATION_ERROR)', async () => {
    mockSignUp.mockResolvedValue({
      error: { code: 'INVALID_PASSWORD', message: 'Password does not meet requirements' },
      user: null,
      session: null,
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'new@example.com', password: 'weakpass' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 201 with user and session on successful sign-up', async () => {
    const mockUser = { id: 'user-new', email: 'new@example.com' };
    const mockSession = { id: 'session-new', userId: 'user-new' };
    mockSignUp.mockResolvedValue({
      error: null,
      user: mockUser,
      session: mockSession,
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'new@example.com', password: 'password123' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toEqual(mockUser);
    expect(body.session).toEqual(mockSession);
  });

  it('returns 400 for password shorter than 8 characters', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'new@example.com', password: 'short' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
    expect(body.details?.password).toBeDefined();
  });

  it('returns 400 for missing password field', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'new@example.com' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
  });

  it('returns 400 for malformed email', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'not-an-email', password: 'password123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
  });

  it('returns 400 for missing email field', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ password: 'password123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
  });

  it('distinguishes 409 (duplicate) from 400 (validation error)', async () => {
    // Test that different error codes map to different status codes
    mockSignUp.mockResolvedValueOnce({
      error: { code: 'PROFILE_CREATION_ERROR', message: 'Email already registered' },
      user: null,
      session: null,
    });
    const { POST } = await import('./route');
    const res409 = await POST(makeRequest({ email: 'dup@example.com', password: 'password123' }));

    vi.clearAllMocks();
    mockRateLimitPassed();
    mockSignUp.mockResolvedValueOnce({
      error: { code: 'WEAK_PASSWORD', message: 'Password too weak' },
      user: null,
      session: null,
    });
    const res400 = await POST(makeRequest({ email: 'new@example.com', password: 'weak' }));

    expect(res409.status).toBe(409);
    expect(res400.status).toBe(400);
  });

  it('calls authService.signUp with parsed email and password', async () => {
    mockSignUp.mockResolvedValue({
      error: null,
      user: { id: 'user-1', email: 'test@example.com' },
      session: { id: 'session-1' },
    });
    const { POST } = await import('./route');
    await POST(makeRequest({ email: 'test@example.com', password: 'password123' }));
    expect(mockSignUp).toHaveBeenCalledWith('test@example.com', 'password123');
  });
});
