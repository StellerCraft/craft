import type { GeneratedFile } from '@craft/types';

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_FILE_COUNT = 5000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const BLOB_BATCH_SIZE = 25;

interface GitHubGitRefResponse {
    ref: string;
    object: { sha: string; type: string };
}

interface GitHubCommitResponse {
    sha: string;
    tree: { sha: string };
}

interface GitHubBlobResponse {
    sha: string;
}

interface GitHubTreeResponse {
    sha: string;
}

interface GitHubCreateCommitResponse {
    sha: string;
    tree: { sha: string };
}

export interface GitHubPushRequest {
    owner: string;
    repo: string;
    token: string;
    files: GeneratedFile[];
    branch: string;
    baseBranch?: string;
    commitMessage: string;
    authorName?: string;
    authorEmail?: string;
}

export interface GitHubCommitReference {
    owner: string;
    repo: string;
    branch: string;
    commitSha: string;
    treeSha: string;
    commitUrl: string;
    previousCommitSha: string;
    createdBranch: boolean;
    fileCount: number;
}

interface PreparedFile {
    path: string;
    content: string;
}

interface FetchLike {
    (input: string, init?: RequestInit): Promise<Response>;
}

export class GitHubPushValidationError extends Error {
    readonly code = 'VALIDATION_ERROR';
}

export class GitHubPushAuthError extends Error {
    readonly code = 'AUTH_ERROR';
}

export class GitHubPushApiError extends Error {
    readonly code = 'API_ERROR';
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

export class GitHubPushNetworkError extends Error {
    readonly code = 'NETWORK_ERROR';
}

export class GitHubPushService {
    constructor(private readonly _fetch: FetchLike = fetch) {}

    async pushGeneratedCode(request: GitHubPushRequest): Promise<GitHubCommitReference> {
        const owner = request.owner.trim();
        const repo = request.repo.trim();
        const branch = request.branch.trim();
        const baseBranch = (request.baseBranch ?? 'main').trim();
        const commitMessage = request.commitMessage.trim();

        if (!owner || !repo || !branch || !baseBranch || !commitMessage) {
            throw new GitHubPushValidationError('owner, repo, branch, baseBranch, and commitMessage are required');
        }

        const token = request.token.trim();
        if (!token) {
            throw new GitHubPushAuthError('GitHub token is required for repository updates');
        }

        const headers: HeadersInit = {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
        };

        const files = this.prepareFiles(request.files);

        let createdBranch = false;
        let currentHeadSha: string;

        const branchRef = await this.getRef(owner, repo, branch, headers);
        if (branchRef) {
            currentHeadSha = branchRef.object.sha;
        } else {
            const baseRef = await this.getRef(owner, repo, baseBranch, headers);
            if (!baseRef) {
                throw new GitHubPushApiError(`Base branch not found: ${baseBranch}`, 404);
            }

            currentHeadSha = baseRef.object.sha;
            await this.requestJson(
                `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        ref: `refs/heads/${branch}`,
                        sha: currentHeadSha,
                    }),
                },
                'Failed to create branch',
                true
            );
            createdBranch = true;
        }

        const baseCommit = await this.requestJson<GitHubCommitResponse>(
            `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${currentHeadSha}`,
            { method: 'GET', headers },
            'Failed to load base commit'
        );

        const treeItems = await this.createTreeItems(owner, repo, files, headers);

        const tree = await this.requestJson<GitHubTreeResponse>(
            `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    base_tree: baseCommit.tree.sha,
                    tree: treeItems,
                }),
            },
            'Failed to create git tree'
        );

        const commitPayload: Record<string, unknown> = {
            message: commitMessage,
            tree: tree.sha,
            parents: [currentHeadSha],
        };

        if (request.authorName && request.authorEmail) {
            commitPayload.author = {
                name: request.authorName,
                email: request.authorEmail,
            };
        }

