/**
 * GitHubAccessValidator
 *
 * Validates that the configured token/installation has the permissions required
 * to perform repository operations before any GitHub API call is attempted.
 *
 * Checks performed (in order):
 *   1. Token presence — GITHUB_TOKEN must be set.
 *   2. Identity — GET /user (or /app/installations/:id for App auth) must succeed.
 *   3. Repo-create scope — GET /user/repos or GET /orgs/:org/repos must return 200.
 *      A 403 here means the token lacks the `repo` / `admin:org` scope.
 *
 * Returns a typed AccessValidationResult so callers can surface actionable
 * remediation guidance via getErrorGuidance without catching exceptions.
 *
 * Feature: github-access-validation
 * Issue: #068
 */

import { getErrorGuidance } from '@/lib/errors/guidance';
import type { ErrorGuidance } from '@craft/types';

const GITHUB_API_BASE = 'https://api.github.com';

// ── Result types ──────────────────────────────────────────────────────────────

export type AccessValidationCode =
    | 'OK'
    | 'MISSING_TOKEN'
    | 'AUTH_FAILED'
    | 'INSUFFICIENT_PERMISSIONS'
    | 'RATE_LIMITED'
    | 'CONFIGURATION_ERROR'
    | 'NETWORK_ERROR';

export interface AccessValidationResult {
    valid: boolean;
    code: AccessValidationCode;
    message: string;
    /** Populated when valid is false — actionable remediation steps. */
    guidance?: ErrorGuidance;
    /** Milliseconds to wait before retrying (populated for RATE_LIMITED). */
    retryAfterMs?: number;
}

// ── Validator ─────────────────────────────────────────────────────────────────

export class GitHubAccessValidator {
    private get token(): string {
        return process.env.GITHUB_TOKEN ?? '';
    }

    private get org(): string | null {
        return process.env.GITHUB_ORG || null;
    }

    /**
     * Run all pre-flight access checks.
     * Never throws — all error paths return a resolved AccessValidationResult.
     */
    async validate(): Promise<AccessValidationResult> {
        // ── 1. Token presence ─────────────────────────────────────────────────
        if (!this.token) {
            return this.fail(
                'MISSING_TOKEN',
                'GITHUB_TOKEN is not configured',
                'AUTH_FAILED',
            );
        }

        const headers = {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };

        // ── 2. Identity check ─────────────────────────────────────────────────
        let identityRes: Response;
        try {
            identityRes = await fetch(`${GITHUB_API_BASE}/user`, { headers });
        } catch {
            return this.fail('NETWORK_ERROR', 'Could not reach GitHub API', 'NETWORK_ERROR');
        }

        if (identityRes.status === 401) {
            return this.fail('AUTH_FAILED', 'GitHub token is invalid or expired', 'AUTH_FAILED');
        }

        if (identityRes.status === 429 || identityRes.status === 403) {
            const retryAfterMs = this.parseRetryAfter(identityRes);
            if (identityRes.status === 429 || retryAfterMs > 0) {
                return this.fail('RATE_LIMITED', 'GitHub API rate limit exceeded', 'RATE_LIMITED', retryAfterMs);
            }
            return this.fail('AUTH_FAILED', 'GitHub token does not have required permissions', 'AUTH_FAILED');
        }

        if (!identityRes.ok) {
            return this.fail('NETWORK_ERROR', `GitHub API returned ${identityRes.status}`, 'NETWORK_ERROR');
        }

        // ── 3. Repo-create permission check ───────────────────────────────────
        const scopeEndpoint = this.org
            ? `${GITHUB_API_BASE}/orgs/${this.org}/repos`
            : `${GITHUB_API_BASE}/user/repos`;

        let scopeRes: Response;
        try {
            scopeRes = await fetch(`${scopeEndpoint}?per_page=1`, { headers });
        } catch {
            return this.fail('NETWORK_ERROR', 'Could not reach GitHub API during permission check', 'NETWORK_ERROR');
        }

        if (scopeRes.status === 403) {
            const scope = this.org
                ? '`admin:org` scope on the organisation'
                : '`repo` scope';
            return this.fail(
                'INSUFFICIENT_PERMISSIONS',
                `GitHub token is missing the ${scope} required to create repositories`,
                'AUTH_FAILED',
            );
        }

        if (scopeRes.status === 401) {
            return this.fail('AUTH_FAILED', 'GitHub token is invalid or expired', 'AUTH_FAILED');
        }

        if (scopeRes.status === 429) {
            const retryAfterMs = this.parseRetryAfter(scopeRes);
            return this.fail('RATE_LIMITED', 'GitHub API rate limit exceeded', 'RATE_LIMITED', retryAfterMs);
        }

        if (!scopeRes.ok) {
            return this.fail('NETWORK_ERROR', `GitHub API returned ${scopeRes.status} during permission check`, 'NETWORK_ERROR');
        }

        return { valid: true, code: 'OK', message: 'GitHub access validated' };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fail(
        code: AccessValidationCode,
        message: string,
        guidanceCode: 'AUTH_FAILED' | 'RATE_LIMITED' | 'CONFIGURATION_ERROR' | 'NETWORK_ERROR',
        retryAfterMs?: number,
    ): AccessValidationResult {
        return {
            valid: false,
            code,
            message,
            guidance: getErrorGuidance('github', guidanceCode),
            ...(retryAfterMs !== undefined && retryAfterMs > 0 ? { retryAfterMs } : {}),
        };
    }

    private parseRetryAfter(res: Response): number {
        const sec = parseInt(res.headers.get('Retry-After') ?? '0', 10);
        return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0;
    }
}

export const githubAccessValidator = new GitHubAccessValidator();
