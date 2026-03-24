import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    checkHorizonEndpoint,
    checkSorobanRpcEndpoint,
    checkStellarEndpoints,
    type ConnectivityCheckResult,
} from './endpoint-connectivity';

// ── Test Setup ───────────────────────────────────────────────────────────────

let fetchMock: typeof global.fetch;

beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as any;
});

afterEach(() => {
    vi.clearAllMocks();
});

// ── Mock Helpers ─────────────────────────────────────────────────────────────

function mockFetchSuccess(status: number = 200, responseTime: number = 50) {
    return vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, responseTime));
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: 'OK',
        };
    });
}

function mockFetchError(message: string) {
    return vi.fn(async () => {
        throw new Error(message);
    });
}

function mockFetchTimeout(timeout: number = 5000) {
    return vi.fn(
        () =>
            new Promise((_, reject) => {
                const err = new DOMException('The operation was aborted.', 'AbortError');
                setTimeout(() => reject(err), timeout);
            })
    );
}

// ── Horizon Endpoint Tests ───────────────────────────────────────────────────

describe('checkHorizonEndpoint', () => {
    describe('valid endpoints', () => {
        it('returns reachable=true for successful response', async () => {
            global.fetch = mockFetchSuccess(200);

            const result = await checkHorizonEndpoint('https://horizon-testnet.stellar.org');

            expect(result.reachable).toBe(true);
            expect(result.endpoint).toBe('https://horizon-testnet.stellar.org');
            expect(result.status).toBe(200);
            expect(result.errorType).toBeUndefined();
            expect(result.error).toBeUndefined();
        });

        it('captures response time', async () => {
            global.fetch = mockFetchSuccess(200, 100);

            const result = await checkHorizonEndpoint('https://horizon.stellar.org');

            expect(result.reachable).toBe(true);
            expect(result.responseTime).toBeGreaterThanOrEqual(100);
        });

        it('calls fetch with correct method and headers', async () => {
            global.fetch = mockFetchSuccess(200);

            await checkHorizonEndpoint('https://horizon-testnet.stellar.org');

            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('horizon-testnet.stellar.org'),
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        Accept: 'application/json',
                    }),
                })
            );
        });
    });

    describe('validation errors', () => {
        it('returns VALIDATION error for invalid URL format', async () => {
            const result = await checkHorizonEndpoint('not-a-url');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('VALIDATION');
            expect(result.error).toContain('Invalid Horizon URL format');
        });

        it('does not call fetch for invalid URL', async () => {
            await checkHorizonEndpoint('invalid://url');

            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('transient errors', () => {
        it('returns TRANSIENT for timeout', async () => {
            global.fetch = vi.fn(
                () =>
                    new Promise((_, reject) => {
                        const err = new DOMException('Aborted', 'AbortError');
                        setTimeout(() => reject(err), 10);
                    })
            );

            const result = await checkHorizonEndpoint('https://horizon.stellar.org', { timeout: 100 });

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('TRANSIENT');
            expect(result.error).toContain('Timeout');
        });

        it('returns TRANSIENT for 408 (Request Timeout)', async () => {
            global.fetch = mockFetchSuccess(408);

            const result = await checkHorizonEndpoint('https://horizon.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('TRANSIENT');
            expect(result.status).toBe(408);
        });

        it('returns TRANSIENT for 429 (Too Many Requests)', async () => {
            global.fetch = mockFetchSuccess(429);

            const result = await checkHorizonEndpoint('https://horizon.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('TRANSIENT');
            expect(result.status).toBe(429);
        });

        it('returns TRANSIENT for 503 (Service Unavailable)', async () => {
            global.fetch = mockFetchSuccess(503);

            const result = await checkHorizonEndpoint('https://horizon.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('TRANSIENT');
            expect(result.status).toBe(503);
        });

        it('returns TRANSIENT for 504 (Gateway Timeout)', async () => {
            global.fetch = mockFetchSuccess(504);

            const result = await checkHorizonEndpoint('https://horizon.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('TRANSIENT');
            expect(result.status).toBe(504);
        });

        it('returns TRANSIENT for network errors', async () => {
            global.fetch = mockFetchError('ECONNREFUSED');

            const result = await checkHorizonEndpoint('https://horizon.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('TRANSIENT');
        });
    });

    describe('configuration errors', () => {
        it('returns CONFIGURATION for 404 (Not Found)', async () => {
            global.fetch = mockFetchSuccess(404);

            const result = await checkHorizonEndpoint('https://wrong.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('CONFIGURATION');
            expect(result.status).toBe(404);
        });

        it('returns CONFIGURATION for 401 (Unauthorized)', async () => {
            global.fetch = mockFetchSuccess(401);

            const result = await checkHorizonEndpoint('https://protected.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('CONFIGURATION');
            expect(result.status).toBe(401);
        });

        it('returns CONFIGURATION for 403 (Forbidden)', async () => {
            global.fetch = mockFetchSuccess(403);

            const result = await checkHorizonEndpoint('https://denied.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('CONFIGURATION');
            expect(result.status).toBe(403);
        });
    });

    describe('timeout handling', () => {
        it('respects custom timeout value', async () => {
            const timeoutMs = 1000;
            global.fetch = vi.fn(
                () =>
                    new Promise((_, reject) => {
                        setTimeout(
                            () => reject(new DOMException('Aborted', 'AbortError')),
                            timeoutMs + 100
                        );
                    })
            );

            const result = await checkHorizonEndpoint('https://horizon.stellar.org', {
                timeout: timeoutMs,
            });

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('TRANSIENT');
        });
    });
});

// ── Soroban RPC Endpoint Tests ───────────────────────────────────────────────

describe('checkSorobanRpcEndpoint', () => {
    describe('valid endpoints', () => {
        it('returns reachable=true for successful response', async () => {
            global.fetch = mockFetchSuccess(200);

            const result = await checkSorobanRpcEndpoint('https://soroban-testnet.stellar.org');

            expect(result.reachable).toBe(true);
            expect(result.endpoint).toBe('https://soroban-testnet.stellar.org');
            expect(result.status).toBe(200);
        });

        it('sends JSON-RPC getNetwork request', async () => {
            global.fetch = mockFetchSuccess(200);

            await checkSorobanRpcEndpoint('https://soroban-testnet.stellar.org');

            const callArgs = (global.fetch as any).mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            expect(body).toEqual({
                jsonrpc: '2.0',
                id: 'craft-health-check',
                method: 'getNetwork',
                params: [],
            });
        });
    });

    describe('validation errors', () => {
        it('returns VALIDATION error for invalid URL format', async () => {
            const result = await checkSorobanRpcEndpoint('not-a-rpc-url');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('VALIDATION');
            expect(result.error).toContain('Invalid Soroban RPC URL format');
        });
    });

    describe('error handling', () => {
        it('returns TRANSIENT for 503', async () => {
            global.fetch = mockFetchSuccess(503);

            const result = await checkSorobanRpcEndpoint('https://soroban-testnet.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('TRANSIENT');
        });

        it('returns CONFIGURATION for 404', async () => {
            global.fetch = mockFetchSuccess(404);

            const result = await checkSorobanRpcEndpoint('https://wrong.stellar.org');

            expect(result.reachable).toBe(false);
            expect(result.errorType).toBe('CONFIGURATION');
        });
    });
});

// ── Combined Endpoint Checks ─────────────────────────────────────────────────

describe('checkStellarEndpoints', () => {
    it('checks both Horizon and Soroban RPC when both provided', async () => {
        global.fetch = mockFetchSuccess(200);

        const results = await checkStellarEndpoints(
            'https://horizon-testnet.stellar.org',
            'https://soroban-testnet.stellar.org'
        );

        expect(results).toHaveLength(2);
        expect(results[0].endpoint).toBe('https://horizon-testnet.stellar.org');
        expect(results[1].endpoint).toBe('https://soroban-testnet.stellar.org');
        expect(results[0].reachable).toBe(true);
        expect(results[1].reachable).toBe(true);
    });

    it('checks only Horizon when Soroban URL not provided', async () => {
        global.fetch = mockFetchSuccess(200);

        const results = await checkStellarEndpoints('https://horizon-testnet.stellar.org');

        expect(results).toHaveLength(1);
        expect(results[0].endpoint).toBe('https://horizon-testnet.stellar.org');
    });

    it('returns both successful and failed checks', async () => {
        let callCount = 0;
        global.fetch = vi.fn(async () => {
            callCount++;
            if (callCount === 1) {
                return { ok: true, status: 200 };
            }
            return { ok: false, status: 503 };
        });

        const results = await checkStellarEndpoints(
            'https://horizon-testnet.stellar.org',
            'https://soroban-testnet.stellar.org'
        );

        expect(results[0].reachable).toBe(true);
        expect(results[1].reachable).toBe(false);
        expect(results[1].errorType).toBe('TRANSIENT');
    });

    it('respects custom timeout for all endpoints', async () => {
        global.fetch = mockFetchSuccess(200);

        await checkStellarEndpoints(
            'https://horizon-testnet.stellar.org',
            'https://soroban-testnet.stellar.org',
            { timeout: 3000 }
        );

        expect(global.fetch).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                signal: expect.any(AbortSignal),
            })
        );
    });
});

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe('Endpoint checks — Edge Cases', () => {
    it('handles URL with trailing slash', async () => {
        global.fetch = mockFetchSuccess(200);

        const result = await checkHorizonEndpoint('https://horizon-testnet.stellar.org/');

        expect(result.reachable).toBe(true);
    });

    it('handles URL without protocol', async () => {
        const result = await checkHorizonEndpoint('horizon-testnet.stellar.org');

        expect(result.reachable).toBe(false);
        expect(result.errorType).toBe('VALIDATION');
    });

    it('preserves endpoint URL in result even on failure', async () => {
        global.fetch = mockFetchSuccess(503);

        const result = await checkHorizonEndpoint('https://horizon-testnet.stellar.org');

        expect(result.endpoint).toBe('https://horizon-testnet.stellar.org');
    });

    it('includes error message for network failures', async () => {
        global.fetch = mockFetchError('Network error');

        const result = await checkHorizonEndpoint('https://horizon-testnet.stellar.org');

        expect(result.error).toBeDefined();
    });
});