        const commit = await this.requestJson<GitHubCreateCommitResponse>(
            `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify(commitPayload),
            },
            'Failed to create commit'
        );

        await this.requestJson(
            `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${branch}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    sha: commit.sha,
                    force: false,
                }),
            },
            'Failed to update branch ref',
            true
        );

        return {
            owner,
            repo,
            branch,
            commitSha: commit.sha,
            treeSha: commit.tree.sha,
            commitUrl: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
            previousCommitSha: currentHeadSha,
            createdBranch,
            fileCount: files.length,
        };
    }

    private prepareFiles(files: GeneratedFile[]): PreparedFile[] {
        if (!Array.isArray(files) || files.length === 0) {
            throw new GitHubPushValidationError('At least one generated file is required');
        }

        if (files.length > MAX_FILE_COUNT) {
            throw new GitHubPushValidationError(`Too many files (${files.length}). Max supported is ${MAX_FILE_COUNT}`);
        }

        let totalBytes = 0;
        const deduped = new Map<string, string>();

        for (const file of files) {
            if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
                throw new GitHubPushValidationError('Each generated file must include string path and content');
            }

            const normalizedPath = this.normalizePath(file.path);
            if (!normalizedPath) {
                throw new GitHubPushValidationError('Generated file path cannot be empty');
            }

            totalBytes += Buffer.byteLength(file.content, 'utf8');
            deduped.set(normalizedPath, file.content);
        }

        if (totalBytes > MAX_TOTAL_BYTES) {
            throw new GitHubPushValidationError(
                `Generated files are too large (${totalBytes} bytes). Max supported is ${MAX_TOTAL_BYTES} bytes`
            );
        }

        return Array.from(deduped.entries()).map(([path, content]) => ({ path, content }));
    }

    private normalizePath(rawPath: string): string {
        const normalized = rawPath.replace(/\\/g, '/').trim().replace(/^\.\//, '');
        const segments = normalized.split('/').filter(Boolean);

        if (normalized.startsWith('/')) {
            throw new GitHubPushValidationError(`Invalid file path: ${rawPath}`);
        }

        for (const segment of segments) {
            if (segment === '.' || segment === '..') {
                throw new GitHubPushValidationError(`Invalid file path: ${rawPath}`);
            }

            if (segment === '.git') {
                throw new GitHubPushValidationError(`Refusing to write inside .git directory: ${rawPath}`);
            }
        }

        return segments.join('/');
    }

    private async getRef(
        owner: string,
        repo: string,
        branch: string,
        headers: HeadersInit
    ): Promise<GitHubGitRefResponse | null> {
        try {
            return await this.requestJson<GitHubGitRefResponse>(
                `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`,
                { method: 'GET', headers },
                `Failed to load branch ref ${branch}`
            );
        } catch (error) {
            if (error instanceof GitHubPushApiError && error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    private async createTreeItems(
        owner: string,
        repo: string,
        files: PreparedFile[],
        headers: HeadersInit
    ): Promise<Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }>> {
        const items: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string }> = [];

        for (let i = 0; i < files.length; i += BLOB_BATCH_SIZE) {
            const batch = files.slice(i, i + BLOB_BATCH_SIZE);
            const batchItems = await Promise.all(
                batch.map(async (file) => {
                    const blob = await this.requestJson<GitHubBlobResponse>(
                        `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs`,
                        {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({
                                content: file.content,
                                encoding: 'utf-8',
                            }),
                        },
                        `Failed to create blob for ${file.path}`
                    );

                    return {
                        path: file.path,
                        mode: '100644' as const,
                        type: 'blob' as const,
                        sha: blob.sha,
                    };
                })
            );

            items.push(...batchItems);
        }

        return items;
    }

    private async requestJson<T>(
        url: string,
        init: RequestInit,
        contextMessage: string,
        allowNoContent = false
    ): Promise<T> {
        let response: Response;
        try {
            response = await this._fetch(url, init);
        } catch (error) {
            throw new GitHubPushNetworkError(
                `${contextMessage}: ${error instanceof Error ? error.message : 'Unknown network error'}`
            );
        }

        const isNoContent = response.status === 204;
        if (allowNoContent && isNoContent) {
            return undefined as T;
        }

        let payload: any = null;
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            payload = await response.json();
        } else if (!isNoContent) {
            const text = await response.text();
            payload = text ? { message: text } : null;
        }

        if (!response.ok) {
            const message = payload?.message || `${contextMessage} (HTTP ${response.status})`;
            if (response.status === 401 || response.status === 403) {
                throw new GitHubPushAuthError(`${contextMessage}: ${message}`);
            }
            throw new GitHubPushApiError(`${contextMessage}: ${message}`, response.status);
        }

        return payload as T;
    }
}

export const githubPushService = new GitHubPushService();
