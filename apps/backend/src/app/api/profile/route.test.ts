/**
 * Integration Tests: GET/PUT/PATCH /api/profile
 *
 * Covers:
 *   GET
 *     - Returns 401 when unauthenticated
 *     - Returns profile fields sourced from user_metadata
 *     - Falls back to user.email when full_name is absent
 *     - Returns empty strings for absent optional fields (bio, avatarUrl)
 *     - Does NOT expose internal Supabase user fields beyond the declared shape
 *
 *   PUT / PATCH (shared updateProfile logic)
 *     - Returns 401 when unauthenticated
 *     - Returns 400 with field errors when displayName is missing
 *     - Returns 400 when displayName is too short (< 2 chars)
 *     - Returns 400 when avatarUrl is invalid (non-empty non-URL string)
 *     - Returns 400 when email is invalid format
 *     - Accepts empty string for avatarUrl (treated as clearing the field)
 *     - Accepts a valid avatarUrl
 *     - Calls supabase.auth.updateUser with mapped field names
 *     - Returns updated profile fields from refreshed user
 *     - Returns 500 when updateUser throws a Supabase error
 *     - bio is optional and defaults to empty string
 *     - email field is passed to updateUser when provided
 *
 * Issue: #1158
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Supabase mock — set up before any imports that trigger module resolution
// ---------------------------------------------------------------------------

const mockGetUser = vi.fn();
const mockUpdateUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      updateUser: mockUpdateUser,
    },
    // profile route does not call `from`, but withAuth wires supabase through
    from: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeUser = {
  id: 'user-abc',
  email: 'user@example.com',
  user_metadata: {
    full_name: 'Alice Example',
    bio: 'DeFi enthusiast',
    avatar_url: 'https://example.com/avatar.png',
  },
};

function makeGetRequest(url = 'http://localhost/api/profile') {
  return new NextRequest(url, { method: 'GET' });
}

function makePutRequest(body: unknown) {
  return new NextRequest('http://localhost/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET /api/profile
// ---------------------------------------------------------------------------

describe('GET /api/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(), { params: {} as any });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns profile fields from user_metadata', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(), { params: {} as any });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe('Alice Example');
    expect(body.email).toBe('user@example.com');
    expect(body.bio).toBe('DeFi enthusiast');
    expect(body.avatarUrl).toBe('https://example.com/avatar.png');
  });

  it('falls back to user.email when full_name is absent', async () => {
    const userWithoutName = {
      ...fakeUser,
      user_metadata: { bio: '', avatar_url: '' },
    };
    mockGetUser.mockResolvedValue({ data: { user: userWithoutName }, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(), { params: {} as any });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe('user@example.com');
  });

  it('returns empty strings for absent bio and avatarUrl', async () => {
    const userNoBioNoAvatar = {
      ...fakeUser,
      user_metadata: { full_name: 'Bob' },
    };
    mockGetUser.mockResolvedValue({ data: { user: userNoBioNoAvatar }, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(), { params: {} as any });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bio).toBe('');
    expect(body.avatarUrl).toBe('');
  });

  it('response shape contains exactly the declared PII fields and no extras', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { GET } = await import('./route');
    const res = await GET(makeGetRequest(), { params: {} as any });
    const body = await res.json();
    const keys = Object.keys(body);
    // Only these four keys should be present — no internal IDs, tokens, or raw metadata blobs
    expect(keys.sort()).toEqual(['avatarUrl', 'bio', 'displayName', 'email'].sort());
  });
});

// ---------------------------------------------------------------------------
// PUT /api/profile
// ---------------------------------------------------------------------------

describe('PUT /api/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { PUT } = await import('./route');
    const res = await PUT(makePutRequest({ displayName: 'Alice' }), { params: {} as any });
    expect(res.status).toBe(401);
  });

  it('returns 400 when displayName is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { PUT } = await import('./route');
    const res = await PUT(makePutRequest({ bio: 'hello' }), { params: {} as any });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid input/i);
    expect(body.details?.displayName).toBeDefined();
  });

  it('returns 400 when displayName is shorter than 2 characters', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { PUT } = await import('./route');
    const res = await PUT(makePutRequest({ displayName: 'A' }), { params: {} as any });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details?.displayName).toBeDefined();
  });

  it('returns 400 when avatarUrl is a non-empty non-URL string', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { PUT } = await import('./route');
    const res = await PUT(
      makePutRequest({ displayName: 'Alice', avatarUrl: 'not-a-url' }),
      { params: {} as any }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details?.avatarUrl).toBeDefined();
  });

  it('returns 400 when email is invalid format', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { PUT } = await import('./route');
    const res = await PUT(
      makePutRequest({ displayName: 'Alice', email: 'not-an-email' }),
      { params: {} as any }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details?.email).toBeDefined();
  });

  it('accepts empty string for avatarUrl (field clearing)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    mockUpdateUser.mockResolvedValue({ error: null });
    // getUser is called twice: auth check + refresh after update
    mockGetUser
      .mockResolvedValueOnce({ data: { user: fakeUser }, error: null })
      .mockResolvedValueOnce({ data: { user: { ...fakeUser, user_metadata: { full_name: 'Alice Example', bio: 'DeFi enthusiast', avatar_url: '' } } }, error: null });
    const { PUT } = await import('./route');
    const res = await PUT(
      makePutRequest({ displayName: 'Alice Example', avatarUrl: '' }),
      { params: {} as any }
    );
    expect(res.status).toBe(200);
  });

  it('calls updateUser with correct field mapping (full_name, avatar_url, bio)', async () => {
    mockGetUser
      .mockResolvedValueOnce({ data: { user: fakeUser }, error: null })
      .mockResolvedValueOnce({
        data: {
          user: {
            ...fakeUser,
            user_metadata: { full_name: 'New Name', bio: 'new bio', avatar_url: 'https://example.com/new.png' },
          },
        },
        error: null,
      });
    mockUpdateUser.mockResolvedValue({ error: null });

    const { PUT } = await import('./route');
    await PUT(
      makePutRequest({ displayName: 'New Name', bio: 'new bio', avatarUrl: 'https://example.com/new.png' }),
      { params: {} as any }
    );

    expect(mockUpdateUser).toHaveBeenCalledOnce();
    const callArg = mockUpdateUser.mock.calls[0][0];
    expect(callArg.data.full_name).toBe('New Name');
    expect(callArg.data.bio).toBe('new bio');
    expect(callArg.data.avatar_url).toBe('https://example.com/new.png');
  });

  it('passes email to updateUser when provided', async () => {
    mockGetUser
      .mockResolvedValueOnce({ data: { user: fakeUser }, error: null })
      .mockResolvedValueOnce({ data: { user: { ...fakeUser, email: 'newemail@example.com' } }, error: null });
    mockUpdateUser.mockResolvedValue({ error: null });

    const { PUT } = await import('./route');
    await PUT(
      makePutRequest({ displayName: 'Alice', email: 'newemail@example.com' }),
      { params: {} as any }
    );

    const callArg = mockUpdateUser.mock.calls[0][0];
    expect(callArg.email).toBe('newemail@example.com');
  });

  it('does NOT pass email to updateUser when not provided', async () => {
    mockGetUser
      .mockResolvedValueOnce({ data: { user: fakeUser }, error: null })
      .mockResolvedValueOnce({ data: { user: fakeUser }, error: null });
    mockUpdateUser.mockResolvedValue({ error: null });

    const { PUT } = await import('./route');
    await PUT(
      makePutRequest({ displayName: 'Alice' }),
      { params: {} as any }
    );

    const callArg = mockUpdateUser.mock.calls[0][0];
    expect(callArg.email).toBeUndefined();
  });

  it('returns updated profile fields from refreshed user after update', async () => {
    const updatedMetadata = {
      full_name: 'Updated Alice',
      bio: 'Updated bio',
      avatar_url: 'https://example.com/updated.png',
    };
    mockGetUser
      .mockResolvedValueOnce({ data: { user: fakeUser }, error: null })
      .mockResolvedValueOnce({
        data: { user: { ...fakeUser, user_metadata: updatedMetadata } },
        error: null,
      });
    mockUpdateUser.mockResolvedValue({ error: null });

    const { PUT } = await import('./route');
    const res = await PUT(
      makePutRequest({ displayName: 'Updated Alice', bio: 'Updated bio', avatarUrl: 'https://example.com/updated.png' }),
      { params: {} as any }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe('Updated Alice');
    expect(body.bio).toBe('Updated bio');
    expect(body.avatarUrl).toBe('https://example.com/updated.png');
  });

  it('returns 500 when supabase updateUser returns an error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    mockUpdateUser.mockResolvedValue({ error: { message: 'Database write failed' } });

    const { PUT } = await import('./route');
    const res = await PUT(
      makePutRequest({ displayName: 'Alice' }),
      { params: {} as any }
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/database write failed/i);
  });

  it('bio defaults to empty string when omitted', async () => {
    const userWithoutBio = { ...fakeUser, user_metadata: { full_name: 'Alice', avatar_url: '' } };
    mockGetUser
      .mockResolvedValueOnce({ data: { user: fakeUser }, error: null })
      .mockResolvedValueOnce({ data: { user: userWithoutBio }, error: null });
    mockUpdateUser.mockResolvedValue({ error: null });

    const { PUT } = await import('./route');
    const res = await PUT(
      makePutRequest({ displayName: 'Alice' }),
      { params: {} as any }
    );
    expect(res.status).toBe(200);

    // updateUser should have been called with bio: '' (the schema default)
    const callArg = mockUpdateUser.mock.calls[0][0];
    expect(callArg.data.bio).toBe('');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/profile  (shares updateProfile logic with PUT)
// ---------------------------------------------------------------------------

describe('PATCH /api/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(makePatchRequest({ displayName: 'Alice' }), { params: {} as any });
    expect(res.status).toBe(401);
  });

  it('returns 400 when displayName is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(makePatchRequest({}), { params: {} as any });
    expect(res.status).toBe(400);
  });

  it('returns 200 with updated profile on valid request', async () => {
    const updatedMeta = { full_name: 'Patched Name', bio: 'patch bio', avatar_url: '' };
    mockGetUser
      .mockResolvedValueOnce({ data: { user: fakeUser }, error: null })
      .mockResolvedValueOnce({ data: { user: { ...fakeUser, user_metadata: updatedMeta } }, error: null });
    mockUpdateUser.mockResolvedValue({ error: null });

    const { PATCH } = await import('./route');
    const res = await PATCH(
      makePatchRequest({ displayName: 'Patched Name', bio: 'patch bio' }),
      { params: {} as any }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe('Patched Name');
  });

  it('returns 400 when bio exceeds 160 characters', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(
      makePatchRequest({ displayName: 'Alice', bio: 'x'.repeat(161) }),
      { params: {} as any }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details?.bio).toBeDefined();
  });
});
