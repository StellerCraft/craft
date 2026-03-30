import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockGetAnalytics = vi.fn();
const mockGetAnalyticsSummary = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

vi.mock('@/services/analytics.service', () => ({
  analyticsService: {
    getAnalytics: mockGetAnalytics,
    getAnalyticsSummary: mockGetAnalyticsSummary,
  },
}));

const fakeUser = { id: 'user-1', email: 'user@example.com' };

const makeOwnershipQuery = (ownerId: string | null) => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      single: vi
        .fn()
        .mockResolvedValue(
          ownerId === null
            ? { data: null, error: { message: 'not found' } }
            : { data: { user_id: ownerId }, error: null }
        ),
    })),
  })),
});

describe('GET /api/deployments/[id]/analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
  });

  it('returns analytics data and summary for the deployment owner', async () => {
    mockFrom.mockReturnValue(makeOwnershipQuery(fakeUser.id));
    mockGetAnalytics.mockResolvedValue([
      {
        id: 'a-1',
        metricType: 'page_view',
        metricValue: 3,
        recordedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);
    mockGetAnalyticsSummary.mockResolvedValue({
      totalPageViews: 3,
      uptimePercentage: 100,
      totalTransactions: 0,
      lastChecked: null,
    });

    const { GET } = await import('./route');
    const req = new NextRequest(
      'http://localhost/api/deployments/dep-1/analytics?metricType=page_view'
    );
    const res = await GET(req, { params: { id: 'dep-1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.analytics).toHaveLength(1);
    expect(body.summary.totalPageViews).toBe(3);
    expect(mockGetAnalytics).toHaveBeenCalledWith(
      'dep-1',
      'page_view',
      undefined,
      undefined
    );
    expect(mockGetAnalyticsSummary).toHaveBeenCalledWith('dep-1');
  });

  it('requires authentication to access analytics data', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { GET } = await import('./route');

    const req = new NextRequest(
      'http://localhost/api/deployments/dep-1/analytics'
    );
    const res = await GET(req, { params: { id: 'dep-1' } });

    expect(res.status).toBe(401);
    expect(mockGetAnalytics).not.toHaveBeenCalled();
    expect(mockGetAnalyticsSummary).not.toHaveBeenCalled();
  });

  it('prevents users from accessing analytics for deployments they do not own', async () => {
    mockFrom.mockReturnValue(makeOwnershipQuery('other-user'));
    const { GET } = await import('./route');

    const req = new NextRequest(
      'http://localhost/api/deployments/dep-1/analytics'
    );
    const res = await GET(req, { params: { id: 'dep-1' } });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Forbidden');
    expect(mockGetAnalytics).not.toHaveBeenCalled();
  });
});
