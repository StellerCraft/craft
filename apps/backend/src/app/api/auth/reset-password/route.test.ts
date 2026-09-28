/**
 * Tests for POST /api/auth/reset-password
 *
 * Covers:
 *   - existing account reset request → 200 with success message
 *   - non-existent account reset request → 200 with identical message (enumeration-safe)
 *   - authService.resetPassword error is swallowed → 200 (never propagates)
 *   - invalid email format → 400 (the one legitimate differentiator)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock authService ──────────────────────────────────────────────────────

const mockResetPassword = vi.fn();
vi.mock('@/services/auth.service', () => ({
  authService: { resetPassword: mockResetPassword },
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
  return new NextRequest('http://localhost/api/auth/reset-password', {
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

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimitPassed();
  });

  it('returns 200 with success message for an existing account', async () => {
    mockResetPassword.mockResolvedValue(undefined);
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'existing@example.com' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/if an account exists/i);
  });

  it('returns 200 with identical message for a non-existent account (enumeration-safe)', async () => {
    mockResetPassword.mockResolvedValue(undefined);
    const { POST } = await import('./route');
    const res1 = await POST(makeRequest({ email: 'existing@example.com' }));
    const res2 = await POST(makeRequest({ email: 'nonexistent@example.com' }));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    // Both should return identical response shape and message
    expect(body1).toEqual(body2);
  });

  it('swallows errors from authService.resetPassword and returns 200', async () => {
    mockResetPassword.mockRejectedValue(new Error('Database failure'));
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'test@example.com' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/if an account exists/i);
    // No error should be exposed
    expect(body.error).toBeUndefined();
  });

  it('returns 400 for invalid email format (the one legitimate differentiator)', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
    expect(body.details).toBeDefined();
  });

  it('returns 400 for missing email field', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
  });

  it('ensures authService.resetPassword is called with the correct email', async () => {
    mockResetPassword.mockResolvedValue(undefined);
    const { POST } = await import('./route');
    await POST(makeRequest({ email: 'test@example.com' }));
    expect(mockResetPassword).toHaveBeenCalledWith('test@example.com');
  });

  it('does not expose thrown errors in response body (enumeration safety)', async () => {
    mockResetPassword.mockRejectedValue(new Error('User account locked'));
    const { POST } = await import('./route');
    const res = await POST(makeRequest({ email: 'test@example.com' }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('User account locked');
    expect(JSON.stringify(body)).not.toContain('Database');
  });
});
