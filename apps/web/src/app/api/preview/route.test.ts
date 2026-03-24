import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: { id: 'user-123', email: 'test@example.com' } },
                error: null,
            }),
        },
    }),
}));

const validConfig = {
    branding: {
        appName: 'Test DEX',
        primaryColor: '#4f9eff',
        secondaryColor: '#1a1f36',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: true,
        enableAnalytics: false,
        enableNotifications: false,
    },
    stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

const post = (url: string, body: any) =>
    new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

describe('POST /api/preview', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 200 with preview payload for valid config', async () => {
        const res = await POST(post('http://localhost/api/preview', validConfig), {
            params: {},
        });

        expect(res.status).toBe(200);

        const json = await res.json();
        expect(json.customization).toBeDefined();
        expect(json.mockData).toBeDefined();
        expect(json.timestamp).toBeDefined();
    });

    it('returns customization config in payload', async () => {
        const res = await POST(post('http://localhost/api/preview', validConfig), {
            params: {},
        });

        const json = await res.json();
        expect(json.customization.branding.appName).toBe('Test DEX');
        expect(json.customization.stellar.network).toBe('testnet');
    });

    it('returns mock data with account balance', async () => {
        const res = await POST(post('http://localhost/api/preview', validConfig), {
            params: {},
        });

        const json = await res.json();
        expect(json.mockData.accountBalance).toBeDefined();
        expect(typeof json.mockData.accountBalance).toBe('string');
    });

    it('returns mock data with transactions', async () => {
        const res = await POST(post('http://localhost/api/preview', validConfig), {
            params: {},
        });

        const json = await res.json();
        expect(Array.isArray(json.mockData.recentTransactions)).toBe(true);
        expect(json.mockData.recentTransactions.length).toBeGreaterThan(0);
    });

    it('returns mock data with asset prices', async () => {
        const res = await POST(post('http://localhost/api/preview', validConfig), {
            params: {},
        });

        const json = await res.json();
        expect(json.mockData.assetPrices).toBeDefined();
        expect(json.mockData.assetPrices.XLM).toBeDefined();
    });

    it('returns 400 for invalid JSON', async () => {
        const req = new Request('http://localhost/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'invalid json',
        });

        const res = await POST(req, { params: {} });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Invalid JSON');
    });

    it('returns 422 for invalid customization config', async () => {
        const invalidConfig = {
            ...validConfig,
            branding: {
                ...validConfig.branding,
                appName: '', // Empty app name is invalid
            },
        };

        const res = await POST(post('http://localhost/api/preview', invalidConfig), {
            params: {},
        });

        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.error).toBe('Invalid customization config');
        expect(json.details).toBeDefined();
    });

    it('returns 422 for network mismatch', async () => {
        const mismatchedConfig = {
            ...validConfig,
            stellar: {
                network: 'mainnet',
                horizonUrl: 'https://horizon-testnet.stellar.org', // Mismatch
            },
        };

        const res = await POST(post('http://localhost/api/preview', mismatchedConfig), {
            params: {},
        });

        expect(res.status).toBe(422);
        const json = await res.json();
        expect(json.details).toBeDefined();
        expect(json.details[0].code).toBe('HORIZON_NETWORK_MISMATCH');
    });

    it('returns valid ISO timestamp', async () => {
        const res = await POST(post('http://localhost/api/preview', validConfig), {
            params: {},
        });

        const json = await res.json();
        expect(new Date(json.timestamp).toString()).not.toBe('Invalid Date');
    });
});
