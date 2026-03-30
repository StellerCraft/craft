import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockExportAnalytics = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

vi.mock('@/services/analytics.service', () => ({
  analyticsService: {
    exportAnalytics: mockExportAnalytics,
  },
}));

const fakeUser = { id: 'user-1', email: 'user@example.com' };

const makeDeploymentsTable = (ownerId: string) => ({
  select: vi.fn((columns: string) => ({
    eq: vi.fn(() => ({
      single: vi
        .fn()
        .mockResolvedValue(
          columns === 'user_id'
            ? { data: { user_id: ownerId }, error: null }
            : { data: { name: 'stellar-dex' }, error: null }
        ),
    })),
  })),
});

describe('GET /api/deployments/[id]/analytics/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
  });

  it('returns CSV export with proper content headers', async () => {
    mockFrom.mockReturnValue(makeDeploymentsTable(fakeUser.id));
    mockExportAnalytics.mockResolvedValue(
      'Metric Type,Value,Recorded At\npage_view,1,2026-03-01T00:00:00.000Z'
    );

    const { GET } = await import('./route');
    const req = new NextRequest(
      'http://localhost/api/deployments/dep-1/analytics/export'
    );
    const res = await GET(req, { params: { id: 'dep-1' } });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Metric Type,Value,Recorded At');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain(
      'attachment; filename="analytics-'
    );
    expect(mockExportAnalytics).toHaveBeenCalledWith(
      'dep-1',
      undefined,
      undefined
    );
  });

  it('returns 403 when user does not own deployment analytics', async () => {
    mockFrom.mockReturnValue(makeDeploymentsTable('other-user'));
    const { GET } = await import('./route');

    const req = new NextRequest(
      'http://localhost/api/deployments/dep-1/analytics/export'
    );
    const res = await GET(req, { params: { id: 'dep-1' } });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Forbidden');
    expect(mockExportAnalytics).not.toHaveBeenCalled();
  });
});
