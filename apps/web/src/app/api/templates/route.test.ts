/**
 * Unit tests for GET /api/templates
 * Feature: write-api-route-tests-for-template-endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// ── Template service mock ─────────────────────────────────────────────────────

const mockListTemplates = vi.fn();

vi.mock('@/services/template.service', () => ({
    templateService: { listTemplates: mockListTemplates },
}));

vi.mock('@/lib/api/cors', () => ({
    handlePreflight: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeTemplate = (overrides: Record<string, any> = {}) => ({
    id: 'tpl-1',
    name: 'Stellar DEX',
    description: 'A DEX template',
    category: 'dex',
    blockchainType: 'stellar',
    isActive: true,
    ...overrides,
});

function makeRequest(params: Record<string, string> = {}): NextRequest {
    const url = new URL('http://localhost/api/templates');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return new NextRequest(url.toString());
}

describe('GET /api/templates', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns template list with 200', async () => {
        mockListTemplates.mockResolvedValue([makeTemplate()]);

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toHaveLength(1);
        expect(body[0].id).toBe('tpl-1');
    });

    it('returns empty array when no templates exist', async () => {
        mockListTemplates.mockResolvedValue([]);

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual([]);
    });

    it('passes category filter to service', async () => {
        mockListTemplates.mockResolvedValue([makeTemplate({ category: 'lending' })]);

        await GET(makeRequest({ category: 'lending' }));

        expect(mockListTemplates).toHaveBeenCalledWith(
            expect.objectContaining({ category: 'lending' })
        );
    });

    it('passes search filter to service', async () => {
        mockListTemplates.mockResolvedValue([]);

        await GET(makeRequest({ search: 'dex' }));

        expect(mockListTemplates).toHaveBeenCalledWith(
            expect.objectContaining({ search: 'dex' })
        );
    });

    it('passes blockchainType filter to service', async () => {
        mockListTemplates.mockResolvedValue([]);

        await GET(makeRequest({ blockchainType: 'stellar' }));

        expect(mockListTemplates).toHaveBeenCalledWith(
            expect.objectContaining({ blockchainType: 'stellar' })
        );
    });

    it('omits undefined filters (no query params)', async () => {
        mockListTemplates.mockResolvedValue([]);

        await GET(makeRequest());

        const calledWith = mockListTemplates.mock.calls[0][0];
        expect(calledWith).not.toHaveProperty('search');
        expect(calledWith).not.toHaveProperty('category');
    });

    it('returns 500 when service throws', async () => {
        mockListTemplates.mockRejectedValue(new Error('DB connection failed'));

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(500);
        expect(body.error).toMatch(/DB connection failed/);
    });
});
