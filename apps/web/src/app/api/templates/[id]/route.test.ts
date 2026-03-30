/**
 * Unit tests for GET /api/templates/[id]
 * Feature: write-api-route-tests-for-template-endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

// ── Template service mock ─────────────────────────────────────────────────────

const mockGetTemplate = vi.fn();

vi.mock('@/services/template.service', () => ({
    templateService: { getTemplate: mockGetTemplate },
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

function makeRequest(id: string): [NextRequest, { params: { id: string } }] {
    const req = new NextRequest(`http://localhost/api/templates/${id}`);
    return [req, { params: { id } }];
}

describe('GET /api/templates/[id]', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns a single template with 200', async () => {
        mockGetTemplate.mockResolvedValue(makeTemplate());

        const res = await GET(...makeRequest('tpl-1'));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.id).toBe('tpl-1');
        expect(body.name).toBe('Stellar DEX');
    });

    it('calls service with the correct template ID', async () => {
        mockGetTemplate.mockResolvedValue(makeTemplate({ id: 'tpl-42' }));

        await GET(...makeRequest('tpl-42'));

        expect(mockGetTemplate).toHaveBeenCalledWith('tpl-42');
    });

    it('returns 404 for a non-existent template ID', async () => {
        mockGetTemplate.mockRejectedValue(new Error('Template not found'));

        const res = await GET(...makeRequest('does-not-exist'));
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe('Template not found');
    });

    it('returns 500 for unexpected service errors', async () => {
        mockGetTemplate.mockRejectedValue(new Error('DB timeout'));

        const res = await GET(...makeRequest('tpl-1'));
        const body = await res.json();

        expect(res.status).toBe(500);
        expect(body.error).toMatch(/DB timeout/);
    });
});
