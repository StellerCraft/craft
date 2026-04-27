/**
 * Deployment Cancellation Tests (#369)
 *
 * Verifies that in-progress deployments can be cancelled safely at every
 * pipeline stage without leaving orphaned GitHub repositories or Vercel
 * projects.
 *
 * All external API calls are mocked — no live infrastructure required.
 *
 * Cancellation contract:
 *   - A deployment can be cancelled at any stage: queued, building,
 *     pushing, deploying, or post-deploy.
 *   - Cancellation is idempotent: calling cancel twice is safe.
 *   - After cancellation the deployment status is "cancelled".
 *   - Any GitHub repo or Vercel project created before cancellation is
 *     deleted (no orphaned resources).
 *   - A cancellation notification is emitted.
 *   - Concurrent cancellation requests do not cause double-deletion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type DeploymentStage =
  | 'queued'
  | 'building'
  | 'pushing'
  | 'deploying'
  | 'post-deploy'
  | 'completed'
  | 'cancelled'
  | 'failed';

interface DeploymentState {
  id: string;
  stage: DeploymentStage;
  githubRepoId?: string;
  vercelProjectId?: string;
}

interface CancellationResult {
  deploymentId: string;
  status: 'cancelled' | 'already_cancelled' | 'not_cancellable';
  resourcesDeleted: string[];
}

// ── External API mocks ────────────────────────────────────────────────────────

interface GitHubApi {
  deleteRepository(repoId: string): Promise<void>;
}

interface VercelApi {
  cancelDeployment(projectId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

interface NotificationService {
  sendCancellationNotification(deploymentId: string): Promise<void>;
}

// ── Cancellation service ──────────────────────────────────────────────────────

const CANCELLABLE_STAGES: Set<DeploymentStage> = new Set([
  'queued', 'building', 'pushing', 'deploying', 'post-deploy',
]);

class DeploymentCancellationService {
  private inFlight = new Set<string>(); // guard against concurrent cancellations

  constructor(
    private readonly github: GitHubApi,
    private readonly vercel: VercelApi,
    private readonly notifications: NotificationService,
    private readonly db: Map<string, DeploymentState>,
  ) {}

  async cancel(deploymentId: string): Promise<CancellationResult> {
    const state = this.db.get(deploymentId);
    if (!state) throw new Error(`Deployment ${deploymentId} not found`);

    if (state.stage === 'cancelled') {
      return { deploymentId, status: 'already_cancelled', resourcesDeleted: [] };
    }

    if (!CANCELLABLE_STAGES.has(state.stage)) {
      return { deploymentId, status: 'not_cancellable', resourcesDeleted: [] };
    }

    // Idempotency guard for concurrent calls
    if (this.inFlight.has(deploymentId)) {
      // Wait for the in-flight cancellation to finish by polling state
      while (this.inFlight.has(deploymentId)) {
        await new Promise((r) => setTimeout(r, 0));
      }
      return { deploymentId, status: 'already_cancelled', resourcesDeleted: [] };
    }

    this.inFlight.add(deploymentId);
    const resourcesDeleted: string[] = [];

    try {
      // Cancel active Vercel deployment if one exists
      if (state.vercelProjectId && (state.stage === 'deploying' || state.stage === 'post-deploy')) {
        await this.vercel.cancelDeployment(state.vercelProjectId);
      }

      // Delete Vercel project if created
      if (state.vercelProjectId) {
        await this.vercel.deleteProject(state.vercelProjectId);
        resourcesDeleted.push(`vercel:${state.vercelProjectId}`);
      }

      // Delete GitHub repo if created
      if (state.githubRepoId) {
        await this.github.deleteRepository(state.githubRepoId);
        resourcesDeleted.push(`github:${state.githubRepoId}`);
      }

      // Update state
      state.stage = 'cancelled';
      this.db.set(deploymentId, state);

      // Notify
      await this.notifications.sendCancellationNotification(deploymentId);

      return { deploymentId, status: 'cancelled', resourcesDeleted };
    } finally {
      this.inFlight.delete(deploymentId);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApis() {
  const github: GitHubApi = { deleteRepository: vi.fn().mockResolvedValue(undefined) };
  const vercel: VercelApi = {
    cancelDeployment: vi.fn().mockResolvedValue(undefined),
    deleteProject:    vi.fn().mockResolvedValue(undefined),
  };
  const notifications: NotificationService = {
    sendCancellationNotification: vi.fn().mockResolvedValue(undefined),
  };
  return { github, vercel, notifications };
}

function makeDb(state: DeploymentState): Map<string, DeploymentState> {
  return new Map([[state.id, { ...state }]]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeploymentCancellationService – cancellation at each stage', () => {
  const stages: DeploymentStage[] = ['queued', 'building', 'pushing', 'deploying', 'post-deploy'];

  it.each(stages)('cancels deployment in "%s" stage', async (stage) => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-1', stage, githubRepoId: 'repo-1', vercelProjectId: 'proj-1' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    const result = await service.cancel('dep-1');

    expect(result.status).toBe('cancelled');
    expect(db.get('dep-1')?.stage).toBe('cancelled');
  });

  it('returns not_cancellable for completed deployment', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-2', stage: 'completed' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    const result = await service.cancel('dep-2');
    expect(result.status).toBe('not_cancellable');
  });

  it('returns not_cancellable for failed deployment', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-3', stage: 'failed' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    const result = await service.cancel('dep-3');
    expect(result.status).toBe('not_cancellable');
  });

  it('throws for unknown deployment id', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = new Map<string, DeploymentState>();
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await expect(service.cancel('ghost')).rejects.toThrow('not found');
  });
});

describe('DeploymentCancellationService – resource cleanup', () => {
  it('deletes GitHub repo when present', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-4', stage: 'building', githubRepoId: 'repo-42' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    const result = await service.cancel('dep-4');
    expect(github.deleteRepository).toHaveBeenCalledWith('repo-42');
    expect(result.resourcesDeleted).toContain('github:repo-42');
  });

  it('deletes Vercel project when present', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-5', stage: 'building', vercelProjectId: 'proj-99' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    const result = await service.cancel('dep-5');
    expect(vercel.deleteProject).toHaveBeenCalledWith('proj-99');
    expect(result.resourcesDeleted).toContain('vercel:proj-99');
  });

  it('deletes both GitHub repo and Vercel project when both exist', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-6', stage: 'pushing', githubRepoId: 'repo-6', vercelProjectId: 'proj-6' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    const result = await service.cancel('dep-6');
    expect(result.resourcesDeleted).toHaveLength(2);
    expect(result.resourcesDeleted).toContain('github:repo-6');
    expect(result.resourcesDeleted).toContain('vercel:proj-6');
  });

  it('skips GitHub deletion when no repo was created', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-7', stage: 'queued' }); // no githubRepoId
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-7');
    expect(github.deleteRepository).not.toHaveBeenCalled();
  });

  it('skips Vercel deletion when no project was created', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-8', stage: 'queued' }); // no vercelProjectId
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-8');
    expect(vercel.deleteProject).not.toHaveBeenCalled();
  });

  it('calls vercel.cancelDeployment only during deploying/post-deploy stages', async () => {
    for (const stage of ['deploying', 'post-deploy'] as DeploymentStage[]) {
      const { github, vercel, notifications } = makeApis();
      const db = makeDb({ id: 'dep-9', stage, vercelProjectId: 'proj-9' });
      const service = new DeploymentCancellationService(github, vercel, notifications, db);
      await service.cancel('dep-9');
      expect(vercel.cancelDeployment).toHaveBeenCalledWith('proj-9');
    }
  });

  it('does not call vercel.cancelDeployment during building stage', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-10', stage: 'building', vercelProjectId: 'proj-10' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-10');
    expect(vercel.cancelDeployment).not.toHaveBeenCalled();
    expect(vercel.deleteProject).toHaveBeenCalledWith('proj-10');
  });
});

describe('DeploymentCancellationService – cancellation notification', () => {
  it('sends notification after successful cancellation', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-11', stage: 'building' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-11');
    expect(notifications.sendCancellationNotification).toHaveBeenCalledWith('dep-11');
  });

  it('does not send notification for already-cancelled deployment', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-12', stage: 'cancelled' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-12');
    expect(notifications.sendCancellationNotification).not.toHaveBeenCalled();
  });

  it('does not send notification for non-cancellable deployment', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-13', stage: 'completed' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-13');
    expect(notifications.sendCancellationNotification).not.toHaveBeenCalled();
  });
});

describe('DeploymentCancellationService – database state after cancellation', () => {
  it('persists "cancelled" stage in db', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-14', stage: 'building' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-14');
    expect(db.get('dep-14')?.stage).toBe('cancelled');
  });

  it('does not mutate db for non-cancellable deployment', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-15', stage: 'completed' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-15');
    expect(db.get('dep-15')?.stage).toBe('completed');
  });
});

describe('DeploymentCancellationService – idempotency', () => {
  it('returns already_cancelled on second call', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-16', stage: 'building' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-16');
    const second = await service.cancel('dep-16');
    expect(second.status).toBe('already_cancelled');
  });

  it('does not delete resources twice on repeated cancellation', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-17', stage: 'building', githubRepoId: 'repo-17' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    await service.cancel('dep-17');
    await service.cancel('dep-17');
    expect(github.deleteRepository).toHaveBeenCalledTimes(1);
  });
});

describe('DeploymentCancellationService – concurrent cancellation requests', () => {
  it('handles two simultaneous cancel calls without double-deletion', async () => {
    const { github, vercel, notifications } = makeApis();
    const db = makeDb({ id: 'dep-18', stage: 'building', githubRepoId: 'repo-18', vercelProjectId: 'proj-18' });
    const service = new DeploymentCancellationService(github, vercel, notifications, db);

    const [r1, r2] = await Promise.all([service.cancel('dep-18'), service.cancel('dep-18')]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(['already_cancelled', 'cancelled']);
    expect(github.deleteRepository).toHaveBeenCalledTimes(1);
    expect(vercel.deleteProject).toHaveBeenCalledTimes(1);
  });
});
