/**
 * Unit test for GitHub delivery log pagination
 *
 * Verifies that fetchDeliveryLog() follows Link header pagination
 * and aggregates all deliveries across multiple pages, with protection
 * against unbounded pagination via MAX_PAGES safety limit.
 *
 * Issue: #895
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubDeliveryFetcherService } from './github-delivery-fetcher.service';

interface MockAuthClient {
  requestWithInstallationAuth: (url: string, opts: any) => Promise<Response>;
}

const createMockAuthClient = (pages: any[]): MockAuthClient => {
  let currentPageIndex = 0;

  return {
    requestWithInstallationAuth: async (url: string) => {
      if (currentPageIndex >= pages.length) {
        return new Response('[]', { status: 404 });
      }

      const pageData = pages[currentPageIndex];
      const isLastPage = currentPageIndex === pages.length - 1;
      const headers = new Headers({
        'content-type': 'application/json',
      });

      if (!isLastPage) {
        headers.set(
          'link',
          `</app/hooks/123/deliveries?page=${currentPageIndex + 2}>; rel="next"`
        );
      }

      currentPageIndex++;

      return new Response(JSON.stringify(pageData), {
        status: 200,
        headers,
      });
    },
  };
};

vi.mock('@/lib/github/app-auth', () => ({
  getGitHubAppAuthClient: () => ({}),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({}),
}));

describe('GitHubDeliveryFetcherService – pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and aggregates deliveries across multiple pages', async () => {
    const page1 = [
      { id: 1, guid: 'guid-1', delivered_at: '2026-07-24T10:00:00Z', event: 'push' },
      { id: 2, guid: 'guid-2', delivered_at: '2026-07-24T10:01:00Z', event: 'pull_request' },
    ];

    const page2 = [
      { id: 3, guid: 'guid-3', delivered_at: '2026-07-24T10:02:00Z', event: 'push' },
      { id: 4, guid: 'guid-4', delivered_at: '2026-07-24T10:03:00Z', event: 'issues' },
    ];

    const page3 = [
      { id: 5, guid: 'guid-5', delivered_at: '2026-07-24T10:04:00Z', event: 'push' },
    ];

    const mockAuthClient = createMockAuthClient([page1, page2, page3]);

    const service = new GitHubDeliveryFetcherService();
    (service as any).authClient = mockAuthClient;

    const result = await service.fetchDeliveryLog(123);

    expect(result.success).toBe(true);
    expect(result.deliveries).toHaveLength(5);
    expect(result.deliveries?.map(d => d.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('respects MAX_PAGES safety limit to prevent unbounded pagination', async () => {
    // Create 15 pages worth of data (more than MAX_PAGES = 10)
    const pages = Array.from({ length: 15 }, (_, i) => [
      { id: i * 10 + 1, guid: `guid-${i * 10 + 1}`, delivered_at: '2026-07-24T10:00:00Z', event: 'push' },
      { id: i * 10 + 2, guid: `guid-${i * 10 + 2}`, delivered_at: '2026-07-24T10:00:00Z', event: 'push' },
    ]);

    const mockAuthClient = createMockAuthClient(pages);

    const service = new GitHubDeliveryFetcherService();
    (service as any).authClient = mockAuthClient;

    const result = await service.fetchDeliveryLog(123);

    expect(result.success).toBe(true);
    // Should have fetched only up to MAX_PAGES (10), so 10 * 2 = 20 deliveries
    expect(result.deliveries?.length).toBeLessThanOrEqual(20);
    expect(result.deliveries?.length).toBeGreaterThan(0);
  });

  it('filters deliveries by since parameter after pagination', async () => {
    const page1 = [
      { id: 1, guid: 'guid-1', delivered_at: '2026-07-24T09:00:00Z', event: 'push' },
      { id: 2, guid: 'guid-2', delivered_at: '2026-07-24T09:30:00Z', event: 'push' },
    ];

    const page2 = [
      { id: 3, guid: 'guid-3', delivered_at: '2026-07-24T11:00:00Z', event: 'push' },
      { id: 4, guid: 'guid-4', delivered_at: '2026-07-24T11:30:00Z', event: 'push' },
    ];

    const mockAuthClient = createMockAuthClient([page1, page2]);

    const service = new GitHubDeliveryFetcherService();
    (service as any).authClient = mockAuthClient;

    const since = '2026-07-24T10:00:00Z';
    const result = await service.fetchDeliveryLog(123, since);

    expect(result.success).toBe(true);
    // Only deliveries after since timestamp should be returned
    expect(result.deliveries).toHaveLength(2);
    expect(result.deliveries?.map(d => d.id)).toEqual([3, 4]);
  });

  it('handles single page response without Link header', async () => {
    const page1 = [
      { id: 1, guid: 'guid-1', delivered_at: '2026-07-24T10:00:00Z', event: 'push' },
      { id: 2, guid: 'guid-2', delivered_at: '2026-07-24T10:01:00Z', event: 'push' },
    ];

    const mockAuthClient = createMockAuthClient([page1]);

    const service = new GitHubDeliveryFetcherService();
    (service as any).authClient = mockAuthClient;

    const result = await service.fetchDeliveryLog(123);

    expect(result.success).toBe(true);
    expect(result.deliveries).toHaveLength(2);
  });
});
