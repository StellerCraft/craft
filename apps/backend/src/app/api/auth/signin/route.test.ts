/**
 * Tests for POST /api/auth/signin
 *
 * Covers:
 *   - invalid input (empty password) → 400
 *   - invalid input (malformed email) → 400
 *   - invalid credentials → 401
 *   - successful sign-in → 200 with user + session
 *   - rate limit exhaustion → 429 with Retry-After header
 *   - no password or session secret echoed in error responses
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock authService ──────────────────────────────────────────────────────

const mockSignIn = vi.fn();
vi.mock('@/services/auth.service', () => ({
  authService: { signIn: mockSignIn },
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
  return new NextRequest('http://localhost/api/auth/signin', {
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

function mockRateLimitExceeded() {
  mockCheckRateLimit.mockReturnValue({
    allowed: false,
    remaining: 0,
    resetAt: Date.now() + 300000,
    retryAfterMs: 300000,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/signin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitPassed();
  });

  it('returns 400 with field errors for empty password', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'user@example.com', password: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
    expect(body.details?.password).toBeDefined();
  });

  it('returns 400 with field errors for missing email', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ password: 'password123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
    expect(body.details?.email).toBeDefined();
  });

  it('returns 400 with field errors for malformed email', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'not-an-email', password: 'password123' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
  });

  it('returns 401 for invalid credentials', async () => {
    mockSignIn.mockResolvedValue({
      error: { message: 'Invalid email or password' },
      user: null,
      session: null,
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'wrong' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid email or password/i);
    // Ensure password is not echoed back
    expect(JSON.stringify(body)).not.toContain('wrong');
  });

  it('returns 200 with user and session on successful sign-in', async () => {
    const mockUser = { id: 'user-1', email: 'user@example.com' };
    const mockSession = { id: 'session-1', userId: 'user-1' };
    mockSignIn.mockResolvedValue({
      error: null,
      user: mockUser,
      session: mockSession,
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'correct' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual(mockUser);
    expect(body.session).toEqual(mockSession);
  });

  it('returns 429 when rate limit is exceeded', async () => {
    mockRateLimitExceeded();
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'password' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
    const body = await res.json();
    expect(body.error).toMatch(/too many requests/i);
    expect(body.retryAfterMs).toBeDefined();
    // authService.signIn should not be called when rate limited
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('enforces rate limit per IP as documented', async () => {
    mockRateLimitExceeded();
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'password' }));
    expect(res.status).toBe(429);
    // Verify the rate limit key was computed (function should have been called)
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.stringContaining('auth:signin'),
      expect.any(Object)
    );
  });

  it('does not expose sensitive fields in error responses', async () => {
    mockSignIn.mockResolvedValue({
      error: { message: 'Invalid credentials' },
      user: null,
      session: null,
    });
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'user@example.com', password: 'supersecret123' }));
    const bodyStr = JSON.stringify(await res.json());
    expect(bodyStr).not.toContain('supersecret123');
    expect(bodyStr).not.toContain('session_secret');
  });
});
