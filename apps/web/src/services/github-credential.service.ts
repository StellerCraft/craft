/**
 * GitHubCredentialService
 *
 * Validates and refreshes GitHub credentials before protected operations.
 *
 * Strategy:
 *   1. Read the stored token + expiry metadata from the profiles row.
 *   2. If the token is absent → throw GitHubCredentialError('NOT_CONNECTED').
 *   3. If a known expiry exists and is within EXPIRY_BUFFER_MS → treat as
 *      expired and throw GitHubCredentialError('TOKEN_EXPIRED').
 *   4. Probe the GitHub API (/user) to confirm the token is still accepted.
 *      - 200 → update github_token_refreshed_at atomically and return the token.
 *      - 401 → throw GitHubCredentialError('TOKEN_INVALID').
 *      - network/other → throw GitHubCredentialError('VALIDATION_FAILED').
 *
 * The service does NOT rotate or re-issue tokens — that requires an OAuth
 * refresh flow outside this scope. It surfaces a typed error so callers can
 * redirect the user to re-authorise.
 *
 * Atomic update:
 *   github_token_refreshed_at is written in a single UPDATE so concurrent
 *   requests racing through this check all converge on the same row state.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const GITHUB_API_BASE = 'https://api.github.com';

/** How many milliseconds before the stated expiry we treat the token as expired. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export type GitHubCredentialErrorCode =
    | 'NOT_CONNECTED'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_INVALID'
    | 'VALIDATION_FAILED';

export class GitHubCredentialError extends Error {
    constructor(
        message: string,
        public readonly code: GitHubCredentialErrorCode,
    ) {
        super(message);
        this.name = 'GitHubCredentialError';
    }
}

interface CredentialRow {
    github_token_encrypted: string | null;
    github_token_expires_at: string | null;
}

interface FetchLike {
    (input: string, init?: RequestInit): Promise<Response>;
}

export class GitHubCredentialService {
    constructor(
        private readonly _supabase: SupabaseClient,
        private readonly _fetch: FetchLike = fetch,
    ) {}

    /**
     * Validates the stored GitHub token for `userId`.
     * On success, updates `github_token_refreshed_at` and returns the token.
     * On failure, throws a typed `GitHubCredentialError`.
     */
    async ensureValidToken(userId: string): Promise<string> {
        const token = await this._loadAndCheckExpiry(userId);
        await this._probeGitHub(token, userId);
        return token;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private async _loadAndCheckExpiry(userId: string): Promise<string> {
        const { data, error } = await this._supabase
            .from('profiles')
            .select('github_token_encrypted, github_token_expires_at')
            .eq('id', userId)
            .single<CredentialRow>();

        if (error || !data) {
            throw new GitHubCredentialError(
                'Failed to load GitHub credentials',
                'VALIDATION_FAILED',
            );
        }

        const token = data.github_token_encrypted;
        if (!token) {
            throw new GitHubCredentialError(
                'GitHub account is not connected',
                'NOT_CONNECTED',
            );
        }

        if (data.github_token_expires_at) {
            const expiresAt = new Date(data.github_token_expires_at).getTime();
            if (Date.now() >= expiresAt - EXPIRY_BUFFER_MS) {
                throw new GitHubCredentialError(
                    'GitHub token has expired — please reconnect your GitHub account',
                    'TOKEN_EXPIRED',
                );
            }
        }

        return token;
    }

    private async _probeGitHub(token: string, userId: string): Promise<void> {
        let res: Response;
        try {
            res = await this._fetch(`${GITHUB_API_BASE}/user`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            });
        } catch {
            throw new GitHubCredentialError(
                'Could not reach GitHub API to validate credentials',
                'VALIDATION_FAILED',
            );
        }

        if (res.status === 401) {
            throw new GitHubCredentialError(
                'GitHub token is invalid or has been revoked — please reconnect your GitHub account',
                'TOKEN_INVALID',
            );
        }

        if (!res.ok) {
            throw new GitHubCredentialError(
                `GitHub API returned unexpected status ${res.status} during credential validation`,
                'VALIDATION_FAILED',
            );
        }

        // Token is valid — record the refresh timestamp atomically.
        await this._supabase
            .from('profiles')
            .update({ github_token_refreshed_at: new Date().toISOString() })
            .eq('id', userId);
    }
}
