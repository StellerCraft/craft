/**
 * GitHub OAuth scope validation for deployment operations.
 *
 * Validates that a GitHub access token grants all scopes required for CRAFT
 * deployment operations before any repository work is attempted.
 *
 * Required scopes
 * ───────────────
 * repo       — Full read/write access to public and private repositories.
 *              Required to create repos, push code, and configure webhooks.
 * read:user  — Read the authenticated user's profile data (login, email).
 *              Required during OAuth callback to persist the GitHub username.
 *
 * GitHub returns the granted scopes in the `X-OAuth-Scopes` response header on
 * any authenticated API call. This module inspects that header and compares it
 * against the required scope list.
 *
 * Scope hierarchy
 * ───────────────
 * GitHub scopes are hierarchical: `repo` covers `public_repo`, `repo:status`,
 * `repo:deployment`, etc. The validator resolves this — if `repo` is granted,
 * narrower `repo:*` sub-scopes are satisfied automatically.
 *
 * Caching
 * ───────
 * Successful validations are cached in-memory with a short TTL (default: 5 minutes,
 * configurable via SCOPE_VALIDATION_CACHE_TTL_MS env var) keyed by a SHA-256 hash
 * of the access token to avoid holding plaintext tokens in memory. Failures are
 * never cached so transient GitHub outages don't get stuck as false negatives.
 *
 * Feature: github-oauth-scope-validation
 * Issue: #658, #938
 *
 * See "Rate Limiting, Idempotency, and Tier Enforcement" in CONTRIBUTING.md
 * for the full env-var reference.
 */

import { createHash } from 'node:crypto';

const GITHUB_USER_URL = 'https://api.github.com/user';
const SCOPE_VALIDATION_CACHE_TTL_MS = parseInt(
    process.env.SCOPE_VALIDATION_CACHE_TTL_MS ?? '300000',
    10,
); // 5 minutes default

interface CacheEntry {
    result: ScopeValidationResult;
    expiresAt: number;
}

const scopeValidationCache = new Map<string, CacheEntry>();

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/** All scopes CRAFT requires for deployment operations. */
export const REQUIRED_SCOPES = ['repo', 'read:user'] as const;

export type RequiredScope = (typeof REQUIRED_SCOPES)[number];

export interface ScopeValidationResult {
    valid: boolean;
    grantedScopes: string[];
    missingScopes: RequiredScope[];
}

/**
 * Broad-scope parents that implicitly satisfy narrower child scopes.
 * e.g. "repo" satisfies "public_repo", "repo:status", "repo:deployment".
 */
const SCOPE_PARENTS: Record<string, string> = {
    'public_repo': 'repo',
    'repo:status': 'repo',
    'repo:deployment': 'repo',
    'repo:invite': 'repo',
    'repo:hooks': 'repo',
    'read:user': 'user',
    'user:email': 'user',
    'user:follow': 'user',
};

/**
 * Returns true if `granted` satisfies `required`, accounting for scope
 * hierarchy (a parent scope satisfies all its children).
 */
function scopeSatisfied(required: string, granted: Set<string>): boolean {
    if (granted.has(required)) return true;
    const parent = SCOPE_PARENTS[required];
    return parent !== undefined && granted.has(parent);
}

/**
 * Parse the comma-separated `X-OAuth-Scopes` header value into an array.
 * Returns an empty array when the header is absent or empty.
 */
export function parseGrantedScopes(header: string | null): string[] {
    if (!header) return [];
    return header.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Validate that `grantedScopes` covers all REQUIRED_SCOPES.
 */
export function validateScopes(grantedScopes: string[]): ScopeValidationResult {
    const granted = new Set(grantedScopes);
    const missingScopes = REQUIRED_SCOPES.filter(
        (s) => !scopeSatisfied(s, granted),
    ) as RequiredScope[];

    return {
        valid: missingScopes.length === 0,
        grantedScopes,
        missingScopes,
    };
}

/**
 * Clear the scope validation cache.
 * Used for test isolation or manual cache flush.
 */
export function clearScopeValidationCache(): void {
    scopeValidationCache.clear();
}

/**
 * Fetch the X-OAuth-Scopes header from GitHub by making an authenticated
 * request to GET /user and reading the response headers.
 *
 * Results are cached (in-memory, short TTL) to avoid redundant API calls.
 * Only successful validations are cached; failures are never cached to prevent
 * transient errors from persisting as false negatives.
 *
 * Returns a ScopeValidationResult. Never throws — all error paths return
 * { valid: false } so callers can surface actionable messages.
 */
export async function fetchAndValidateScopes(
    accessToken: string,
): Promise<ScopeValidationResult & { fetchError?: string }> {
    const tokenHash = hashToken(accessToken);

    // Check cache
    const cached = scopeValidationCache.get(tokenHash);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.result;
    }

    // Remove expired entry if present
    if (cached) {
        scopeValidationCache.delete(tokenHash);
    }

    let res: Response;
    try {
        res = await fetch(GITHUB_USER_URL, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Network error';
        return {
            valid: false,
            grantedScopes: [],
            missingScopes: [...REQUIRED_SCOPES],
            fetchError: message,
        };
    }

    if (!res.ok) {
        return {
            valid: false,
            grantedScopes: [],
            missingScopes: [...REQUIRED_SCOPES],
            fetchError: `GitHub API returned ${res.status}`,
        };
    }

    const scopeHeader = res.headers.get('X-OAuth-Scopes');
    const grantedScopes = parseGrantedScopes(scopeHeader);
    const result = validateScopes(grantedScopes);

    // Cache successful validations
    scopeValidationCache.set(tokenHash, {
        result,
        expiresAt: Date.now() + SCOPE_VALIDATION_CACHE_TTL_MS,
    });

    return result;
}

/**
 * Build a human-readable error message listing the missing scopes.
 * Used to surface re-authorization instructions to the user.
 */
export function buildMissingScopeMessage(missingScopes: RequiredScope[]): string {
    const list = missingScopes.map((s) => `\`${s}\``).join(', ');
    return (
        `The GitHub token is missing required scopes: ${list}. ` +
        'Please disconnect and reconnect your GitHub account to grant the required permissions.'
    );
}
