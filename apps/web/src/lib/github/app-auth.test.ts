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
});
