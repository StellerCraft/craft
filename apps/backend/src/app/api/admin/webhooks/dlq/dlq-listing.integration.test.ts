import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// Mock authentication (adjust based on your auth setup)
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

describe('GET /api/admin/webhooks/dlq', () => {
  const baseUrl = 'http://localhost/api/admin/webhooks/dlq';

  const samples = [
    { source: 'STRIPE', status: 'FAILED', payload: { event: 'invoice.failed' } },
    { source: 'STRIPE', status: 'PENDING', payload: { event: 'invoice.created' } },
    { source: 'GITH', status: 'FAILED', payload: { event: 'push' } },
    { source: 'GITHUB', status: 'PENDING', payload: { event: 'pull_request' } },
    { source: 'STRIPE', status: 'FAILED', payload: { event: 'charge.refunded' } },
  ];

  beforeEach(async () => {
    vi.resetAllMocks();
    await prisma.dlqEntry.deleteMany({});
    await prisma.dlqEntry.createMany({ data: samples });
  });

  afterEach(async () => {
    await prisma.dlqEntry.deleteMany({});
  });

  it('returns all DLQ entries without filters', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: 'ADMIN' } });
    const req = new NextRequest(baseUrl);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(5);
    expect(body.pagination.total).toBe(5);
  });

  it('filters by source query parameter', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: 'ADMIN' } });
    const req = new NextRequest(`${baseUrl}?source=STRIPE`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeAter(0);
    for (const item of body.items) {
      expect(item.source).toBe('STRIPE');
    }
  });

  it('filters by status query parameter', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: 'ADMIN' } });
    const req = new NextRequest(`${baseUrl}?status=FAILED`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeAter(0);
    for (const item of body.items) {
      expect(item.status).toBe('FAILED');
    }
  });

  it('paginates results with page and limit', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: 'ADMIN' } });
    const req = new NextRequest(`${baseUrl}?page=1&limit=2`);
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.total).toBe(5);
  });

  it('returns 401 when no session is present', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const req = new NextRequest(baseUrl);
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('returns 403 when the session user is not an admin', async () => {
    vi.mocked(getServerSession).mockResolvedValue({ user: { role: 'USER' } });
    const req = new NextRequest(baseUrl);
    const res = await GET(req);

    expect(res.status).toBe(403);
  });
});
