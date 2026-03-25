import { createSign } from 'node:crypto';
import type {
    GitHubAppAuthErrorCode,
    GitHubAppAuthErrorShape,
    GitHubInstallationAuthContext,
} from '@craft/types';
import { getGitHubAppConfig, type GitHubAppConfig } from './config';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface CachedInstallationToken {
    token: string;
    expiresAt: Date;
}

interface TokenResponse {
    token: string;
    expires_at: string;
}

export interface GitHubAppAuthClientOptions {
    config?: GitHubAppConfig;
    fetchFn?: FetchFn;
    now?: () => number;
    tokenSkewMs?: number;
}

const DEFAULT_TOKEN_SKEW_MS = 60_000;

export class GitHubAppAuthError extends Error implements GitHubAppAuthErrorShape {
    readonly code: GitHubAppAuthErrorCode;
    readonly status?: number;
    readonly retryable: boolean;

    constructor(params: {
        code: GitHubAppAuthErrorCode;
        message: string;
        retryable: boolean;
        status?: number;
    }) {
        super(params.message);
        this.name = 'GitHubAppAuthError';
        this.code = params.code;
        this.status = params.status;
        this.retryable = params.retryable;
    }
}

export class GitHubAppAuthClient {
    private readonly config: GitHubAppConfig;
    private readonly fetchFn: FetchFn;
    private readonly now: () => number;
    private readonly tokenSkewMs: number;
    private readonly cache = new Map<number, CachedInstallationToken>();

    constructor(options: GitHubAppAuthClientOptions = {}) {
        this.config = options.config ?? getGitHubAppConfig();
        this.fetchFn = options.fetchFn ?? fetch;
        this.now = options.now ?? Date.now;
        this.tokenSkewMs = options.tokenSkewMs ?? DEFAULT_TOKEN_SKEW_MS;
    }

    async getInstallationAuthContext(params: { forceRefresh?: boolean } = {}): Promise<GitHubInstallationAuthContext> {
        const forceRefresh = params.forceRefresh ?? false;
        const cached = this.cache.get(this.config.installationId);

        if (!forceRefresh && cached && !this.isNearExpiry(cached.expiresAt)) {
            return this.toAuthContext(cached);
        }

        const refreshed = await this.fetchInstallationToken();
        this.cache.set(this.config.installationId, refreshed);

        return this.toAuthContext(refreshed);
    }

    invalidateCachedToken(): void {
        this.cache.delete(this.config.installationId);
    }

    async requestWithInstallationAuth(input: string, init: RequestInit = {}): Promise<Response> {
        const auth = await this.getInstallationAuthContext();
        const firstResponse = await this.fetchFn(this.resolveUrl(input), {
            ...init,
            headers: this.mergeHeaders(init.headers, auth.authorizationHeader),
        });

        if (firstResponse.status !== 401) {
            return firstResponse;
        }

        this.invalidateCachedToken();

        const refreshedAuth = await this.getInstallationAuthContext({ forceRefresh: true });
        return this.fetchFn(this.resolveUrl(input), {
            ...init,
            headers: this.mergeHeaders(init.headers, refreshedAuth.authorizationHeader),
        });
    }

    private resolveUrl(input: string): string {
        if (input.startsWith('http://') || input.startsWith('https://')) {
            return input;
        }

        const normalizedPath = input.startsWith('/') ? input : `/${input}`;
        return `${this.config.apiBaseUrl}${normalizedPath}`;
    }

    private isNearExpiry(expiresAt: Date): boolean {
        return expiresAt.getTime() - this.now() <= this.tokenSkewMs;
    }

    private toAuthContext(token: CachedInstallationToken): GitHubInstallationAuthContext {
        return {
            token: token.token,
            expiresAt: token.expiresAt,
            authorizationHeader: `Bearer ${token.token}`,
            installationId: this.config.installationId,
        };
    }

