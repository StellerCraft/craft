/**
 * Property 17 — GitHub Repository Creation: Naming and Metadata Invariants
 *
 * Proves that for any combination of deployment name and metadata inputs the
 * GitHubService:
 *
 *   1. Always produces a non-empty resolved name ≤ 100 characters.
 *   2. Resolved name contains only characters valid in a GitHub repo name
 *      ([a-zA-Z0-9._-]) and does not start with a dot.
 *   3. Sanitization is idempotent — sanitizing the resolved name again yields
 *      the same string.
 *   4. Numeric collision suffixes (-1 … -5) keep the name within the 100-char
 *      limit and remain valid.
 *   5. The `private` flag is forwarded exactly as supplied.
 *   6. The `description` field is forwarded verbatim (or as empty string).
 *   7. The `homepage` field is forwarded verbatim (or as empty string).
 *   8. Topics always include the three default slugs: craft, stellar, defi.
 *   9. Topics are capped at 20 entries.
 *  10. Every topic slug matches [a-z0-9][a-z0-9-]* (valid GitHub topic format).
 *  11. Topics list contains no duplicates.
 *
 * Runs ≥ 100 iterations per property (numRuns: 100).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { GitHubService, sanitizeRepoName } from './github.service';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TOPICS = ['craft', 'stellar', 'defi'] as const;
const MAX_REPO_NAME_LENGTH = 100;
const VALID_REPO_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const VALID_TOPIC_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

/**
 * Registers a single successful GitHub API response for the given name and
 * visibility. Must be called once per `createRepository` invocation.
 */
function setupSuccessMock(name: string, isPrivate: boolean): void {
    mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => null },
        json: async () => ({
            id: 1,
            html_url: `https://github.com/craft-org/${name}`,
            clone_url: `https://github.com/craft-org/${name}.git`,
            ssh_url: `git@github.com:craft-org/${name}.git`,
            full_name: `craft-org/${name}`,
            default_branch: 'main',
            private: isPrivate,
        }),
    });
}

/**
 * Returns the JSON body that was sent to the GitHub API in the most recent
 * fetch call.
 */
function capturedPayload(): Record<string, unknown> {
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    return JSON.parse(options.body as string) as Record<string, unknown>;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * Deployment names that cover a wide range of real-world inputs:
 *   - clean alphanumeric slugs
 *   - names with spaces, special chars, unicode, emoji
 *   - very long names (> 100 chars)
 *   - names that are entirely invalid characters (fall back to "repo")
 *   - names starting/ending with dots or hyphens
 */
const arbDeploymentName = fc.oneof(
    // Clean slugs
    fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9\-_.]{0,40}$/),
    // Human-readable names with spaces and punctuation
    fc.string({ minLength: 1, maxLength: 80 }),
    // Edge cases
    fc.constant('My Stellar DEX!!'),
    fc.constant('...leading-dots'),
    fc.constant('trailing-dots...'),
    fc.constant('foo---bar'),
    fc.constant('a'.repeat(150)),
    fc.constant('!@#$%^&*()'),
    fc.constant('café-dex'),
    fc.constant('🚀-rocket-dex'),
    fc.constant('中文-repo'),
    fc.constant(''),
);

const arbDescription = fc.option(
    fc.string({ minLength: 0, maxLength: 200 }),
    { nil: undefined },
);

const arbHomepage = fc.option(
    fc.string({ minLength: 0, maxLength: 100 }),
    { nil: undefined },
);

/**
 * Topic arrays that include clean slugs, messy strings, and oversized arrays
 * to exercise the sanitization and cap logic.
 */
const arbTopics = fc.option(
    fc.array(
        fc.oneof(
            fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
            fc.constant('Stellar DEX'),
            fc.constant('  soroban  '),
            fc.constant('MY-TOPIC!!'),
            fc.constant('topic with spaces'),
            fc.string({ minLength: 1, maxLength: 30 }),
        ),
        { minLength: 0, maxLength: 25 },
    ),
    { nil: undefined },
);

