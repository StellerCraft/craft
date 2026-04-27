import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GitHub Repository Cleanup Tests (#373)
 *
 * Verifies that GitHub repositories and associated resources (webhooks, deploy
 * keys) are properly cleaned up when deployments are deleted, that cleanup is
 * idempotent, and that failures are handled gracefully.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface Deployment {
  id: string;
  repoFullName: string;
  webhookIds: number[];
  deployKeyIds: number[];
}

interface CleanupResult {
  success: boolean;
  repoDeleted: boolean;
  webhooksRemoved: number[];
  keysRemoved: number[];
  errors: CleanupError[];
}

interface CleanupError {
  resource: string;
  id?: number;
  message: string;
  code: string;
}

interface GitHubClient {
  deleteRepository(fullName: string): Promise<void>;
  deleteWebhook(fullName: string, webhookId: number): Promise<void>;
  deleteDeployKey(fullName: string, keyId: number): Promise<void>;
  repositoryExists(fullName: string): Promise<boolean>;
}

// ── RepositoryCleanupService ──────────────────────────────────────────────────

class RepositoryCleanupService {
  constructor(private readonly github: GitHubClient) {}

  async cleanup(deployment: Deployment): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: false,
      repoDeleted: false,
      webhooksRemoved: [],
      keysRemoved: [],
      errors: [],
    };

    // Remove webhooks
    for (const id of deployment.webhookIds) {
      try {
        await this.github.deleteWebhook(deployment.repoFullName, id);
        result.webhooksRemoved.push(id);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) {
          result.webhooksRemoved.push(id); // already gone — idempotent
        } else {
          result.errors.push({ resource: 'webhook', id, message: e.message ?? 'unknown', code: 'DELETE_FAILED' });
        }
      }
    }

    // Remove deploy keys
    for (const id of deployment.deployKeyIds) {
      try {
        await this.github.deleteDeployKey(deployment.repoFullName, id);
        result.keysRemoved.push(id);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) {
          result.keysRemoved.push(id); // already gone — idempotent
        } else {
          result.errors.push({ resource: 'deploy_key', id, message: e.message ?? 'unknown', code: 'DELETE_FAILED' });
        }
      }
    }

    // Delete repository
    try {
      const exists = await this.github.repositoryExists(deployment.repoFullName);
      if (exists) {
        await this.github.deleteRepository(deployment.repoFullName);
      }
      result.repoDeleted = true;
    } catch (err) {
      const e = err as { message?: string };
      result.errors.push({ resource: 'repository', message: e.message ?? 'unknown', code: 'DELETE_FAILED' });
    }

    result.success = result.errors.length === 0;
    return result;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeployment(overrides?: Partial<Deployment>): Deployment {
  return {
    id: 'dep-1',
    repoFullName: 'acme/my-dex',
    webhookIds: [101, 102],
    deployKeyIds: [201],
    ...overrides,
  };
}

function makeGitHubClient(): GitHubClient {
  return {
    deleteRepository: vi.fn().mockResolvedValue(undefined),
    deleteWebhook: vi.fn().mockResolvedValue(undefined),
    deleteDeployKey: vi.fn().mockResolvedValue(undefined),
    repositoryExists: vi.fn().mockResolvedValue(true),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Repository deletion on deployment delete', () => {
  it('deletes the repository when it exists', async () => {
    const github = makeGitHubClient();
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment());
    expect(github.deleteRepository).toHaveBeenCalledWith('acme/my-dex');
    expect(result.repoDeleted).toBe(true);
  });

  it('skips deleteRepository call when repo does not exist', async () => {
    const github = makeGitHubClient();
    (github.repositoryExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment());
    expect(github.deleteRepository).not.toHaveBeenCalled();
    expect(result.repoDeleted).toBe(true);
  });

  it('reports success when all resources are cleaned up', async () => {
    const github = makeGitHubClient();
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment());
    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports failure when repository deletion throws', async () => {
    const github = makeGitHubClient();
    (github.deleteRepository as ReturnType<typeof vi.fn>).mockRejectedValue({ message: 'forbidden', status: 403 });
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment());
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.resource === 'repository')).toBe(true);
  });
});

describe('Cleanup of repository webhooks', () => {
  it('deletes all webhooks for the deployment', async () => {
    const github = makeGitHubClient();
    const svc = new RepositoryCleanupService(github);
    await svc.cleanup(makeDeployment({ webhookIds: [101, 102] }));
    expect(github.deleteWebhook).toHaveBeenCalledWith('acme/my-dex', 101);
    expect(github.deleteWebhook).toHaveBeenCalledWith('acme/my-dex', 102);
  });

  it('records removed webhook IDs in result', async () => {
    const github = makeGitHubClient();
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [101, 102] }));
    expect(result.webhooksRemoved).toEqual(expect.arrayContaining([101, 102]));
  });

  it('handles deployment with no webhooks', async () => {
    const github = makeGitHubClient();
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [] }));
    expect(github.deleteWebhook).not.toHaveBeenCalled();
    expect(result.webhooksRemoved).toHaveLength(0);
  });

  it('records error when webhook deletion fails with non-404', async () => {
    const github = makeGitHubClient();
    (github.deleteWebhook as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 500, message: 'server error' });
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [101] }));
    expect(result.errors.some((e) => e.resource === 'webhook' && e.id === 101)).toBe(true);
  });
});

