import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { GitHubAppAuthClient, GitHubAppAuthError } from './app-auth';
import type { GitHubAppConfig } from './config';

const TEST_PRIVATE_KEY = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
    },
    publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
    },
}).privateKey;

const baseConfig: GitHubAppConfig = {
    appId: 12345,
    installationId: 67890,
    privateKey: TEST_PRIVATE_KEY,
    apiBaseUrl: 'https://api.github.com',
};

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('GitHubAppAuthClient', () => {
    it('reuses cached installation token when token is outside expiry skew', async () => {
        const fetchFn = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse(201, {
                    token: 'token-one',
                    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
                })
            );

        const client = new GitHubAppAuthClient({
            config: baseConfig,
            fetchFn,
            tokenSkewMs: 60_000,
        });

        const first = await client.getInstallationAuthContext();
        const second = await client.getInstallationAuthContext();

        expect(first.token).toBe('token-one');
        expect(second.token).toBe('token-one');
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('refreshes token when cached token is near expiry', async () => {
        const fetchFn = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse(201, {
                    token: 'token-near-expiry',
                    expires_at: new Date(Date.now() + 30_000).toISOString(),
                })
            )
            .mockResolvedValueOnce(
                jsonResponse(201, {
                    token: 'token-refreshed',
                    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
                })
            );

        const client = new GitHubAppAuthClient({
            config: baseConfig,
            fetchFn,
            tokenSkewMs: 60_000,
        });

        const first = await client.getInstallationAuthContext();
        const second = await client.getInstallationAuthContext();

        expect(first.token).toBe('token-near-expiry');
        expect(second.token).toBe('token-refreshed');
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('forces token refresh and retries once when api request returns 401', async () => {
        const fetchFn = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse(201, {
                    token: 'token-old',
                    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
                })
            )
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(
                jsonResponse(201, {
                    token: 'token-new',
                    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
                })
            )
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

        const client = new GitHubAppAuthClient({ config: baseConfig, fetchFn });

        const response = await client.requestWithInstallationAuth('/app');

        expect(response.status).toBe(200);
        expect(fetchFn).toHaveBeenCalledTimes(4);

        const retryCall = fetchFn.mock.calls[3];
        const headers = new Headers((retryCall[1] as RequestInit).headers);
        expect(headers.get('Authorization')).toBe('Bearer token-new');
    });

    it('maps 429 token endpoint responses to RATE_LIMITED errors', async () => {
        const fetchFn = vi.fn().mockResolvedValueOnce(
            jsonResponse(429, { message: 'secondary rate limit' })
        );

        const client = new GitHubAppAuthClient({ config: baseConfig, fetchFn });

        await expect(client.getInstallationAuthContext()).rejects.toMatchObject({
            name: 'GitHubAppAuthError',
            code: 'RATE_LIMITED',
            status: 429,
            retryable: true,
        } satisfies Partial<GitHubAppAuthError>);
    });

    it('deduplicates concurrent getInstallationAuthContext calls against a cold cache', async () => {
        // fetchFn is set up to resolve only once — if called more than once the
        // second call would hang (no additional mock value), surfacing the bug.
        const fetchFn = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse(201, {
                    token: 'token-deduped',
                    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
                }),
            );

        const client = new GitHubAppAuthClient({ config: baseConfig, fetchFn });

        // Fire 5 concurrent calls against an empty cache
        const results = await Promise.all([
            client.getInstallationAuthContext(),
            client.getInstallationAuthContext(),
            client.getInstallationAuthContext(),
            client.getInstallationAuthContext(),
            client.getInstallationAuthContext(),
        ]);

        // fetchFn must have been called exactly once — all 5 callers shared the in-flight request
        expect(fetchFn).toHaveBeenCalledTimes(1);

        // All callers must have received the same token
        for (const ctx of results) {
            expect(ctx.token).toBe('token-deduped');
        }
    });

    it('forceRefresh: true bypasses deduplication and starts its own fresh fetch', async () => {
        const fetchFn = vi
            .fn()
            // First call: primes the cache
            .mockResolvedValueOnce(
                jsonResponse(201, {
                    token: 'token-cached',
                    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
                }),
            )
            // Second call: forced refresh
            .mockResolvedValueOnce(
                jsonResponse(201, {
                    token: 'token-forced',
                    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
                }),
            );

        const client = new GitHubAppAuthClient({ config: baseConfig, fetchFn });

        // Prime the cache
        const cached = await client.getInstallationAuthContext();
        expect(cached.token).toBe('token-cached');

        // forceRefresh must bypass the cached token and issue a new fetch
        const forced = await client.getInstallationAuthContext({ forceRefresh: true });
        expect(forced.token).toBe('token-forced');
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });
});