/** Full request shape matching CreateRepoRequest. */
const arbCreateRepoRequest = fc.record({
    name: arbDeploymentName,
    description: arbDescription,
    homepage: arbHomepage,
    topics: arbTopics,
    private: fc.boolean(),
    userId: fc.constant('user-prop17'),
});

// ── Property 17 ───────────────────────────────────────────────────────────────

describe('Property 17 — GitHub repository creation naming and metadata invariants', () => {
    let service: GitHubService;

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        process.env.GITHUB_TOKEN = 'ghp_prop17_test_token';
        service = new GitHubService();
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    // ── Naming invariants ─────────────────────────────────────────────────────

    it('resolved name is always non-empty', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                const result = await service.createRepository(req);

                expect(result.resolvedName.length).toBeGreaterThan(0);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('resolved name never exceeds 100 characters', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                const result = await service.createRepository(req);

                expect(result.resolvedName.length).toBeLessThanOrEqual(MAX_REPO_NAME_LENGTH);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('resolved name contains only valid GitHub repository name characters', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                const result = await service.createRepository(req);

                expect(result.resolvedName).toMatch(VALID_REPO_NAME_RE);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('resolved name does not start with a dot', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                const result = await service.createRepository(req);

                expect(result.resolvedName.startsWith('.')).toBe(false);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('sanitization is idempotent — re-sanitizing the resolved name yields the same string', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                const result = await service.createRepository(req);

                // Applying sanitizeRepoName to an already-sanitized name must be a no-op.
                expect(sanitizeRepoName(result.resolvedName)).toBe(result.resolvedName);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    // ── Collision suffix invariants ───────────────────────────────────────────

    it('collision suffixes (-1 … -5) keep the name within 100 chars and valid', () => {
        fc.assert(
            fc.property(arbDeploymentName, fc.integer({ min: 1, max: 5 }), (rawName, attempt) => {
                const base = sanitizeRepoName(rawName);
                const suffix = `-${attempt}`;
                const trimmedBase = base.slice(0, MAX_REPO_NAME_LENGTH - suffix.length);
                const candidate = `${trimmedBase}${suffix}`;

                expect(candidate.length).toBeLessThanOrEqual(MAX_REPO_NAME_LENGTH);
                expect(candidate).toMatch(VALID_REPO_NAME_RE);
                expect(candidate.startsWith('.')).toBe(false);
            }),
            { numRuns: 100 },
        );
    });

    // ── Metadata invariants ───────────────────────────────────────────────────

    it('private flag is forwarded exactly as supplied', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                await service.createRepository(req);

                const payload = capturedPayload();
                expect(payload.private).toBe(req.private);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('description is forwarded verbatim (undefined becomes empty string)', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                await service.createRepository(req);

                const payload = capturedPayload();
                expect(payload.description).toBe(req.description ?? '');

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('homepage is forwarded verbatim (undefined becomes empty string)', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                await service.createRepository(req);

                const payload = capturedPayload();
                expect(payload.homepage).toBe(req.homepage ?? '');

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    // ── Topic invariants ──────────────────────────────────────────────────────

    it('topics always include the three default slugs: craft, stellar, defi', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                await service.createRepository(req);

                const payload = capturedPayload();
                const topics = payload.topics as string[];

                for (const defaultTopic of DEFAULT_TOPICS) {
                    expect(topics).toContain(defaultTopic);
                }

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('topics are capped at 20 entries', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                await service.createRepository(req);

                const payload = capturedPayload();
                const topics = payload.topics as string[];

                expect(topics.length).toBeLessThanOrEqual(20);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('every topic slug matches the valid GitHub topic format [a-z0-9][a-z0-9-]*', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                await service.createRepository(req);

                const payload = capturedPayload();
                const topics = payload.topics as string[];

                for (const topic of topics) {
                    expect(topic).toMatch(VALID_TOPIC_SLUG_RE);
                }

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('topics list contains no duplicates', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreateRepoRequest, async (req) => {
                setupSuccessMock(sanitizeRepoName(req.name), req.private);

                await service.createRepository(req);

                const payload = capturedPayload();
                const topics = payload.topics as string[];

                expect(topics.length).toBe(new Set(topics).size);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });
});
