/**
 * Unit tests for GET /api/templates
 *
 * Covers:
 *   - Existing list/filter behaviour (category, search, blockchainType)
 *   - New `q` full-text search parameter
 *   - Combined q + category filter
 *   - Error handling
 *
 * Feature: write-api-route-tests-for-template-endpoints
 * Issue:   feat/template-full-text-search-index
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// ── Template service mock ─────────────────────────────────────────────────────

vi.mock('@/services/template.service', () => ({
    templateService: { listTemplates: vi.fn() },
}));

vi.mock('@/lib/api/cors', () => ({
    handlePreflight: vi.fn(),
}));

import { templateService } from '@/services/template.service';
const mockListTemplates = vi.mocked(templateService.listTemplates);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeTemplate = (overrides: Record<string, any> = {}) => ({
    id: 'tpl-1',
    name: 'Stellar DEX',
    description: 'A DEX template',
    category: 'dex',
    blockchainType: 'stellar',
    tags: ['dex', 'trading'],
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

    // ── Basic list ─────────────────────────────────────────────────────────────

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

    // ── Existing filter params ─────────────────────────────────────────────────

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
        expect(calledWith).not.toHaveProperty('q');
    });

    // ── Full-text search via `q` param ────────────────────────────────────────

    it('passes q filter to service', async () => {
        mockListTemplates.mockResolvedValue([makeTemplate()]);

        await GET(makeRequest({ q: 'decentralized exchange' }));

        expect(mockListTemplates).toHaveBeenCalledWith(
            expect.objectContaining({ q: 'decentralized exchange' })
        );
    });

    it('passes both q and category to service for combined search', async () => {
        mockListTemplates.mockResolvedValue([]);

        await GET(makeRequest({ q: 'liquidity', category: 'lending' }));

        expect(mockListTemplates).toHaveBeenCalledWith(
            expect.objectContaining({ q: 'liquidity', category: 'lending' })
        );
    });

    it('passes phrase query (with quotes) unchanged to service', async () => {
        mockListTemplates.mockResolvedValue([]);

        await GET(makeRequest({ q: '"liquidity pool"' }));

        expect(mockListTemplates).toHaveBeenCalledWith(
            expect.objectContaining({ q: '"liquidity pool"' })
        );
    });

    it('passes prefix query (with colon-asterisk) unchanged to service', async () => {
        mockListTemplates.mockResolvedValue([]);

        await GET(makeRequest({ q: 'decentral:*' }));

        expect(mockListTemplates).toHaveBeenCalledWith(
            expect.objectContaining({ q: 'decentral:*' })
        );
    });

    it('returns search results with tags included', async () => {
        mockListTemplates.mockResolvedValue([
            makeTemplate({ tags: ['dex', 'trading', 'stellar'] }),
        ]);

        const res = await GET(makeRequest({ q: 'stellar' }));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body[0].tags).toEqual(['dex', 'trading', 'stellar']);
    });

    it('q takes precedence — both q and search are forwarded to service', async () => {
        mockListTemplates.mockResolvedValue([]);

        await GET(makeRequest({ q: 'soroban', search: 'legacy' }));

        const calledWith = mockListTemplates.mock.calls[0][0];
        expect(calledWith.q).toBe('soroban');
        expect(calledWith.search).toBe('legacy');
    });

    // ── Error handling ─────────────────────────────────────────────────────────

    it('returns 500 when service throws', async () => {
        mockListTemplates.mockRejectedValue(new Error('DB connection failed'));

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(500);
        expect(body.error).toMatch(/DB connection failed/);
    });

    it('returns 500 with fallback message when error has no message', async () => {
        mockListTemplates.mockRejectedValue({});

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(500);
        expect(body.error).toBe('Failed to list templates');
    });
});
