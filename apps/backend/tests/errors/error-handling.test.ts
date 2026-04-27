/**
 * Comprehensive Error Handling Tests (#338)
 *
 * Verifies that all critical error paths:
 *   - Produce user-friendly messages (no raw stack traces or internal details)
 *   - Include correlation IDs for traceability
 *   - Log sufficient context without leaking sensitive data
 *   - Recover gracefully or surface actionable guidance
 *
 * Coverage:
 *   1. Error guidance library (all domains + fallbacks)
 *   2. Structured logger (correlation IDs, sensitive-data exclusion)
 *   3. withLogging middleware (unhandled throws → 500 + correlationId)
 *   4. withAuth / withDeploymentAuth / withDomainTierCheck error paths
 *   5. AuthService error paths (signIn / signUp)
 *   6. HealthMonitorService error paths
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Hoisted mocks (must be declared before any vi.mock factory runs) ──────────

const mockGetUser       = vi.hoisted(() => vi.fn());
const mockFrom          = vi.hoisted(() => vi.fn());
const mockSignUp        = vi.hoisted(() => vi.fn());
const mockSignIn        = vi.hoisted(() => vi.fn());
const mockProfileInsert = vi.hoisted(() => vi.fn());
const mockProfileSelect = vi.hoisted(() => vi.fn());
const mockAnalyticsRecord = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      signUp: mockSignUp,
      signInWithPassword: mockSignIn,
    },
    from: mockFrom,
  }),
}));

vi.mock('@/lib/stripe/pricing', () => ({
  canConfigureCustomDomain: (tier: string) => tier !== 'free',
  TIER_CONFIGS: {},
}));

vi.mock('@/services/analytics.service', () => ({
  analyticsService: { recordUptimeCheck: mockAnalyticsRecord },
}));

vi.stubGlobal('fetch', vi.fn());

// ─────────────────────────────────────────────────────────────────────────────
// 1. Error Guidance Library
// ─────────────────────────────────────────────────────────────────────────────

import { getErrorGuidance, formatMessage } from '@/lib/errors/guidance';

describe('Error guidance – user-friendly messages', () => {
  it.each([
    ['github', 'AUTH_FAILED'],
    ['github', 'RATE_LIMITED'],
    ['github', 'COLLISION'],
    ['github', 'NETWORK_ERROR'],
    ['github', 'CONFIGURATION_ERROR'],
    ['vercel', 'AUTH_FAILED'],
    ['vercel', 'RATE_LIMITED'],
    ['vercel', 'PROJECT_EXISTS'],
    ['vercel', 'NETWORK_ERROR'],
    ['stripe', 'CARD_DECLINED'],
    ['stripe', 'WEBHOOK_SIGNATURE_INVALID'],
    ['stripe', 'SUBSCRIPTION_NOT_FOUND'],
    ['stellar', 'INSUFFICIENT_BALANCE'],
    ['stellar', 'NETWORK_MISMATCH'],
    ['stellar', 'TRANSACTION_FAILED'],
    ['stellar', 'ENDPOINT_UNREACHABLE'],
    ['auth', 'INVALID_CREDENTIALS'],
    ['auth', 'EMAIL_TAKEN'],
  ] as const)('guidance for %s:%s has a non-empty title and message', (domain, code) => {
    const g = getErrorGuidance(domain, code);
    expect(g.template.title.length).toBeGreaterThan(0);
    expect(g.template.message.length).toBeGreaterThan(0);
  });

  it.each([
    ['github', 'AUTH_FAILED'],
    ['github', 'COLLISION'],
    ['github', 'CONFIGURATION_ERROR'],
    ['vercel', 'AUTH_FAILED'],
    ['vercel', 'PROJECT_EXISTS'],
    ['stripe', 'WEBHOOK_SIGNATURE_INVALID'],
    ['stripe', 'SUBSCRIPTION_NOT_FOUND'],
    ['stellar', 'INSUFFICIENT_BALANCE'],
    ['stellar', 'NETWORK_MISMATCH'],
    ['stellar', 'TRANSACTION_FAILED'],
    ['auth', 'EMAIL_TAKEN'],
  ] as const)('non-retryable errors are marked retryable=false: %s:%s', (domain, code) => {
    const g = getErrorGuidance(domain, code);
    expect(g.template.retryable).toBe(false);
  });

  it.each([
    ['github', 'RATE_LIMITED'],
    ['github', 'NETWORK_ERROR'],
    ['vercel', 'RATE_LIMITED'],
    ['vercel', 'NETWORK_ERROR'],
    ['stripe', 'CARD_DECLINED'],
    ['stellar', 'ENDPOINT_UNREACHABLE'],
    ['auth', 'INVALID_CREDENTIALS'],
  ] as const)('transient errors are marked retryable=true: %s:%s', (domain, code) => {
    const g = getErrorGuidance(domain, code);
    expect(g.template.retryable).toBe(true);
  });

  it('every known error has at least one actionable step and one link', () => {
    const cases: Array<[Parameters<typeof getErrorGuidance>[0], string]> = [
      ['github', 'AUTH_FAILED'], ['github', 'RATE_LIMITED'], ['github', 'COLLISION'],
      ['github', 'NETWORK_ERROR'], ['github', 'CONFIGURATION_ERROR'],
      ['vercel', 'AUTH_FAILED'], ['vercel', 'RATE_LIMITED'], ['vercel', 'PROJECT_EXISTS'], ['vercel', 'NETWORK_ERROR'],
      ['stripe', 'CARD_DECLINED'], ['stripe', 'WEBHOOK_SIGNATURE_INVALID'], ['stripe', 'SUBSCRIPTION_NOT_FOUND'],
      ['stellar', 'INSUFFICIENT_BALANCE'], ['stellar', 'NETWORK_MISMATCH'],
      ['stellar', 'TRANSACTION_FAILED'], ['stellar', 'ENDPOINT_UNREACHABLE'],
      ['auth', 'INVALID_CREDENTIALS'], ['auth', 'EMAIL_TAKEN'],
    ];
    for (const [domain, code] of cases) {
      const g = getErrorGuidance(domain, code);
      expect(g.steps.length, `${domain}:${code} steps`).toBeGreaterThan(0);
      expect(g.links.length, `${domain}:${code} links`).toBeGreaterThan(0);
    }
  });

  it('falls back to general:UNKNOWN for an unrecognised code', () => {
    const g = getErrorGuidance('github', 'TOTALLY_UNKNOWN');
    expect(g.template.title).toBe('An unexpected error occurred');
    expect(g.template.retryable).toBe(true);
  });

  it('falls back to general:UNKNOWN for an unrecognised domain', () => {
    // @ts-expect-error intentional invalid domain
    const g = getErrorGuidance('unknown_domain', 'SOME_CODE');
    expect(g.template.title).toBe('An unexpected error occurred');
  });

  it('error messages do not contain raw stack traces or internal paths', () => {
    const cases: Array<[Parameters<typeof getErrorGuidance>[0], string]> = [
      ['github', 'AUTH_FAILED'], ['stripe', 'CARD_DECLINED'], ['auth', 'INVALID_CREDENTIALS'],
    ];
    for (const [domain, code] of cases) {
      const g = getErrorGuidance(domain, code);
      expect(g.template.message).not.toMatch(/Error:/);
      expect(g.template.message).not.toMatch(/at \w+/);
      expect(g.template.message).not.toMatch(/\/workspaces\//);
    }
  });
});

describe('formatMessage – placeholder interpolation', () => {
  it('replaces a single placeholder', () => {
    expect(formatMessage('Wait {retryAfter} seconds.', { retryAfter: '60' }))
      .toBe('Wait 60 seconds.');
  });

  it('replaces multiple distinct placeholders', () => {
    expect(formatMessage('{name} failed with {resultCode}.', { name: 'tx', resultCode: 'op_no_trust' }))
      .toBe('tx failed with op_no_trust.');
  });

  it('leaves unknown placeholders intact (no data leakage)', () => {
    expect(formatMessage('Error: {code}', {})).toBe('Error: {code}');
  });

  it('returns the template unchanged when values is omitted', () => {
    expect(formatMessage('No placeholders.')).toBe('No placeholders.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Structured Logger – correlation IDs and sensitive-data exclusion
// ─────────────────────────────────────────────────────────────────────────────

import {
  createLogger,
  resolveCorrelationId,
  withLogging,
  CORRELATION_ID_HEADER,
} from '@/lib/api/logger';

interface LogEntry {
  level: string;
  message: string;
  correlationId: string;
  timestamp: string;
  stack?: string;
  metadata: Record<string, unknown>;
}

function lastEntry(spy: ReturnType<typeof vi.spyOn>): LogEntry {
  const raw = (spy as any).mock.calls.at(-1)?.[0] as string;
  return JSON.parse(raw);
}

describe('createLogger – structured output', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('includes correlationId in every log entry', () => {
    const log = createLogger({ correlationId: 'test-cid-001' });
    log.info('test message');
    expect(lastEntry(console.log as any).correlationId).toBe('test-cid-001');
  });

  it('includes a valid ISO timestamp in every entry', () => {
    const log = createLogger({ correlationId: 'cid-ts' });
    log.info('ts check');
    const ts = lastEntry(console.log as any).timestamp;
    expect(new Date(ts).getTime()).toBeGreaterThan(0);
  });

  it('error entries include the stack trace for debugging', () => {
    const log = createLogger({ correlationId: 'cid-stack' });
    log.error('handler failed', new Error('something broke'));
    const entry = lastEntry(console.error as any);
    expect(entry.stack).toBeDefined();
    expect(entry.stack).toContain('something broke');
  });

  it('does not include stack when the thrown value is not an Error', () => {
    const log = createLogger({ correlationId: 'cid-nostack' });
    log.error('plain string thrown', 'not an Error');
    expect(lastEntry(console.error as any).stack).toBeUndefined();
  });

  it('does not leak correlationId into the metadata object', () => {
    const log = createLogger({ correlationId: 'cid-leak', userId: 'u1' });
    log.info('check');
    const entry = lastEntry(console.log as any);
    expect(entry.metadata.correlationId).toBeUndefined();
    expect(entry.correlationId).toBe('cid-leak');
  });

  it('logger does not automatically inject password or token fields', () => {
    const log = createLogger({ correlationId: 'cid-safe' });
    log.info('user action', { action: 'login' });
    const serialised = JSON.stringify(lastEntry(console.log as any));
    // The logger itself must not add these fields
    expect(serialised).not.toContain('"password"');
    expect(serialised).not.toContain('"token"');
  });

  it('merges extra metadata with the base context', () => {
    const log = createLogger({ correlationId: 'cid-meta', userId: 'u42' });
    log.warn('degraded', { stage: 'push' });
    const entry = lastEntry(console.warn as any);
    expect(entry.metadata.userId).toBe('u42');
    expect(entry.metadata.stage).toBe('push');
  });
});

describe('resolveCorrelationId', () => {
  it('returns the header value when present and valid', () => {
    const req = new NextRequest('http://localhost/', {
      headers: { [CORRELATION_ID_HEADER]: 'valid-corr-id-1234' },
    });
    expect(resolveCorrelationId(req)).toBe('valid-corr-id-1234');
  });

  it('generates a UUID when the header is absent', () => {
    const req = new NextRequest('http://localhost/');
    expect(resolveCorrelationId(req)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates a new UUID when the header value is too short', () => {
    const req = new NextRequest('http://localhost/', {
      headers: { [CORRELATION_ID_HEADER]: 'short' },
    });
    const id = resolveCorrelationId(req);
    expect(id).not.toBe('short');
    expect(id.length).toBeGreaterThanOrEqual(36);
  });

  it('generates unique IDs on successive calls without a header', () => {
    const req = new NextRequest('http://localhost/');
    expect(resolveCorrelationId(req)).not.toBe(resolveCorrelationId(req));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. withLogging middleware – unhandled errors → 500 + correlationId
// ─────────────────────────────────────────────────────────────────────────────

describe('withLogging – unhandled error recovery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 500 when the handler throws', async () => {
    const handler = withLogging(async () => { throw new Error('boom'); });
    const res = await handler(new NextRequest('http://localhost/api/test'), { params: {} });
    expect(res.status).toBe(500);
  });

  it('includes correlationId in the 500 response body', async () => {
    const handler = withLogging(async () => { throw new Error('boom'); });
    const req = new NextRequest('http://localhost/api/test', {
      headers: { [CORRELATION_ID_HEADER]: 'err-cid-9999' },
    });
    const body = await (await handler(req, { params: {} })).json();
    expect(body.correlationId).toBe('err-cid-9999');
  });

  it('echoes correlationId in the response header on error', async () => {
    const handler = withLogging(async () => { throw new Error('boom'); });
    const req = new NextRequest('http://localhost/api/test', {
      headers: { [CORRELATION_ID_HEADER]: 'hdr-cid-1234' },
    });
    const res = await handler(req, { params: {} });
    expect(res.headers.get(CORRELATION_ID_HEADER)).toBe('hdr-cid-1234');
  });

  it('returns a generic error message without leaking internal details', async () => {
    const handler = withLogging(async () => { throw new Error('db password is abc123'); });
    const body = await (await handler(new NextRequest('http://localhost/api/test'), { params: {} })).json();
    expect(body.error).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('abc123');
  });

  it('echoes correlationId in the response header on success', async () => {
    const handler = withLogging(async (_req, { correlationId }) =>
      NextResponse.json({ correlationId })
    );
    const req = new NextRequest('http://localhost/api/test', {
      headers: { [CORRELATION_ID_HEADER]: 'ok-cid-5678' },
    });
    expect((await handler(req, { params: {} })).headers.get(CORRELATION_ID_HEADER)).toBe('ok-cid-5678');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. withAuth / withDeploymentAuth / withDomainTierCheck error paths
// ─────────────────────────────────────────────────────────────────────────────

import { withAuth, withDeploymentAuth, withDomainTierCheck } from '@/lib/api/with-auth';

const makeReq = () => new NextRequest('http://localhost/api/test');

describe('withAuth – authentication error paths', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when no session exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await withAuth(async () => NextResponse.json({ ok: true }))(makeReq(), { params: {} });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
  });

  it('returns 401 when getUser returns an error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('jwt expired') });
    const res = await withAuth(async () => NextResponse.json({ ok: true }))(makeReq(), { params: {} });
    expect(res.status).toBe(401);
  });

  it('attaches a correlationId header on 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await withAuth(async () => NextResponse.json({ ok: true }))(makeReq(), { params: {} });
    expect(res.headers.get(CORRELATION_ID_HEADER)).toBeTruthy();
  });

  it('does not leak user data in the 401 body', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await withAuth(async () => NextResponse.json({ ok: true }))(makeReq(), { params: {} });
    expect(Object.keys(await res.json())).toEqual(['error']);
  });
});

describe('withDeploymentAuth – ownership error paths', () => {
  const fakeUser = { id: 'user-1', email: 'a@b.com' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
  });

  it('returns 403 when deployment not found', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null }) }) }),
    });
    const res = await withDeploymentAuth(async () => NextResponse.json({ ok: true }))(
      makeReq(), { params: { id: 'dep-1' } }
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Forbidden');
  });

  it('returns 403 when deployment belongs to a different user', async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { user_id: 'other' } }) }) }),
    });
    const res = await withDeploymentAuth(async () => NextResponse.json({ ok: true }))(
      makeReq(), { params: { id: 'dep-1' } }
    );
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated (inherits withAuth)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await withDeploymentAuth(async () => NextResponse.json({ ok: true }))(
      makeReq(), { params: { id: 'dep-1' } }
    );
    expect(res.status).toBe(401);
  });
});

describe('withDomainTierCheck – tier restriction error paths', () => {
  const fakeUser = { id: 'user-1', email: 'a@b.com' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
  });

  it('returns 403 with upgradeUrl when user is on free tier', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { user_id: fakeUser.id } }) }) }),
      })
      .mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { subscription_tier: 'free' } }) }) }),
      });
    const res = await withDomainTierCheck(async () => NextResponse.json({ ok: true }))(
      makeReq(), { params: { id: 'dep-1' } }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.upgradeUrl).toBeDefined();
    expect(body.error).toMatch(/Pro or Enterprise/);
  });

  it('403 body does not leak internal subscription details', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { user_id: fakeUser.id } }) }) }),
      })
      .mockReturnValueOnce({
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { subscription_tier: 'free' } }) }) }),
      });
    const res = await withDomainTierCheck(async () => NextResponse.json({ ok: true }))(
      makeReq(), { params: { id: 'dep-1' } }
    );
    const serialised = JSON.stringify(await res.json());
    expect(serialised).not.toContain('stripe');
    expect(serialised).not.toContain('customer_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. AuthService – error paths
// ─────────────────────────────────────────────────────────────────────────────

import { AuthService } from '@/services/auth.service';

describe('AuthService – signIn error paths', () => {
  let service: AuthService;
  beforeEach(() => { vi.clearAllMocks(); service = new AuthService(); });

  it('returns an error result (not a throw) on invalid credentials', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const result = await service.signIn('bad@example.com', 'wrong');
    expect(result.error).not.toBeNull();
    expect(result.user).toBeNull();
  });

  it('converts "Invalid login credentials" to a user-friendly message', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const result = await service.signIn('bad@example.com', 'wrong');
    expect(result.error!.message).not.toBe('Invalid login credentials');
    expect(result.error!.message.length).toBeGreaterThan(0);
  });

  it('does not include the attempted password in the error message', async () => {
    mockSignIn.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', message: 'Invalid login credentials' },
    });
    const result = await service.signIn('user@example.com', 'supersecret123');
    expect(result.error!.message).not.toContain('supersecret123');
  });
});

describe('AuthService – signUp error paths', () => {
  let service: AuthService;
  beforeEach(() => { vi.clearAllMocks(); service = new AuthService(); });

  it('returns an error result when Supabase signUp fails', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'email_taken', message: 'User already registered' },
    });
    const result = await service.signUp('taken@example.com', 'pass123');
    expect(result.error).not.toBeNull();
    expect(result.user).toBeNull();
  });

  it('returns an error result when profile creation fails', async () => {
    const fakeUser = { id: 'u1', email: 'new@example.com', created_at: '2024-01-01T00:00:00Z' };
    mockSignUp.mockResolvedValue({ data: { user: fakeUser, session: null }, error: null });
    mockFrom.mockReturnValue({ insert: () => Promise.resolve({ error: { message: 'duplicate key' } }) });
    const result = await service.signUp('new@example.com', 'pass123');
    expect(result.error).not.toBeNull();
    expect(result.user).toBeNull();
  });

  it('returns an error result when no user is returned', async () => {
    mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: null });
    const result = await service.signUp('ghost@example.com', 'pass123');
    expect(result.error).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. HealthMonitorService – error paths
// ─────────────────────────────────────────────────────────────────────────────

import { HealthMonitorService } from '@/services/health-monitor.service';

// Helper: build a chainable Supabase query mock for checkAllDeployments
// which calls .select().eq().eq()
function makeDeploymentListMock(data: unknown[] | null) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ data }),
      }),
    }),
  };
}

// Helper: build a single-row mock for checkDeploymentHealth which calls
// .select().eq().single()
function makeDeploymentRowMock(row: unknown) {
  return {
    select: () => ({
      eq: () => ({
        single: () => Promise.resolve({ data: row }),
      }),
    }),
  };
}

describe('HealthMonitorService – error paths', () => {
  let service: HealthMonitorService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HealthMonitorService();
    mockAnalyticsRecord.mockResolvedValue(undefined);
  });

  it('returns isHealthy=false when deployment URL is not found', async () => {
    mockFrom.mockReturnValue(makeDeploymentRowMock(null));
    const result = await service.checkDeploymentHealth('dep-missing');
    expect(result.isHealthy).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('error message for missing URL is user-readable (not a stack trace)', async () => {
    mockFrom.mockReturnValue(makeDeploymentRowMock(null));
    const result = await service.checkDeploymentHealth('dep-missing');
    expect(result.error).not.toMatch(/Error:/);
    expect(result.error).not.toMatch(/at \w+/);
  });

  it('returns isHealthy=false and records downtime when fetch throws', async () => {
    mockFrom.mockReturnValue(makeDeploymentRowMock({ deployment_url: 'https://example.com' }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await service.checkDeploymentHealth('dep-1');
    expect(result.isHealthy).toBe(false);
    expect(mockAnalyticsRecord).toHaveBeenCalledWith('dep-1', false);
  });

  it('returns isHealthy=false for non-2xx responses', async () => {
    mockFrom.mockReturnValue(makeDeploymentRowMock({ deployment_url: 'https://example.com' }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 503 });
    const result = await service.checkDeploymentHealth('dep-1');
    expect(result.isHealthy).toBe(false);
    expect(result.statusCode).toBe(503);
  });

  it('records downtime analytics on fetch failure', async () => {
    mockFrom.mockReturnValue(makeDeploymentRowMock({ deployment_url: 'https://example.com' }));
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));
    await service.checkDeploymentHealth('dep-2');
    expect(mockAnalyticsRecord).toHaveBeenCalledWith('dep-2', false);
  });

  it('returns empty array (not a throw) when no active deployments exist', async () => {
    mockFrom.mockReturnValue(makeDeploymentListMock([]));
    const results = await service.checkAllDeployments();
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it('returns empty array (not a throw) when deployments query returns null', async () => {
    mockFrom.mockReturnValue(makeDeploymentListMock(null));
    const results = await service.checkAllDeployments();
    expect(Array.isArray(results)).toBe(true);
  });
});
