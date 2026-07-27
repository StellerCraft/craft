import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

vi.mock('next/headers', () => ({
    cookies: () => ({
        get: vi.fn().mockReturnValue(null),
        set: vi.fn(),
        delete: vi.fn(),
    }),
}));

vi.mock('../../../../../lib/supabase/server', () => ({
    createClient: () => ({
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: { id: 'user-123', email: 'test@example.com' } },
                error: null,
            }),
        },
        from: () => ({
            select: () => ({
                eq: () => ({
                    is: () => ({
                        single: async () => ({
                            data: {
                                user_id: 'user-123',
                                customization_config: {
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
                                        contractAddresses: { vault: 'CC123' },
                                    },
                                },
                            },
                            error: null,
                        }),
                    }),
                }),
            }),
        }),
    }),
}));

describe('GET /api/deployments/[id]/estimate-cost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns an estimate for the deployment customization', async () => {
        const mockSupabase = {
            from: vi.fn(() => ({
                select: vi.fn(() => ({
                    eq: vi.fn(() => ({
                        is: vi.fn(() => ({
                            single: vi.fn().mockResolvedValue({
                                data: {
                                    user_id: 'user-123',
                                    customization_config: {
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
                                            contractAddresses: {
                                                vault: 'CC123',
                                            },
                                        },
                                    },
                                },
                                error: null,
                            }),
                        })),
                    })),
                })),
            })),
        };

        const req = new Request('http://localhost/api/deployments/dep-123/estimate-cost?tier=standard');
        const res = await GET(req as any, { params: { id: 'dep-123' }, user: { id: 'user-123' }, supabase: mockSupabase } as any);

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.estimate.complexityScore).toBe(33.5);
        expect(json.estimate.factors.sorobanInvocations).toBe(1);
    });
});
