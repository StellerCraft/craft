import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

// ── Service mock ──────────────────────────────────────────────────────────────
const mockSaveDraft = vi.fn();
const mockGetDraft = vi.fn();

vi.mock('@/services/customization-draft.service', () => ({
    customizationDraftService: {
        saveDraft: mockSaveDraft,
        getDraft: mockGetDraft,
    },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const fakeUser = { id: 'user-1', email: 'a@b.com' };
const templateId = 'tmpl-1';

const validConfig = {
    branding: {
        appName: 'My DEX',
        primaryColor: '#000',
        secondaryColor: '#fff',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: false,
        enableAnalytics: true,
        enableNotifications: false,
    },
    stellar: {
        network: 'testnet' as const,
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

const fakeDraft = {
    id: 'draft-1',
    userId: fakeUser.id,
    templateId,
    customizationConfig: validConfig,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
};

const makeRequest = (method: string, body?: unknown) =>
    new NextRequest(`http://localhost/api/drafts/${templateId}`, {
        method,
        ...(body !== undefined
            ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
            : {}),
    });

const params = { templateId };

// ── GET /api/drafts/[templateId] ──────────────────────────────────────────────
describe('GET /api/drafts/[templateId]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('./route');
        const res = await GET(makeRequest('GET'), { params });
        expect(res.status).toBe(401);
    });

    it('returns 404 when no draft exists', async () => {
        mockGetDraft.mockResolvedValue(null);
        const { GET } = await import('./route');
        const res = await GET(makeRequest('GET'), { params });
        expect(res.status).toBe(404);
    });

    it('returns the draft when it exists', async () => {
        mockGetDraft.mockResolvedValue(fakeDraft);
        const { GET } = await import('./route');
        const res = await GET(makeRequest('GET'), { params });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe('draft-1');
        expect(body.templateId).toBe(templateId);
    });

    it('returns 500 on service error', async () => {
        mockGetDraft.mockRejectedValue(new Error('DB error'));
        const { GET } = await import('./route');
        const res = await GET(makeRequest('GET'), { params });
        expect(res.status).toBe(500);
    });
});

// ── POST /api/drafts/[templateId] ─────────────────────────────────────────────
describe('POST /api/drafts/[templateId]', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 401 when unauthenticated', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
        const { POST } = await import('./route');
        const res = await POST(makeRequest('POST', validConfig), { params });
        expect(res.status).toBe(401);
    });

    it('returns 400 for invalid JSON', async () => {
        const { POST } = await import('./route');
        const req = new NextRequest(`http://localhost/api/drafts/${templateId}`, {
            method: 'POST',
            body: 'not-json',
            headers: { 'Content-Type': 'application/json' },
        });
        const res = await POST(req, { params });
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid config shape', async () => {
        const { POST } = await import('./route');
        const res = await POST(makeRequest('POST', { branding: {} }), { params });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.details).toBeDefined();
    });

    it('returns 404 when template does not exist', async () => {
        mockSaveDraft.mockRejectedValue(new Error('Template not found'));
        const { POST } = await import('./route');
        const res = await POST(makeRequest('POST', validConfig), { params });
        expect(res.status).toBe(404);
    });

    it('saves and returns the draft on valid input', async () => {
        mockSaveDraft.mockResolvedValue(fakeDraft);
        const { POST } = await import('./route');
        const res = await POST(makeRequest('POST', validConfig), { params });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe('draft-1');
        expect(body.updatedAt).toBeDefined();
        expect(mockSaveDraft).toHaveBeenCalledWith(fakeUser.id, templateId, validConfig);
    });

    it('overwrites an existing draft (upsert)', async () => {
        const updated = { ...fakeDraft, updatedAt: new Date('2026-03-24') };
        mockSaveDraft.mockResolvedValue(updated);
        const { POST } = await import('./route');
        const res = await POST(makeRequest('POST', validConfig), { params });
        expect(res.status).toBe(200);
        // saveDraft called once — upsert is handled inside the service
        expect(mockSaveDraft).toHaveBeenCalledOnce();
    });
});
