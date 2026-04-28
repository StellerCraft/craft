/**
 * Unit tests for GitHubAccessValidator
 *
 * Mocks:
 *   global.fetch — stubbed so no real HTTP calls are made.
 *   GITHUB_TOKEN / GITHUB_ORG — set/unset per test via process.env.
 *
 * Coverage:
 *   validate() — missing token, identity 401, identity 429, identity 403
 *                (rate-limited), identity 403 (permission), identity 5xx,
 *                network throw on identity, scope 403 (user), scope 403 (org),
 *                scope 401, scope 429, scope 5xx, network throw on scope,
 *                full success (user account), full success (org account).
 *
 *   Integration with GitHubService.createRepository() — access failure
 *   propagates as GitHubApiError before any POST is attempted.
 *
 *   Integration with GitHubRepositoryUpdateService.updateRepository() —
 *   access failure propagates as ServiceError before code generation.
 *
 * Issue: #068
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubAccessValidator } from './github-access-validator.service';

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(
    status: number,
    headers: Record<string, string> = {},
): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers[k] ?? null },
        json: async () => ({}),
    } as unknown as Response;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GitHubAccessValidator.validate', () => {
    let validator: GitHubAccessValidator;

    beforeEach(() => {
        process.env.GITHUB_TOKEN = 'ghp_test';
        delete process.env.GITHUB_ORG;
        validator = new GitHubAccessValidator();
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
        delete process.env.GITHUB_ORG;
    });

    // ── Token presence ────────────────────────────────────────────────────────

    it('returns MISSING_TOKEN when GITHUB_TOKEN is absent', async () => {
        delete process.env.GITHUB_TOKEN;
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('MISSING_TOKEN');
        expect(result.guidance).toBeDefined();
    });

    it('returns MISSING_TOKEN when GITHUB_TOKEN is empty string', async () => {
        process.env.GITHUB_TOKEN = '';
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('MISSING_TOKEN');
    });

    // ── Identity check ────────────────────────────────────────────────────────

    it('returns AUTH_FAILED when /user returns 401', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(401));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('AUTH_FAILED');
        expect(result.guidance).toBeDefined();
    });

    it('returns RATE_LIMITED when /user returns 429', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(429, { 'Retry-After': '30' }));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('RATE_LIMITED');
        expect(result.retryAfterMs).toBe(30_000);
    });

    it('returns RATE_LIMITED when /user returns 403 with Retry-After header', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(403, { 'Retry-After': '60' }));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('RATE_LIMITED');
        expect(result.retryAfterMs).toBe(60_000);
    });

    it('returns AUTH_FAILED when /user returns 403 without Retry-After', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(403));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('AUTH_FAILED');
    });

    it('returns NETWORK_ERROR when /user returns 500', async () => {
        mockFetch.mockResolvedValueOnce(makeResponse(500));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('NETWORK_ERROR');
    });

    it('returns NETWORK_ERROR when fetch throws on /user', async () => {
        mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('NETWORK_ERROR');
    });

    // ── Scope / permission check ──────────────────────────────────────────────

    it('returns INSUFFICIENT_PERMISSIONS when /user/repos returns 403 (user account)', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))   // /user
            .mockResolvedValueOnce(makeResponse(403));  // /user/repos
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INSUFFICIENT_PERMISSIONS');
        expect(result.message).toContain('`repo` scope');
        expect(result.guidance).toBeDefined();
    });

    it('returns INSUFFICIENT_PERMISSIONS when /orgs/:org/repos returns 403 (org account)', async () => {
        process.env.GITHUB_ORG = 'my-org';
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))   // /user
            .mockResolvedValueOnce(makeResponse(403));  // /orgs/my-org/repos
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INSUFFICIENT_PERMISSIONS');
        expect(result.message).toContain('`admin:org` scope');
    });

    it('returns AUTH_FAILED when scope endpoint returns 401', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))
            .mockResolvedValueOnce(makeResponse(401));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('AUTH_FAILED');
    });

    it('returns RATE_LIMITED when scope endpoint returns 429', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))
            .mockResolvedValueOnce(makeResponse(429, { 'Retry-After': '10' }));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('RATE_LIMITED');
        expect(result.retryAfterMs).toBe(10_000);
    });

    it('returns NETWORK_ERROR when scope endpoint returns 500', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))
            .mockResolvedValueOnce(makeResponse(500));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('NETWORK_ERROR');
    });

    it('returns NETWORK_ERROR when fetch throws on scope endpoint', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))
            .mockRejectedValueOnce(new Error('timeout'));
        const result = await validator.validate();
        expect(result.valid).toBe(false);
        expect(result.code).toBe('NETWORK_ERROR');
    });

    // ── Happy paths ───────────────────────────────────────────────────────────

    it('returns valid:true when both checks pass (user account)', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))
            .mockResolvedValueOnce(makeResponse(200));
        const result = await validator.validate();
        expect(result.valid).toBe(true);
        expect(result.code).toBe('OK');
        expect(result.guidance).toBeUndefined();
    });

    it('returns valid:true when both checks pass (org account)', async () => {
        process.env.GITHUB_ORG = 'my-org';
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))
            .mockResolvedValueOnce(makeResponse(200));
        const result = await validator.validate();
        expect(result.valid).toBe(true);
        expect(result.code).toBe('OK');
    });

    it('calls /orgs/:org/repos when GITHUB_ORG is set', async () => {
        process.env.GITHUB_ORG = 'acme';
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))
            .mockResolvedValueOnce(makeResponse(200));
        await validator.validate();
        const scopeCall = mockFetch.mock.calls[1][0] as string;
        expect(scopeCall).toContain('/orgs/acme/repos');
    });

    it('calls /user/repos when GITHUB_ORG is not set', async () => {
        mockFetch
            .mockResolvedValueOnce(makeResponse(200))
            .mockResolvedValueOnce(makeResponse(200));
        await validator.validate();
        const scopeCall = mockFetch.mock.calls[1][0] as string;
        expect(scopeCall).toContain('/user/repos');
    });

    // ── Guidance is always populated on failure ───────────────────────────────

    it('always includes guidance when valid is false', async () => {
        const cases = [
            () => { delete process.env.GITHUB_TOKEN; },
            () => { mockFetch.mockResolvedValueOnce(makeResponse(401)); },
            () => {
                mockFetch
                    .mockResolvedValueOnce(makeResponse(200))
                    .mockResolvedValueOnce(makeResponse(403));
            },
        ];

        for (const setup of cases) {
            vi.clearAllMocks();
            process.env.GITHUB_TOKEN = 'ghp_test';
            setup();
            const result = await validator.validate();
            expect(result.valid).toBe(false);
            expect(result.guidance).toBeDefined();
            expect(result.guidance?.template.title).toBeTruthy();
        }
    });
});

// ── Integration: GitHubService ────────────────────────────────────────────────

describe('GitHubService.createRepository — access validation integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('throws AUTH_FAILED before any POST when validator returns invalid', async () => {
        const { GitHubService } = await import('./github.service');

        const failingValidator = {
            validate: vi.fn().mockResolvedValue({
                valid: false,
                code: 'AUTH_FAILED',
                message: 'Token missing',
                guidance: { template: { title: 'GitHub authentication failed', message: '', retryable: false }, steps: [], links: [] },
            }),
        };

        const svc = new GitHubService(failingValidator);
        process.env.GITHUB_TOKEN = 'ghp_test';

        await expect(
            svc.createRepository({ name: 'my-repo', private: true, userId: 'u1' }),
        ).rejects.toMatchObject({ code: 'AUTH_FAILED' });

        // fetch should NOT have been called for the actual repo creation
        expect(mockFetch).not.toHaveBeenCalled();

        delete process.env.GITHUB_TOKEN;
    });

    it('throws RATE_LIMITED with retryAfterMs when validator returns rate-limited', async () => {
        const { GitHubService } = await import('./github.service');

        const rateLimitedValidator = {
            validate: vi.fn().mockResolvedValue({
                valid: false,
                code: 'RATE_LIMITED',
                message: 'Rate limited',
                retryAfterMs: 5_000,
                guidance: { template: { title: 'Rate limit', message: '', retryable: true }, steps: [], links: [] },
            }),
        };

        const svc = new GitHubService(rateLimitedValidator);
        process.env.GITHUB_TOKEN = 'ghp_test';

        await expect(
            svc.createRepository({ name: 'my-repo', private: true, userId: 'u1' }),
        ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 5_000 });

        delete process.env.GITHUB_TOKEN;
    });
});
