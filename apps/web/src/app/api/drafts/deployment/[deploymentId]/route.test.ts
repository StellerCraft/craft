import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ auth: { getUser: mockGetUser }, from: vi.fn() }),
}));

const mockGetDraftByDeployment = vi.fn();
vi.mock('@/services/customization-draft.service', () => ({
    customizationDraftService: { getDraftByDeployment: mockGetDraftByDeployment },
}));

const fakeUser = { id: 'user-1', email: 'a@b.com' };
const deploymentId = 'dep-1';

const fakeDraft = {
    id: 'draft-1',
    userId: fakeUser.id,
    templateId: 'tmpl-1',
    customizationConfig: {
        branding: { appName: 'DEX', primaryColor: '#f00', secondaryColor: '#0f0', fontFamily: 'Inter' },
        features: { enableCharts: true, enableTransactionHistory: true, enableAnalytics: false, enableNotifications: false },
        stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
    },
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
};

const makeRequest = () =>
    new NextRequest(`http://localhost/api/drafts/deployment/${deploymentId}`);

const params = { deploymentId };

describe('GET /api/drafts/deployment/[deploymentId]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./route');
        const res = await GET(makeRequest(), { params });
        expect(res.status).toBe(401);
    });

    it('returns 404 when no draft exists', async () => {
        mockGetDraftByDeployment.mockResolvedValue(null);
        const { GET } = await import('./route');
        const res = await GET(makeRequest(), { params });
        expect(res.status).toBe(404);
    });

    it('returns 403 when deployment belongs to another user', async () => {
        mockGetDraftByDeployment.mockRejectedValue(new Error('Forbidden'));
        const { GET } = await import('./route');
        const res = await GET(makeRequest(), { params });
        expect(res.status).toBe(403);
    });

    it('returns the normalized draft on success', async () => {
        mockGetDraftByDeployment.mockResolvedValue(fakeDraft);
        const { GET } = await import('./route');
        const res = await GET(makeRequest(), { params });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe('draft-1');
        expect(body.customizationConfig.branding.appName).toBe('DEX');
        expect(mockGetDraftByDeployment).toHaveBeenCalledWith(fakeUser.id, deploymentId);
    });

    it('returns 500 on unexpected service error', async () => {
        mockGetDraftByDeployment.mockRejectedValue(new Error('DB error'));
        const { GET } = await import('./route');
        const res = await GET(makeRequest(), { params });
        expect(res.status).toBe(500);
    });
});
