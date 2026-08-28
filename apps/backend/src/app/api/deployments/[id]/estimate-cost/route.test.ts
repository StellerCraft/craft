import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: { getUser: mockGetUser },
        from: mockFrom,
    }),
}));

const fakeUser = { id: 'user-123', email: 'test@example.com' };
const params = { id: 'dep-1' };

const mockDeployment = {
    id: 'dep-1',
    user_id: 'user-123',
    customization_config: {
        branding: { appName: 'My DEX', primaryColor: '#000', secondaryColor: '#fff', fontFamily: 'Inter' },
        features: { enableCharts: true, enableTransactionHistory: true, enableAnalytics: false, enableNotifications: false },
        stellar: { network: 'testnet', horizonUrl: 'https://horizon.stellar.org' }
    },
    templates: {
        category: 'dex'
    }
};

const mockProfile = {
    subscription_tier: 'pro'
};

function makeGetRequest(query: string = '') {
    return new NextRequest(`http://localhost/api/deployments/dep-1/estimate-cost${query}`, { method: 'GET' });
}

describe('GET /api/deployments/[id]/estimate-cost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    });

    it('returns 200 with complexity cost estimation for owner', async () => {
        // mock deployments fetch
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    is: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({ data: mockDeployment, error: null })
                    }))
                }))
            }))
        });

        // mock profiles fetch
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({ data: mockProfile, error: null })
                }))
            }))
        });

        const res = await GET(makeGetRequest(), { params });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.deploymentId).toBe('dep-1');
        // pro -> standard (20 base)
        // 2 features -> 5.0
        // vercel compute = 100 + 2 * 50 = 200 -> 2.0
        // soroban = 0
        // total = 27.00
        expect(body.estimatedCost).toBe(27.00);
        expect(body.pricingTier).toBe('standard');
    });

    it('returns 404 if deployment does not belong to owner', async () => {
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    is: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({ data: { ...mockDeployment, user_id: 'other-user' }, error: null })
                    }))
                }))
            }))
        });

        const res = await GET(makeGetRequest(), { params });
        expect(res.status).toBe(404);
    });

    it('returns 400 if sorobanInvocations is not a non-negative number', async () => {
        const res = await GET(makeGetRequest('?sorobanInvocations=abc'), { params });
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('sorobanInvocations');
        expect(body.error).toContain('non-negative number');
    });

    it('returns 400 if vercelComputeUsageSeconds is not a non-negative number', async () => {
        const res = await GET(makeGetRequest('?vercelComputeUsageSeconds=xyz'), { params });
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('vercelComputeUsageSeconds');
        expect(body.error).toContain('non-negative number');
    });

    it('returns 400 if sorobanInvocations is negative', async () => {
        const res = await GET(makeGetRequest('?sorobanInvocations=-5'), { params });
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.error).toContain('sorobanInvocations');
    });

    it('accepts valid positive sorobanInvocations value', async () => {
        // mock deployments fetch
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    is: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({ data: mockDeployment, error: null })
                    }))
                }))
            }))
        });

        // mock profiles fetch
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({ data: mockProfile, error: null })
                }))
            }))
        });

        const res = await GET(makeGetRequest('?sorobanInvocations=1000'), { params });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.estimatedCost).toBeDefined();
    });

    it('accepts valid positive vercelComputeUsageSeconds value', async () => {
        // mock deployments fetch
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    is: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({ data: mockDeployment, error: null })
                    }))
                }))
            }))
        });

        // mock profiles fetch
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({ data: mockProfile, error: null })
                }))
            }))
        });

        const res = await GET(makeGetRequest('?vercelComputeUsageSeconds=3600'), { params });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.estimatedCost).toBeDefined();
    });

    it('accepts both valid parameters', async () => {
        // mock deployments fetch
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    is: vi.fn(() => ({
                        single: vi.fn().mockResolvedValue({ data: mockDeployment, error: null })
                    }))
                }))
            }))
        });

        // mock profiles fetch
        mockFrom.mockReturnValueOnce({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    single: vi.fn().mockResolvedValue({ data: mockProfile, error: null })
                }))
            }))
        });

        const res = await GET(makeGetRequest('?sorobanInvocations=500&vercelComputeUsageSeconds=2000'), { params });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.estimatedCost).toBeDefined();
    });
});