describe('Cleanup of deployment keys', () => {
  it('deletes all deploy keys for the deployment', async () => {
    const github = makeGitHubClient();
    const svc = new RepositoryCleanupService(github);
    await svc.cleanup(makeDeployment({ deployKeyIds: [201, 202] }));
    expect(github.deleteDeployKey).toHaveBeenCalledWith('acme/my-dex', 201);
    expect(github.deleteDeployKey).toHaveBeenCalledWith('acme/my-dex', 202);
  });

  it('records removed key IDs in result', async () => {
    const github = makeGitHubClient();
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ deployKeyIds: [201] }));
    expect(result.keysRemoved).toContain(201);
  });

  it('handles deployment with no deploy keys', async () => {
    const github = makeGitHubClient();
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ deployKeyIds: [] }));
    expect(github.deleteDeployKey).not.toHaveBeenCalled();
    expect(result.keysRemoved).toHaveLength(0);
  });

  it('records error when deploy key deletion fails with non-404', async () => {
    const github = makeGitHubClient();
    (github.deleteDeployKey as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 500, message: 'server error' });
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ deployKeyIds: [201] }));
    expect(result.errors.some((e) => e.resource === 'deploy_key' && e.id === 201)).toBe(true);
  });
});

describe('Cleanup idempotency', () => {
  it('treats 404 on webhook deletion as already removed (idempotent)', async () => {
    const github = makeGitHubClient();
    (github.deleteWebhook as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 404 });
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [101] }));
    expect(result.webhooksRemoved).toContain(101);
    expect(result.errors).toHaveLength(0);
  });

  it('treats 404 on deploy key deletion as already removed (idempotent)', async () => {
    const github = makeGitHubClient();
    (github.deleteDeployKey as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 404 });
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ deployKeyIds: [201] }));
    expect(result.keysRemoved).toContain(201);
    expect(result.errors).toHaveLength(0);
  });

  it('running cleanup twice does not produce errors on second run', async () => {
    const github = makeGitHubClient();
    // Second run: everything returns 404 (already deleted)
    (github.deleteWebhook as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue({ status: 404 });
    (github.deleteDeployKey as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue({ status: 404 });
    (github.repositoryExists as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    const svc = new RepositoryCleanupService(github);
    const dep = makeDeployment();
    await svc.cleanup(dep);
    const second = await svc.cleanup(dep);
    expect(second.success).toBe(true);
    expect(second.errors).toHaveLength(0);
  });

  it('cleanup of a non-existent repo is idempotent', async () => {
    const github = makeGitHubClient();
    (github.repositoryExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [], deployKeyIds: [] }));
    expect(result.repoDeleted).toBe(true);
    expect(result.success).toBe(true);
  });
});

describe('Cleanup failure handling', () => {
  it('continues cleanup of remaining resources after one webhook fails', async () => {
    const github = makeGitHubClient();
    (github.deleteWebhook as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce({ status: 500, message: 'error' })
      .mockResolvedValueOnce(undefined);
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [101, 102] }));
    expect(result.webhooksRemoved).toContain(102);
  });

  it('continues to delete repo even if webhook cleanup fails', async () => {
    const github = makeGitHubClient();
    (github.deleteWebhook as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 500, message: 'error' });
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [101] }));
    expect(github.deleteRepository).toHaveBeenCalled();
    expect(result.repoDeleted).toBe(true);
  });

  it('collects all errors when multiple resources fail', async () => {
    const github = makeGitHubClient();
    (github.deleteWebhook as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 500, message: 'err' });
    (github.deleteDeployKey as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 500, message: 'err' });
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [101], deployKeyIds: [201] }));
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.success).toBe(false);
  });

  it('error entries include resource type and id', async () => {
    const github = makeGitHubClient();
    (github.deleteWebhook as ReturnType<typeof vi.fn>).mockRejectedValue({ status: 500, message: 'fail' });
    const svc = new RepositoryCleanupService(github);
    const result = await svc.cleanup(makeDeployment({ webhookIds: [101], deployKeyIds: [] }));
    const err = result.errors[0];
    expect(err.resource).toBe('webhook');
    expect(err.id).toBe(101);
    expect(err.code).toBe('DELETE_FAILED');
  });
});
