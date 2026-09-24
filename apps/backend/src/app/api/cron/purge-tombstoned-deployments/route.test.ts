import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const CRON_SECRET = 'test-cron-secret';

vi.mock('../../../../lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      delete: vi.fn(() => ({
        not: vi.fn(() => ({
          lt: vi.fn().mockResolvedValue({ error: null, count: 5 }),
        })),
      })),
    })),
  })),
}));

vi.mock('../../../../services/cleanup.service', () => ({
  cleanupService: {
    purgeOrphanedArtifacts: vi.fn().mockResolvedValue({ recordsDeleted: 2 }),
  },
}));

function makeRequest(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers.authorization = authHeader;
  return new NextRequest('http://localhost/api/cron/purge-tombstoned-deployments', { headers });
}

describe('GET /api/cron/purge-tombstoned-deployments', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.DEPLOYMENT_TOMBSTONE_RETENTION_DAYS = '30';
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.DEPLOYMENT_TOMBSTONE_RETENTION_DAYS;
  });

  it('returns 401 when cron secret is invalid', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest('Bearer wrong-secret'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: invalid or missing cron signature' });
  });

  it('returns 401 when cron secret is missing', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: invalid or missing cron signature' });
  });

  it('returns 401 when authorization header is malformed', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest('InvalidFormat'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: invalid or missing cron signature' });
  });

  it('allows request when cron secret is valid', async () => {
    const { GET } = await import('./route');
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.purged).toBeDefined();
    expect(data.orphanedArtifactsPurged).toBeDefined();
  });

  it('allows request when cron secret is unset', async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await import('./route');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.purged).toBeDefined();
  });
});