    private mergeHeaders(existing: HeadersInit | undefined, authorizationHeader: string): Headers {
        const headers = new Headers(existing);
        headers.set('Accept', 'application/vnd.github+json');
        headers.set('X-GitHub-Api-Version', '2022-11-28');
        headers.set('Authorization', authorizationHeader);
        return headers;
    }

    private async fetchInstallationToken(): Promise<CachedInstallationToken> {
        const appJwt = this.generateAppJwt();
        const url = `${this.config.apiBaseUrl}/app/installations/${this.config.installationId}/access_tokens`;

        let response: Response;

        try {
            response = await this.fetchFn(url, {
                method: 'POST',
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `Bearer ${appJwt}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            });
        } catch (error: unknown) {
            throw new GitHubAppAuthError({
                code: 'NETWORK_ERROR',
                message: 'Unable to reach GitHub token endpoint',
                retryable: true,
            });
        }

        if (!response.ok) {
            throw await this.buildHttpError(response);
        }

        const payload = (await response.json()) as TokenResponse;
        if (!payload.token || !payload.expires_at) {
            throw new GitHubAppAuthError({
                code: 'INVALID_RESPONSE',
                message: 'GitHub token response missing required fields',
                retryable: false,
                status: response.status,
            });
        }

        const expiresAt = new Date(payload.expires_at);
        if (Number.isNaN(expiresAt.getTime())) {
            throw new GitHubAppAuthError({
                code: 'INVALID_RESPONSE',
                message: 'GitHub token response contains invalid expires_at value',
                retryable: false,
                status: response.status,
            });
        }

        return {
            token: payload.token,
            expiresAt,
        };
    }

    private async buildHttpError(response: Response): Promise<GitHubAppAuthError> {
        const message = await this.extractErrorMessage(response);

        if (response.status === 401 || response.status === 403) {
            return new GitHubAppAuthError({
                code: 'AUTHENTICATION_ERROR',
                message,
                retryable: false,
                status: response.status,
            });
        }

        if (response.status === 429) {
            return new GitHubAppAuthError({
                code: 'RATE_LIMITED',
                message,
                retryable: true,
                status: response.status,
            });
        }

        if (response.status >= 500) {
            return new GitHubAppAuthError({
                code: 'UPSTREAM_ERROR',
                message,
                retryable: true,
                status: response.status,
            });
        }

        return new GitHubAppAuthError({
            code: 'REQUEST_ERROR',
            message,
            retryable: false,
            status: response.status,
        });
    }

    private async extractErrorMessage(response: Response): Promise<string> {
        const fallback = `GitHub token request failed with status ${response.status}`;

        try {
            const data = await response.json() as { message?: string };
            if (data?.message) {
                return data.message;
            }
            return fallback;
        } catch {
            return fallback;
        }
    }

    private generateAppJwt(): string {
        const nowInSeconds = Math.floor(this.now() / 1000);
        const header = { alg: 'RS256', typ: 'JWT' };
        const payload = {
            iat: nowInSeconds - 60,
            exp: nowInSeconds + 9 * 60,
            iss: this.config.appId,
        };

        const unsigned = `${this.base64urlJson(header)}.${this.base64urlJson(payload)}`;
        const signer = createSign('RSA-SHA256');
        signer.update(unsigned);
        signer.end();

        const signature = signer.sign(this.config.privateKey).toString('base64url');
        return `${unsigned}.${signature}`;
    }

    private base64urlJson(input: unknown): string {
        return Buffer.from(JSON.stringify(input)).toString('base64url');
    }
}

let gitHubAppAuthClientInstance: GitHubAppAuthClient | null = null;

export function getGitHubAppAuthClient(): GitHubAppAuthClient {
    if (!gitHubAppAuthClientInstance) {
        gitHubAppAuthClientInstance = new GitHubAppAuthClient();
    }

    return gitHubAppAuthClientInstance;
}
