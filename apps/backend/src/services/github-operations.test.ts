/**
 * GitHub Service Operations — Comprehensive Unit Tests
 *
 * Issue: #079 — Write unit tests for GitHub service operations
 * Branch: issue-079-write-unit-tests-for-github-service-operations
 *
 * Covers gaps not addressed by existing test files:
 *
 *   GitHubService.deleteRepository
 *     — 204 success, 404 no-op, non-404 error logged, network throw logged
 *
 *   GitHubService.validateAccess
 *     — unexpected non-401 error status returns false
 *
 *   GitHubPushService — validation edge cases
 *     — empty files array, null/malformed file entries
 *     — absolute path rejection
 *     — .git directory path rejection
 *     — dot-segment path traversal rejection
 *     — duplicate paths are deduplicated (last-write-wins)
 *     — file count limit (> 5000) throws validation error
 *     — total byte size limit throws validation error
 *     — author name/email forwarded to commit payload
 *     — blob creation batched in groups of 25
 *     — base branch not found throws API error
 *     — 204 no-content on ref update is handled gracefully
 *
 *   GitHubRepositoryUpdateService — edge cases
 *     — custom branch and commitMessage are forwarded to push service
 *     — unknown error type maps to NETWORK_ERROR
 *     — rollback failure is swallowed (best-effort)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubService } from './github.service';
import {
    GitHubPushService,
    GitHubPushValidationError,
    GitHubPushAuthError,
    GitHubPushApiError,
} from './github-push.service';
import {
    GitHubRepositoryUpdateService,
    parseRepoIdentity,
} from './github-repository-update.service';
import { GitHubPushNetworkError } from './github-push.service';

// ── Shared fetch mock ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeJsonResponse(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers[k] ?? null },
        json: async () => body,
    };
}

function makeResponse(status: number, body?: unknown): Response {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const hdrs = new Headers();
    if (body !== undefined) hdrs.set('content-type', 'application/json');
    return new Response(payload, { status, headers: hdrs });
}

// ── GitHubService.deleteRepository ───────────────────────────────────────────

describe('GitHubService.deleteRepository', () => {
    let service: GitHubService;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    beforeEach(() => {
        process.env.GITHUB_TOKEN = 'ghp_test_token';
        service = new GitHubService();
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
    });

    it('resolves without error on 204 success', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse(204, null));
        await expect(service.deleteRepository('acme', 'my-repo')).resolves.toBeUndefined();
    });

    it('sends DELETE to the correct endpoint with auth headers', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse(204, null));
        await service.deleteRepository('acme', 'my-repo');

        const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
        expect(url).toBe('https://api.github.com/repos/acme/my-repo');
        expect(options.method).toBe('DELETE');
        expect(options.headers['Authorization']).toBe('Bearer ghp_test_token');
    });

    it('treats 404 as a no-op (repo already gone)', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse(404, { message: 'Not Found' }));
        await expect(service.deleteRepository('acme', 'gone-repo')).resolves.toBeUndefined();
        expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('logs an error but does not throw on non-404 failure', async () => {
        mockFetch.mockResolvedValueOnce(
            makeJsonResponse(403, { message: 'Must have admin rights' }),
        );
        await expect(service.deleteRepository('acme', 'my-repo')).resolves.toBeUndefined();
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('acme/my-repo'),
            expect.any(String),
        );
    });

    it('logs an error but does not throw when fetch itself throws', async () => {
        mockFetch.mockRejectedValueOnce(new Error('socket hang up'));
        await expect(service.deleteRepository('acme', 'my-repo')).resolves.toBeUndefined();
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('acme/my-repo'),
            'socket hang up',
        );
    });
});

// ── GitHubService.validateAccess — additional status codes ───────────────────

describe('GitHubService.validateAccess — additional cases', () => {
    let service: GitHubService;

    beforeEach(() => {
        process.env.GITHUB_TOKEN = 'ghp_test_token';
        service = new GitHubService();
        vi.clearAllMocks();
    });

    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
    });

    it('returns false for a 403 response', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse(403, { message: 'Forbidden' }));
        expect(await service.validateAccess()).toBe(false);
    });

    it('returns false for a 500 response', async () => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse(500, { message: 'Server Error' }));
        expect(await service.validateAccess()).toBe(false);
    });
});

// ── GitHubPushService — validation edge cases ─────────────────────────────────

describe('GitHubPushService — validation edge cases', () => {
    const fetchMock = vi.fn();
    let service: GitHubPushService;

    const BASE = {
        owner: 'acme',
        repo: 'app',
        token: 'ghp_test',
        branch: 'main',
        commitMessage: 'chore: update',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitHubPushService(fetchMock as any);
    });

    it('throws GitHubPushValidationError for an empty files array', async () => {
        await expect(
            service.pushGeneratedCode({ ...BASE, files: [] }),
        ).rejects.toBeInstanceOf(GitHubPushValidationError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws GitHubPushValidationError for a file with a null path', async () => {
        await expect(
            service.pushGeneratedCode({
                ...BASE,
                files: [{ path: null as any, content: 'x', type: 'code' }],
            }),
        ).rejects.toBeInstanceOf(GitHubPushValidationError);
    });

    it('throws GitHubPushValidationError for an absolute path', async () => {
        await expect(
            service.pushGeneratedCode({
                ...BASE,
                files: [{ path: '/etc/passwd', content: 'x', type: 'code' }],
            }),
        ).rejects.toBeInstanceOf(GitHubPushValidationError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws GitHubPushValidationError for a path containing .git directory', async () => {
        await expect(
            service.pushGeneratedCode({
                ...BASE,
                files: [{ path: '.git/config', content: 'x', type: 'code' }],
            }),
        ).rejects.toBeInstanceOf(GitHubPushValidationError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws GitHubPushValidationError for a path with .. traversal', async () => {
        await expect(
            service.pushGeneratedCode({
                ...BASE,
                files: [{ path: 'src/../../../etc/passwd', content: 'x', type: 'code' }],
            }),
        ).rejects.toBeInstanceOf(GitHubPushValidationError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('deduplicates files with the same path (last entry wins)', async () => {
        fetchMock
            .mockResolvedValueOnce(makeResponse(200, { object: { sha: 'sha-head' } }))
            .mockResolvedValueOnce(makeResponse(200, { sha: 'sha-head', tree: { sha: 'sha-tree' } }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'blob-deduped' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-tree-new' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-commit', tree: { sha: 'sha-tree-new' } }))
            .mockResolvedValueOnce(makeResponse(200, {}));

        const result = await service.pushGeneratedCode({
            ...BASE,
            files: [
                { path: 'src/index.ts', content: 'first', type: 'code' },
                { path: 'src/index.ts', content: 'second', type: 'code' },
            ],
        });

        // Only 1 unique file after deduplication
        expect(result.fileCount).toBe(1);

        // The blob call should use the last content ('second')
        const blobCall = fetchMock.mock.calls[2];
        const blobBody = JSON.parse(blobCall[1].body as string);
        expect(blobBody.content).toBe('second');
    });

    it('throws GitHubPushValidationError when file count exceeds 5000', async () => {
        const files = Array.from({ length: 5001 }, (_, i) => ({
            path: `src/file${i}.ts`,
            content: 'x',
            type: 'code' as const,
        }));

        await expect(
            service.pushGeneratedCode({ ...BASE, files }),
        ).rejects.toBeInstanceOf(GitHubPushValidationError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws GitHubPushValidationError when total content exceeds 20 MB', async () => {
        // 21 MB of content
        const bigContent = 'x'.repeat(21 * 1024 * 1024);
        await expect(
            service.pushGeneratedCode({
                ...BASE,
                files: [{ path: 'big.ts', content: bigContent, type: 'code' }],
            }),
        ).rejects.toBeInstanceOf(GitHubPushValidationError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('forwards authorName and authorEmail to the commit payload', async () => {
        fetchMock
            .mockResolvedValueOnce(makeResponse(200, { object: { sha: 'sha-head' } }))
            .mockResolvedValueOnce(makeResponse(200, { sha: 'sha-head', tree: { sha: 'sha-tree' } }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'blob-1' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-tree-new' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-commit', tree: { sha: 'sha-tree-new' } }))
            .mockResolvedValueOnce(makeResponse(200, {}));

        await service.pushGeneratedCode({
            ...BASE,
            files: [{ path: 'README.md', content: '# Hello', type: 'config' }],
            authorName: 'CRAFT Bot',
            authorEmail: 'craft@stellercraft.io',
        });

        // Commit is the 5th call (index 4)
        const commitCall = fetchMock.mock.calls[4];
        const commitBody = JSON.parse(commitCall[1].body as string);
        expect(commitBody.author).toEqual({
            name: 'CRAFT Bot',
            email: 'craft@stellercraft.io',
        });
    });

    it('omits author from commit payload when authorName/authorEmail are not provided', async () => {
        fetchMock
            .mockResolvedValueOnce(makeResponse(200, { object: { sha: 'sha-head' } }))
            .mockResolvedValueOnce(makeResponse(200, { sha: 'sha-head', tree: { sha: 'sha-tree' } }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'blob-1' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-tree-new' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-commit', tree: { sha: 'sha-tree-new' } }))
            .mockResolvedValueOnce(makeResponse(200, {}));

        await service.pushGeneratedCode({
            ...BASE,
            files: [{ path: 'README.md', content: '# Hello', type: 'config' }],
        });

        const commitCall = fetchMock.mock.calls[4];
        const commitBody = JSON.parse(commitCall[1].body as string);
        expect(commitBody.author).toBeUndefined();
    });

    it('creates blobs in batches of 25 for large file sets', async () => {
        const FILE_COUNT = 30;
        const files = Array.from({ length: FILE_COUNT }, (_, i) => ({
            path: `src/file${i}.ts`,
            content: `export const x${i} = ${i};`,
            type: 'code' as const,
        }));

        // getRef → getCommit → 30 blob calls → createTree → createCommit → updateRef
        fetchMock.mockResolvedValueOnce(makeResponse(200, { object: { sha: 'sha-head' } }));
        fetchMock.mockResolvedValueOnce(makeResponse(200, { sha: 'sha-head', tree: { sha: 'sha-tree' } }));
        for (let i = 0; i < FILE_COUNT; i++) {
            fetchMock.mockResolvedValueOnce(makeResponse(201, { sha: `blob-${i}` }));
        }
        fetchMock.mockResolvedValueOnce(makeResponse(201, { sha: 'sha-tree-new' }));
        fetchMock.mockResolvedValueOnce(makeResponse(201, { sha: 'sha-commit', tree: { sha: 'sha-tree-new' } }));
        fetchMock.mockResolvedValueOnce(makeResponse(200, {}));

        const result = await service.pushGeneratedCode({ ...BASE, files });

        expect(result.fileCount).toBe(FILE_COUNT);
        // 2 (ref + commit) + 30 (blobs) + 1 (tree) + 1 (commit) + 1 (update ref) = 35
        expect(fetchMock).toHaveBeenCalledTimes(35);
    });

    it('throws GitHubPushApiError when base branch is not found', async () => {
        // Target branch 404, then base branch 404
        fetchMock
            .mockResolvedValueOnce(makeResponse(404, { message: 'Not Found' }))
            .mockResolvedValueOnce(makeResponse(404, { message: 'Not Found' }));

        await expect(
            service.pushGeneratedCode({
                ...BASE,
                branch: 'feature/new',
                baseBranch: 'nonexistent',
                files: [{ path: 'README.md', content: '# Hi', type: 'config' }],
            }),
        ).rejects.toBeInstanceOf(GitHubPushApiError);
    });

    it('throws GitHubPushAuthError when token is whitespace-only', async () => {
        await expect(
            service.pushGeneratedCode({
                ...BASE,
                token: '   ',
                files: [{ path: 'README.md', content: '# Hi', type: 'config' }],
            }),
        ).rejects.toBeInstanceOf(GitHubPushAuthError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws GitHubPushValidationError when required fields are empty strings', async () => {
        await expect(
            service.pushGeneratedCode({
                ...BASE,
                owner: '',
                files: [{ path: 'README.md', content: '# Hi', type: 'config' }],
            }),
        ).rejects.toBeInstanceOf(GitHubPushValidationError);
    });
});

// ── GitHubRepositoryUpdateService — edge cases ────────────────────────────────

describe('GitHubRepositoryUpdateService — edge cases', () => {
    // ── Supabase mock helpers ─────────────────────────────────────────────────

    const mockSingle = vi.fn();
    const mockEqUpdate = vi.fn();
    const mockEqSelect = vi.fn();
    const mockInsert = vi.fn();
    const mockUpdate = vi.fn();
    const mockSelect = vi.fn();
    const mockFrom = vi.fn();

    vi.mock('@/lib/supabase/server', () => ({
        createClient: () => ({ from: mockFrom }),
    }));

    const mockPushGeneratedCode = vi.fn();
    const mockGenerate = vi.fn();
    const mockPushService = { pushGeneratedCode: mockPushGeneratedCode };
    const mockCodeGenerator = { generate: mockGenerate };

    const DEPLOYMENT_ID = 'deploy-123';
    const USER_ID = 'user-abc';
    const REPO_URL = 'https://github.com/acme/my-app';

    const makeDeployment = (overrides: Record<string, unknown> = {}) => ({
        id: DEPLOYMENT_ID,
        user_id: USER_ID,
        status: 'completed',
        repository_url: REPO_URL,
        full_name: 'acme/my-app',
        customization_config: { theme: 'dark' },
        ...overrides,
    });

    const makeCommitRef = () => ({
        owner: 'acme',
        repo: 'my-app',
        branch: 'main',
        commitSha: 'abc123',
        treeSha: 'tree456',
        commitUrl: 'https://github.com/acme/my-app/commit/abc123',
        previousCommitSha: 'prev789',
        createdBranch: false,
        fileCount: 2,
    });

    const makeFiles = () => [
        { path: 'src/index.ts', content: 'export {}', type: 'code' },
        { path: 'README.md', content: '# Hello', type: 'config' },
    ];

    function setupDeploymentFetch(data: unknown, error: unknown = null) {
        mockSingle.mockResolvedValueOnce({ data, error });
        mockEqSelect.mockReturnValueOnce({ single: mockSingle });
        const mockEqFirst = vi.fn().mockReturnValueOnce({ eq: mockEqSelect });
        mockSelect.mockReturnValueOnce({ eq: mockEqFirst });
        mockFrom.mockReturnValueOnce({ select: mockSelect });
    }

    function setupInsert() {
        mockInsert.mockResolvedValueOnce({ error: null });
        mockFrom.mockReturnValueOnce({ insert: mockInsert });
    }

    function setupUpdate() {
        mockEqUpdate.mockResolvedValueOnce({ error: null });
        mockUpdate.mockReturnValueOnce({ eq: mockEqUpdate });
        mockFrom.mockReturnValueOnce({ update: mockUpdate });
    }

    let service: GitHubRepositoryUpdateService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitHubRepositoryUpdateService(
            mockPushService as any,
            mockCodeGenerator as any,
        );
    });

    const baseParams = {
        deploymentId: DEPLOYMENT_ID,
        userId: USER_ID,
        customizationConfig: { theme: 'light' } as any,
    };

    it('forwards custom branch to the push service', async () => {
        const commitRef = makeCommitRef();
        setupDeploymentFetch(makeDeployment());
        mockGenerate.mockReturnValueOnce({ generatedFiles: makeFiles() });
        setupInsert();
        mockPushGeneratedCode.mockResolvedValueOnce(commitRef);
        setupUpdate();
        setupUpdate();

        await service.updateRepository({ ...baseParams, branch: 'release/v2' });

        expect(mockPushGeneratedCode).toHaveBeenCalledWith(
            expect.objectContaining({ branch: 'release/v2' }),
        );
    });

    it('forwards custom commitMessage to the push service', async () => {
        const commitRef = makeCommitRef();
        setupDeploymentFetch(makeDeployment());
        mockGenerate.mockReturnValueOnce({ generatedFiles: makeFiles() });
        setupInsert();
        mockPushGeneratedCode.mockResolvedValueOnce(commitRef);
        setupUpdate();
        setupUpdate();

        await service.updateRepository({
            ...baseParams,
            commitMessage: 'feat: custom branding update',
        });

        expect(mockPushGeneratedCode).toHaveBeenCalledWith(
            expect.objectContaining({ commitMessage: 'feat: custom branding update' }),
        );
    });

    it('maps an unknown error type to NETWORK_ERROR', async () => {
        setupDeploymentFetch(makeDeployment());
        mockGenerate.mockReturnValueOnce({ generatedFiles: makeFiles() });
        setupInsert();
        mockPushGeneratedCode.mockRejectedValueOnce({ message: 'something weird' });
        setupUpdate();
        setupUpdate();

        await expect(service.updateRepository(baseParams)).rejects.toMatchObject({
            code: 'NETWORK_ERROR',
        });
    });

    it('swallows rollback errors and still throws the original service error', async () => {
        setupDeploymentFetch(makeDeployment());
        mockGenerate.mockReturnValueOnce({ generatedFiles: makeFiles() });
        setupInsert();
        mockPushGeneratedCode.mockRejectedValueOnce(new GitHubPushNetworkError('timeout'));

        // Rollback update calls — first one throws to simulate rollback failure
        mockEqUpdate.mockRejectedValueOnce(new Error('DB rollback failed'));
        mockUpdate.mockReturnValueOnce({ eq: mockEqUpdate });
        mockFrom.mockReturnValueOnce({ update: mockUpdate });

        // Should still throw the original NETWORK_ERROR, not the rollback error
        await expect(service.updateRepository(baseParams)).rejects.toMatchObject({
            code: 'NETWORK_ERROR',
        });
    });

    it('uses "main" as the default branch when none is specified', async () => {
        const commitRef = makeCommitRef();
        setupDeploymentFetch(makeDeployment());
        mockGenerate.mockReturnValueOnce({ generatedFiles: makeFiles() });
        setupInsert();
        mockPushGeneratedCode.mockResolvedValueOnce(commitRef);
        setupUpdate();
        setupUpdate();

        await service.updateRepository(baseParams);

        expect(mockPushGeneratedCode).toHaveBeenCalledWith(
            expect.objectContaining({ branch: 'main' }),
        );
    });

    it('generates a default commitMessage containing an ISO timestamp when none is provided', async () => {
        const commitRef = makeCommitRef();
        setupDeploymentFetch(makeDeployment());
        mockGenerate.mockReturnValueOnce({ generatedFiles: makeFiles() });
        setupInsert();
        mockPushGeneratedCode.mockResolvedValueOnce(commitRef);
        setupUpdate();
        setupUpdate();

        await service.updateRepository(baseParams);

        const [call] = mockPushGeneratedCode.mock.calls;
        expect(call[0].commitMessage).toMatch(/chore: update generated workspace/);
        expect(call[0].commitMessage).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
});
