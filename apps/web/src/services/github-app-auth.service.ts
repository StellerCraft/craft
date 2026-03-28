import type { GitHubInstallationAuthContext } from '@craft/types';
import {
    GitHubAppAuthClient,
    getGitHubAppAuthClient,
} from '@/lib/github/app-auth';

export interface GitHubRepositoryAuthClient {
    getAuthContext(params?: { forceRefresh?: boolean }): Promise<GitHubInstallationAuthContext>;
    requestWithAuth(input: string, init?: RequestInit): Promise<Response>;
    invalidateToken(): void;
}

export class GitHubAppAuthService implements GitHubRepositoryAuthClient {
    private readonly authClient: GitHubAppAuthClient;

    constructor(authClient?: GitHubAppAuthClient) {
        this.authClient = authClient ?? getGitHubAppAuthClient();
    }

    async getAuthContext(params: { forceRefresh?: boolean } = {}): Promise<GitHubInstallationAuthContext> {
        return this.authClient.getInstallationAuthContext(params);
    }

    async requestWithAuth(input: string, init: RequestInit = {}): Promise<Response> {
        return this.authClient.requestWithInstallationAuth(input, init);
    }

    invalidateToken(): void {
        this.authClient.invalidateCachedToken();
    }
}

let gitHubAppAuthServiceInstance: GitHubAppAuthService | null = null;

export function getGitHubAppAuthService(): GitHubAppAuthService {
    if (!gitHubAppAuthServiceInstance) {
        gitHubAppAuthServiceInstance = new GitHubAppAuthService();
    }

    return gitHubAppAuthServiceInstance;
}

export const gitHubAppAuthService: GitHubRepositoryAuthClient = new Proxy(
    {} as GitHubRepositoryAuthClient,
    {
        get(_target, prop) {
            const service = getGitHubAppAuthService();
            return (service as any)[prop];
        },
    }
);
