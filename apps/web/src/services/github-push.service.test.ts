import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    GitHubPushAuthError,
    GitHubPushService,
    GitHubPushValidationError,
} from './github-push.service';

const makeResponse = (status: number, body?: unknown): Response => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const headers = new Headers();
    if (body !== undefined) {
        headers.set('content-type', 'application/json');
    }
    return new Response(payload, { status, headers });
};

describe('GitHubPushService', () => {
    const fetchMock = vi.fn();
    let service: GitHubPushService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitHubPushService(fetchMock as any);
    });

    it('pushes generated files to an existing branch and returns commit refs', async () => {
        fetchMock
            .mockResolvedValueOnce(makeResponse(200, { object: { sha: 'sha-head', type: 'commit' } }))
            .mockResolvedValueOnce(makeResponse(200, { sha: 'sha-head', tree: { sha: 'sha-tree-base' } }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'blob-1' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'blob-2' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-tree-new' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-commit-new', tree: { sha: 'sha-tree-new' } }))
            .mockResolvedValueOnce(makeResponse(200, { ref: 'refs/heads/feature/generated' }));

        const result = await service.pushGeneratedCode({
            owner: 'acme',
            repo: 'generated-app',
            token: 'ghp_test',
            branch: 'feature/generated',
            commitMessage: 'chore: update generated code',
            files: [
                { path: 'src/index.ts', content: 'export const a = 1;', type: 'code' },
                { path: 'src\\nested\\file.ts', content: 'export const b = 2;', type: 'code' },
            ],
        });

        expect(result.createdBranch).toBe(false);
        expect(result.commitSha).toBe('sha-commit-new');
        expect(result.previousCommitSha).toBe('sha-head');
        expect(result.fileCount).toBe(2);

        const treeCall = fetchMock.mock.calls[4];
        const treePayload = JSON.parse(treeCall[1].body as string);
        expect(treePayload.tree).toEqual([
            { path: 'src/index.ts', mode: '100644', type: 'blob', sha: 'blob-1' },
            { path: 'src/nested/file.ts', mode: '100644', type: 'blob', sha: 'blob-2' },
        ]);
    });

    it('creates branch from base branch when target branch does not exist', async () => {
        fetchMock
            .mockResolvedValueOnce(makeResponse(404, { message: 'Not Found' }))
            .mockResolvedValueOnce(makeResponse(200, { object: { sha: 'sha-main', type: 'commit' } }))
            .mockResolvedValueOnce(makeResponse(201, { ref: 'refs/heads/feature/new' }))
            .mockResolvedValueOnce(makeResponse(200, { sha: 'sha-main', tree: { sha: 'sha-tree-base' } }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'blob-1' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-tree-new' }))
            .mockResolvedValueOnce(makeResponse(201, { sha: 'sha-commit-new', tree: { sha: 'sha-tree-new' } }))
            .mockResolvedValueOnce(makeResponse(200, { ref: 'refs/heads/feature/new' }));

        const result = await service.pushGeneratedCode({
            owner: 'acme',
            repo: 'generated-app',
            token: 'ghp_test',
            branch: 'feature/new',
            baseBranch: 'main',
            commitMessage: 'feat: initial generated snapshot',
            files: [{ path: 'README.md', content: '# Generated', type: 'config' }],
        });

        expect(result.createdBranch).toBe(true);
        expect(result.previousCommitSha).toBe('sha-main');
    });

    it('rejects unsafe file paths before making API calls', async () => {
        await expect(
            service.pushGeneratedCode({
                owner: 'acme',
                repo: 'generated-app',
                token: 'ghp_test',
                branch: 'main',
                commitMessage: 'test',
                files: [{ path: '../.env', content: 'secret=true', type: 'config' }],
            })
        ).rejects.toBeInstanceOf(GitHubPushValidationError);

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces auth errors without exposing token values', async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(401, { message: 'Bad credentials' }));

        await expect(
            service.pushGeneratedCode({
                owner: 'acme',
                repo: 'generated-app',
                token: 'ghp_secret',
                branch: 'main',
                commitMessage: 'test',
                files: [{ path: 'README.md', content: 'hello', type: 'config' }],
            })
        ).rejects.toBeInstanceOf(GitHubPushAuthError);
    });
});
