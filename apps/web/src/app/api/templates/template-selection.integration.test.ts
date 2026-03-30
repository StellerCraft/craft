import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockListTemplates = vi.fn();
const mockGetTemplate = vi.fn();
const mockGetTemplateMetadata = vi.fn();

vi.mock('@/services/template.service', () => ({
  templateService: {
    listTemplates: mockListTemplates,
    getTemplate: mockGetTemplate,
    getTemplateMetadata: mockGetTemplateMetadata,
  },
}));

describe('Template API integration flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches template list from API', async () => {
    const { GET } = await import('./route');
    mockListTemplates.mockResolvedValue([
      { id: 'tpl-1', name: 'Stellar DEX', category: 'dex' },
      { id: 'tpl-2', name: 'Asset Issuance', category: 'defi' },
    ]);

    const req = new NextRequest('http://localhost/api/templates');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(mockListTemplates).toHaveBeenCalledWith({});
  });

  it('filters templates by category', async () => {
    const { GET } = await import('./route');
    mockListTemplates.mockResolvedValue([
      { id: 'tpl-1', name: 'Stellar DEX', category: 'dex' },
    ]);

    const req = new NextRequest('http://localhost/api/templates?category=dex');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockListTemplates).toHaveBeenCalledWith({ category: 'dex' });
  });

  it('fetches a single template details record', async () => {
    const { GET } = await import('./[id]/route');
    mockGetTemplate.mockResolvedValue({
      id: 'tpl-1',
      name: 'Stellar DEX',
      description: 'A DEX template',
      category: 'dex',
    });

    const req = new NextRequest('http://localhost/api/templates/tpl-1');
    const res = await GET(req, { params: { id: 'tpl-1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe('tpl-1');
    expect(mockGetTemplate).toHaveBeenCalledWith('tpl-1');
  });

  it('returns complete template metadata', async () => {
    const { GET } = await import('./[id]/metadata/route');
    mockGetTemplateMetadata.mockResolvedValue({
      id: 'tpl-1',
      name: 'Stellar DEX',
      version: '1.0.0',
      lastUpdated: new Date('2026-03-01T00:00:00.000Z'),
      totalDeployments: 14,
    });

    const req = new NextRequest(
      'http://localhost/api/templates/tpl-1/metadata'
    );
    const res = await GET(req, { params: { id: 'tpl-1' } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('lastUpdated');
    expect(body).toHaveProperty('totalDeployments');
    expect(mockGetTemplateMetadata).toHaveBeenCalledWith('tpl-1');
  });
});
