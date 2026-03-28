/**
 * GitHub Repository Metadata — Property-Based Tests
 *
 * Property 19: Repository Metadata Configuration
 *
 * Proves that for any generated deployment metadata permutation the repository
 * created via GitHubService is configured with the correct description,
 * visibility (private flag), and topics.
 *
 * Invariants asserted across 100+ iterations:
 *   1. description is forwarded verbatim to the GitHub API payload
 *   2. private flag is forwarded exactly as supplied (true / false)
 *   3. topics are sanitized, deduplicated, and always include the three
 *      default topics ['craft', 'stellar', 'defi']
 *   4. topics are capped at 20 entries
 *   5. sanitized topic slugs contain only [a-z0-9-]
 *   6. the resolved repository name is always non-empty and ≤ 100 chars
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { GitHubService } from './github.service';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TOPICS = ['craft', 'stellar', 'defi'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

function setupSuccessMock(name: string, isPrivate: boolean) {
    mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => null },
        json: async () => ({
            id: 99999,
            html_url: `https://github.com/craft-org/${name}`,
            clone_url: `https://github.com/craft-org/${name}.git`,
            ssh_url: `git@github.com:craft-org/${name}.git`,
            full_name: `craft-org/${name}`,
            default_branch: 'main',
            private: isPrivate,
        }),
    });
}

/** Extracts the JSON body sent to the GitHub API from the most recent fetch call. */
function capturedBody(): Record<string, unknown> {
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    return JSON.parse(options.body as string);
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * Names that always produce a non-empty sanitized result, avoiding the
 * all-invalid edge case (which falls back to "repo" — tested separately).
 */
const arbRepoName = fc.oneof(
    fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9\-_.]{0,30}$/),
    fc.constant('My App!!'),
    fc.constant('foo--bar'),
    fc.constant('a'.repeat(150)),
);

const arbDescription = fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined });
const arbHomepage = fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined });

const arbTopics = fc.option(
    fc.array(
        fc.oneof(
            fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/),
            fc.constant('Stellar DEX'),
            fc.constant('  soroban  '),
            fc.constant('MY-TOPIC'),
            fc.constant('topic!!'),
            fc.string({ minLength: 1, maxLength: 30 }),
        ),
        { minLength: 0, maxLength: 25 },
    ),
    { nil: undefined },
);

const arbMetadata = fc.record({
    name: arbRepoName,
    description: arbDescription,
    homepage: arbHomepage,
    topics: arbTopics,
    private: fc.boolean(),
    userId: fc.constant('user-1'),
});

// ── Property 19 ───────────────────────────────────────────────────────────────

describe('Property 19 — repository metadata configuration', () => {
    let service: GitHubService;

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
        process.env.GITHUB_TOKEN = 'ghp_test_token';
        service = new GitHubService();
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('description is forwarded verbatim to the GitHub API payload', async () => {
        await fc.assert(
            fc.asyncProperty(arbMetadata, async (req) => {
                setupSuccessMock(req.name, req.private);

                await service.createRepository(req);

                const body = capturedBody();
                // Invariant: description matches exactly what was supplied (or empty string)
                expect(body.description).toBe(req.description ?? '');

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('private flag is forwarded exactly as supplied', async () => {
        await fc.assert(
            fc.asyncProperty(arbMetadata, async (req) => {
                setupSuccessMock(req.name, req.private);

                await service.createRepository(req);

                const body = capturedBody();
                // Invariant: visibility matches the caller's intent
                expect(body.private).toBe(req.private);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('topics always include the three default topics regardless of input', async () => {
        await fc.assert(
            fc.asyncProperty(arbMetadata, async (req) => {
                setupSuccessMock(req.name, req.private);

                await service.createRepository(req);

                const body = capturedBody();
                const topics = body.topics as string[];

                // Invariant: default topics are always present
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
            fc.asyncProperty(arbMetadata, async (req) => {
                setupSuccessMock(req.name, req.private);

                await service.createRepository(req);

                const body = capturedBody();
                const topics = body.topics as string[];

                // Invariant: GitHub enforces a 20-topic limit
                expect(topics.length).toBeLessThanOrEqual(20);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('every topic slug contains only lowercase alphanumerics and hyphens', async () => {
        await fc.assert(
            fc.asyncProperty(arbMetadata, async (req) => {
                setupSuccessMock(req.name, req.private);

                await service.createRepository(req);

                const body = capturedBody();
                const topics = body.topics as string[];

                // Invariant: all topics are valid GitHub topic slugs
                for (const topic of topics) {
                    expect(topic).toMatch(/^[a-z0-9][a-z0-9-]*$|^[a-z0-9]$/);
                }

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('topics list contains no duplicates', async () => {
        await fc.assert(
            fc.asyncProperty(arbMetadata, async (req) => {
                setupSuccessMock(req.name, req.private);

                await service.createRepository(req);

                const body = capturedBody();
                const topics = body.topics as string[];

                // Invariant: deduplication is applied
                expect(topics.length).toBe(new Set(topics).size);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('resolved repository name is always non-empty and within the 100-char limit', async () => {
        await fc.assert(
            fc.asyncProperty(arbMetadata, async (req) => {
                setupSuccessMock(req.name, req.private);

                const result = await service.createRepository(req);

                // Invariant: resolved name is non-empty and within GitHub's 100-char limit
                expect(result.resolvedName.length).toBeGreaterThan(0);
                expect(result.resolvedName.length).toBeLessThanOrEqual(100);

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });

    it('homepage is forwarded verbatim when supplied', async () => {
        await fc.assert(
            fc.asyncProperty(arbMetadata, async (req) => {
                setupSuccessMock(req.name, req.private);

                await service.createRepository(req);

                const body = capturedBody();
                // Invariant: homepage matches exactly what was supplied (or empty string)
                expect(body.homepage).toBe(req.homepage ?? '');

                vi.clearAllMocks();
            }),
            { numRuns: 100 },
        );
    });
});
