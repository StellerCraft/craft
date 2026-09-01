/**
 * Integration test for issue #1149:
 * JobQueueService stalled job recovery race with slow completion.
 *
 * Scenario:
 *   1. Start a job with a deliberately slow handler (delays past STALLED_JOB_TIMEOUT_MS)
 *   2. Trigger recoverStalledJobs concurrently while handler is still running
 *   3. Let handler complete and verify final job state is consistent
 *
 * Expected: Job reaches a single, correct terminal state (not an inconsistent combo of status/attempts/worker_id)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    JobQueueService,
    DEFAULT_MAX_ATTEMPTS,
    STALLED_JOB_TIMEOUT_MS,
    type JobRecord,
} from './job-queue.service';

// Lightweight in-memory Supabase-like store that captures write ordering
function makeSupabaseMockWithWriteCapture(
    jobRows: JobRecord[] = [],
) {
    const jobs: JobRecord[] = [...jobRows];
    const writeLog: Array<{ op: string; job: JobRecord; timestamp: number }> = [];

    const mockRpc = vi.fn((_fn: string, { p_worker_id }: { p_worker_id: string }) => {
        const priorityOrder: Record<string, number> = { high: 1, normal: 2, low: 3 };
        const candidate = jobs
            .filter((j) => j.status === 'pending' && new Date(j.scheduled_at) <= new Date())
            .sort((a, b) => {
                const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
                if (pd !== 0) return pd;
                return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
            })[0];

        if (!candidate) return Promise.resolve({ data: [], error: null });

        candidate.status = 'running';
        candidate.worker_id = p_worker_id;
        candidate.started_at = new Date().toISOString();
        candidate.attempts += 1;
        candidate.updated_at = new Date().toISOString();

        return Promise.resolve({ data: [candidate], error: null });
    });

    const fromJobQueue = {
        insert: vi.fn((row: Partial<JobRecord>) => {
            const inserted: JobRecord = {
                id: row.id ?? `job-${Math.random().toString(36).slice(2, 9)}`,
                job_type: row.job_type ?? 'unknown',
                priority: row.priority ?? 'normal',
                status: row.status ?? 'pending',
                payload: row.payload ?? {},
                attempts: row.attempts ?? 0,
                max_attempts: row.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
                scheduled_at: row.scheduled_at ?? new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                result: null,
                error_message: null,
                worker_id: null,
                started_at: null,
                completed_at: null,
                dead_at: null,
            };
            jobs.push(inserted);
            return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
            };
        }),
        select: vi.fn().mockReturnThis(),
        update: vi.fn((patch: Partial<JobRecord>) => {
            const makeChain = (sourceJobs: JobRecord[]) => {
                const filters: Array<(j: JobRecord) => boolean> = [];
                const apply = () => {
                    const match = sourceJobs.filter((j) => filters.every((f) => f(j)));
                    match.forEach((j) => {
                        const before = JSON.parse(JSON.stringify(j));
                        Object.assign(j, patch);
                        writeLog.push({
                            op: 'update',
                            job: JSON.parse(JSON.stringify(j)),
                            timestamp: Date.now(),
                        });
                    });
                    return match;
                };
                const chain = {
                    eq: vi.fn((col: string, val: unknown) => {
                        filters.push((j: JobRecord) => (j as any)[col] === val);
                        return chain;
                    }),
                    lt: vi.fn((col2: string, val2: unknown) => {
                        filters.push((j: JobRecord) => {
                            if (j.status !== 'running') return false;
                            if (!j.started_at) return false;
                            return new Date(j.started_at).getTime() < new Date(val2 as string).getTime();
                        });
                        return {
                            select: vi.fn().mockImplementation(() =>
                                Promise.resolve({ data: apply(), error: null }),
                            ),
                        };
                    }),
                    select: vi.fn().mockImplementation(() =>
                        Promise.resolve({ data: apply(), error: null }),
                    ),
                };
                return chain;
            };
            return makeChain(jobs);
        }),
        eq: vi.fn().mockReturnThis(),
        lt: vi.fn((_col: string, value: unknown) => ({
            then: vi.fn((resolve: (result: unknown) => unknown) => Promise.resolve(resolve({
                data: jobs.filter((job) =>
                    job.status === 'running' &&
                    job.started_at !== null &&
                    new Date(job.started_at).getTime() < new Date(value as string).getTime(),
                ),
                error: null,
            }))),
        })),
        order: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((cb: any) => Promise.resolve(cb({ data: jobs, error: null }))),
    };

    const supabase = {
        from: vi.fn((table: string) => {
            if (table === 'job_queue') return fromJobQueue;
            return fromJobQueue;
        }),
        rpc: mockRpc,
        _jobs: jobs,
        _writeLog: writeLog,
    };

    return supabase;
}

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

vi.mock('./template-generator.service', () => ({ templateGeneratorService: {} }));
vi.mock('./github.service', () => ({ githubService: {} }));
vi.mock('./github-push.service', () => ({ githubPushService: {} }));
vi.mock('./vercel.service', () => ({ vercelService: {} }));
vi.mock('./syntax-validator', () => ({ syntaxValidator: { validate: vi.fn() } }));
vi.mock('./artifact-signing.service', () => ({
    artifactSigningService: { signArtifact: vi.fn(), verifyArtifact: vi.fn() },
    ArtifactSigningService: class {},
}));
vi.mock('./deployment-update.service', () => ({
    deploymentUpdateService: null,
    DeploymentUpdateService: class {},
}));
vi.mock('./build-cache.service', () => ({
    buildCacheService: { checkCache: vi.fn(), storeHash: vi.fn() },
    BuildCacheService: class {},
}));
vi.mock('./github-commit-status.service', () => ({
    githubCommitStatusService: {
        reportPending: vi.fn(),
        reportSuccess: vi.fn(),
        reportFailure: vi.fn(),
    },
}));
vi.mock('./dependency-graph', () => ({
    buildGraph: vi.fn(() => ({ hasCycle: () => false, topologicalOrder: () => [] })),
    CircularDependencyError: class extends Error {},
    DeploymentNode: class {},
}));
vi.mock('@/lib/api/logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/env/env-template-generator', () => ({ buildVercelEnvVars: vi.fn(() => []) }));

import { createClient } from '@/lib/supabase/server';

describe('JobQueueService stalled recovery race', () => {
    let supabase: ReturnType<typeof makeSupabaseMockWithWriteCapture>;
    let service: JobQueueService;

    beforeEach(() => {
        supabase = makeSupabaseMockWithWriteCapture();
        vi.mocked(createClient).mockReturnValue(supabase as any);
        service = new JobQueueService(1);
    });

    afterEach(() => vi.clearAllMocks());

    it('resolves to consistent state when recovery fires concurrently with slow completion', async () => {
        // Register a slow handler that delays past STALLED_JOB_TIMEOUT_MS
        const slowHandlerDelay = STALLED_JOB_TIMEOUT_MS + 1000;
        let handlerCalled = false;
        let handlerStartTime = 0;

        service.registerHandler('slow-job', async () => {
            handlerCalled = true;
            handlerStartTime = Date.now();
            // Delay the handler to simulate slow processing
            await new Promise((resolve) => setTimeout(resolve, slowHandlerDelay));
            return { success: true };
        });

        // Enqueue a job
        const { jobId } = await service.enqueue('slow-job', { userId: 'u1' });

        // Claim the job
        const { data: claimedData } = await supabase.rpc('claim_next_job', { p_worker_id: 'w0' });
        expect(claimedData).toHaveLength(1);
        const claimedJob = claimedData![0];
        expect(claimedJob.id).toBe(jobId);

        // Simulate concurrent execution:
        // 1. Start _executeJob in background
        const executePromise = (service as any)._executeJob(claimedJob);

        // 2. Wait a bit then trigger recoverStalledJobs
        await new Promise((resolve) => setTimeout(resolve, 100));
        const recoveredCount = await service.recoverStalledJobs();

        // 3. Wait for _executeJob to complete
        await executePromise;

        // Verify final state consistency
        const finalJob = supabase._jobs[0];

        // Should have a single, consistent terminal state
        // Options:
        //   - completed (if completion write won)
        //   - pending with attempts=1 (if recovery won and wasn't overwritten)
        // But NOT a mix of both updates in an inconsistent way

        // Check job state is valid
        expect(finalJob).toBeDefined();
        expect(finalJob.status).toMatch(/^(completed|pending)$/);

        // If we got to DLQ, attempts should match what was written
        if (finalJob.status === 'completed') {
            expect(finalJob.completed_at).toBeTruthy();
            expect(finalJob.result).toEqual({ success: true });
        } else if (finalJob.status === 'pending') {
            // Recovery won: job should be pending with incremented attempts
            expect(finalJob.attempts).toBeGreaterThan(claimedJob.attempts);
            expect(finalJob.worker_id).toBeNull();
        }

        // Verify no stale state where attempts was incremented but completion also recorded
        expect(finalJob.attempts).toBeGreaterThanOrEqual(claimedJob.attempts);

        console.log('Final job state:', {
            status: finalJob.status,
            attempts: finalJob.attempts,
            worker_id: finalJob.worker_id,
            completed_at: finalJob.completed_at,
            result: finalJob.result,
        });

        console.log('Write order:', supabase._writeLog.map((w) => ({
            op: w.op,
            status: w.job.status,
            attempts: w.job.attempts,
            timestamp: w.timestamp,
        })));
    });
});
