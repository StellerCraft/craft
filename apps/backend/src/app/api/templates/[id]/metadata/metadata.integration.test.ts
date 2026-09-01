/**
 * Integration tests for GET /api/templates/[id]/metadata
 *
 * Covers:
 *   - Successful metadata retrieval for a known template ID
 *   - 404 response for an unknown / non-existent template ID
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Template service mock ─────────────────────────────────────────────────────

const mockGetTemplateMetadata = vi.fn();

vi.mock('@/services/template.service', () => ({
  templateService: {
    getTemplateMetadata: mockGetTemplateMetadata,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(id: string): [NextRequest, { params: { id: string } }] {
  const req = new NextRequest(
    `http://localhost/api/templates/${id}/metadata`
  );
  return [req, { params: { id } }];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/templates/[id]/metadata (Integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns metadata with 200 for a known template ID', async () => {
    const { GET } = await import('./route');

    mockGetTemplateMetadata.mockResolvedValue({
      id: 'tpl-1',
      name: 'Stellar DEX',
      version: '1.0.0',
      lastUpdated: new Date('2026-03-01T00:00:00.000Z'),
      totalDeployments: 14,
    });

    const res = await GET(...makeRequest('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 'tpl-1',
      name: 'Stellar DEX',
      version: '1.0.0',
      totalDeployments: 14,
    });
    expect(body).toHaveProperty('lastUpdated');
    expect(mockGetTemplateMetadata).toHaveBeenCalledWith('tpl-1');
  });

  it('returns 404 for a non-existent template ID', async () => {
    const { GET } = await import('./route');

    mockGetTemplateMetadata.mockRejectedValue(new Error('Template not found'));

    const res = await GET(...makeRequest('does-not-exist'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Template not found');
    expect(mockGetTemplateMetadata).toHaveBeenCalledWith('does-not-exist');
  });
});
