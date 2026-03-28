import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateStellarEndpoints } from './validate';
import type { CustomizationConfig } from '@craft/types';

// ── Test Setup ───────────────────────────────────────────────────────────────

let fetchMock: typeof global.fetch;

beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as any;
});

afterEach(() => {
    vi.clearAllMocks();
});

// ── Test Config ──────────────────────────────────────────────────────────────

const testConfig: CustomizationConfig = {
    branding: {
        appName: 'Test App',
        primaryColor: '#ff0000',
        secondaryColor: '#00ff00',
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
        sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
    },
};

// ── Mock Helpers ─────────────────────────────────────────────────────────────

function mockFetchSuccess(responseTime: number = 50) {
    return vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, responseTime));
        return {
            ok: true,
            status: 200,
            statusText: 'OK',
        };
    });
}

function mockFetchFailure(status: number = 503, responseTime: number = 50) {
    return vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, responseTime));
        return {
            ok: false,
            status,
            statusText: 'Service Unavailable',
        };
    });
}

function mockFetchTimeout() {
    return vi.fn(
        () =>
            new Promise((_, reject) => {
                setTimeout(
                    () => reject(new DOMException('The operation was aborted.', 'AbortError')),
                    100
                );
            })
    );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('validateStellarEndpoints', () => {
    describe('successful endpoint checks', () => {
        it('returns valid when both endpoints are reachable', async () => {
            global.fetch = mockFetchSuccess();

            const result = await validateStellarEndpoints(testConfig);

            expect(result.valid).toBe(true);
            expect(result.horizon.reachable).toBe(true);
            expect(result.sorobanRpc?.reachable).toBe(true);
            expect(result.errors).toBeUndefined();
        });

        it('returns valid when only Horizon is configured and reachable', async () => {
            global.fetch = mockFetchSuccess();

            const config = { ...testConfig, stellar: { ...testConfig.stellar, sorobanRpcUrl: undefined } };
            const result = await validateStellarEndpoints(config);

            expect(result.valid).toBe(true);
            expect(result.horizon.reachable).toBe(true);
            expect(result.sorobanRpc).toBeUndefined();
        });

        it('includes response time metrics', async () => {
            global.fetch = mockFetchSuccess(100);

            const result = await validateStellarEndpoints(testConfig);

            expect(result.horizon.responseTime).toBeGreaterThanOrEqual(100);
        });
    });

    describe('Horizon endpoint failures', () => {
        it('returns invalid when Horizon is unreachable (transient error)', async () => {
            let callCount = 0;
            global.fetch = vi.fn(async () => {
                callCount++;
                if (callCount === 1) {
                    return { ok: false, status: 503 };
                }
                return { ok: false, status: 503 };
            });

            const result = await validateStellarEndpoints(testConfig);

            expect(result.valid).toBe(false);
            expect(result.horizon.reachable).toBe(false);
            expect(result.horizon.errorType).toBe('TRANSIENT');
            expect(result.errors).toBeDefined();
            expect(result.errors?.[0].field).toBe('stellar.horizonUrl');
            expect(result.errors?.[0].code).toBe('HORIZON_TRANSIENT_ERROR');
            expect(result.errors?.[0].message).toContain('temporarily unreachable');
        });

        it('returns CONFIGURATION error for 404 on Horizon', async () => {
            let callCount = 0;
            global.fetch = vi.fn(async () => {
                callCount++;
                if (callCount === 1) {
                    return { ok: false, status: 404 };
                }
                return { ok: false, status: 503 };
            });

            const result = await validateStellarEndpoints(testConfig);

            expect(result.valid).toBe(false);
            expect(result.horizon.errorType).toBe('CONFIGURATION');
            expect(result.errors?.[0].code).toBe('HORIZON_CONFIGURATION_ERROR');
            expect(result.errors?.[0].message).toContain('not reachable');
        });

        it('returns VALIDATION error for invalid Horizon URL format', async () => {
            const config = { ...testConfig, stellar: { ...testConfig.stellar, horizonUrl: 'invalid-url' } };
            const result = await validateStellarEndpoints(config);

            expect(result.valid).toBe(false);
            expect(result.horizon.reachable).toBe(false);
            expect(result.horizon.errorType).toBe('VALIDATION');
            expect(result.errors?.[0].code).toBe('HORIZON_VALIDATION_ERROR');
        });

        it('does not call fetch for invalid Horizon URL', async () => {
            const config = { ...testConfig, stellar: { ...testConfig.stellar, horizonUrl: 'invalid' } };
            await validateStellarEndpoints(config);

            // Fetch shouldn't be called (or only called once for Soroban after Horizon validation fails)
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('Soroban RPC endpoint failures', () => {
        it('returns invalid when Soroban RPC is unreachable (transient)', async () => {
            let callCount = 0;
            global.fetch = vi.fn(async () => {
                callCount++;
                if (callCount === 1) {
                    return { ok: true, status: 200 }; // Horizon OK
                }
                return { ok: false, status: 503 }; // Soroban RPC fails
            });

            const result = await validateStellarEndpoints(testConfig);

            expect(result.valid).toBe(false);
            expect(result.horizon.reachable).toBe(true);
            expect(result.sorobanRpc?.reachable).toBe(false);
            expect(result.sorobanRpc?.errorType).toBe('TRANSIENT');
            expect(result.errors).toBeDefined();
            expect(result.errors?.length).toBe(1);
            expect(result.errors?.[0].field).toBe('stellar.sorobanRpcUrl');
            expect(result.errors?.[0].code).toBe('SOROBAN_TRANSIENT_ERROR');
        });

        it('returns CONFIGURATION error for 404 on Soroban RPC', async () => {
            let callCount = 0;
            global.fetch = vi.fn(async () => {
                callCount++;
                if (callCount === 1) {
                    return { ok: true, status: 200 };
                }
                return { ok: false, status: 404 };
            });

            const result = await validateStellarEndpoints(testConfig);

            expect(result.valid).toBe(false);
            expect(result.sorobanRpc?.errorType).toBe('CONFIGURATION');
            expect(result.errors?.[0].code).toBe('SOROBAN_CONFIGURATION_ERROR');
        });
    });

    describe('multiple endpoint failures', () => {
        it('returns errors for both Horizon and Soroban when both fail', async () => {
            global.fetch = mockFetchFailure(503);

            const result = await validateStellarEndpoints(testConfig);

            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors?.length).toBe(2);
            expect(result.errors?.[0].field).toBe('stellar.horizonUrl');
            expect(result.errors?.[1].field).toBe('stellar.sorobanRpcUrl');
        });
    });

    describe('timeout handling', () => {
        it('respects custom timeout option', async () => {
            global.fetch = mockFetchTimeout();

            const result = await validateStellarEndpoints(testConfig, { timeout: 200 });

            expect(result.valid).toBe(false);
            expect(result.horizon.errorType).toBe('TRANSIENT');
        });
    });

    describe('endpoint URLs in results', () => {
        it('includes Horizon URL in result', async () => {
            global.fetch = mockFetchSuccess();

            const result = await validateStellarEndpoints(testConfig);

            expect(result.horizon.endpoint).toBe('https://horizon-testnet.stellar.org');
        });

        it('includes Soroban RPC URL in result', async () => {
            global.fetch = mockFetchSuccess();

            const result = await validateStellarEndpoints(testConfig);

            expect(result.sorobanRpc?.endpoint).toBe('https://soroban-testnet.stellar.org');
        });
    });

    describe('error differentiation', () => {
        it('clearly distinguishes transient errors for retry guidance', async () => {
            global.fetch = mockFetchFailure(503);

            const result = await validateStellarEndpoints(testConfig);

            expect(result.errors?.[0].message).toContain('temporarily unreachable');
            expect(result.errors?.[0].message).toContain('retry');
        });

        it('provides actionable guidance for configuration errors', async () => {
            let callCount = 0;
            global.fetch = vi.fn(async () => {
                callCount++;
                if (callCount === 1) {
                    return { ok: false, status: 404 };
                }
                return { ok: true, status: 200 };
            });

            const result = await validateStellarEndpoints(testConfig);

            expect(result.errors?.[0].message).toContain('Check configuration');
        });
    });
});
