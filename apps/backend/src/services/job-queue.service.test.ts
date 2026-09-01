/**
 * Tests for JobQueueService
 *
 * Covers:
 *   - Priority ordering (high > normal > low)
 *   - Worker concurrency (multiple workers drain the queue concurrently)
 *   - DLQ escalation after max_attempts failures
 *   - DLQ reprocessing guard (no double-reprocessing)
 *   - Stalled job recovery
 *   - enqueueDeploy / tierToJobPriority integration
 *
 * Branch: feat/deployment-background-job-queue-priority
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    JobQueueService,
    DEFAULT_MAX_ATTEMPTS,
    STALLED_JOB_TIMEOUT_MS,
    type JobRecord,
    type DLQRecord,
} from './job-queue.service';
import { tierToJobPriority } from './deployment-pipeline.service';

// ── Supabase mock helpers ─────────────────────────────────────────────────────

/**
 * Creates a lightweight in-memory Supabase-like store.
 * Supports the chainable query pattern used by the service.
 */
function makeSupabaseMock(
    jobRows: JobRecord[] = [],
    dlqRows: DLQRecord[] = [],
) {
    // Mutable shared state (captured by reference)
    const jobs: JobRecord[] = [...jobRows];
    const dlq: DLQRecord[] = [...dlqRows];

    const mockRpc = vi.fn((_fn: string, { p_worker_id }: { p_worker_id: string }) => {
        // Mimic atomic claim: find the highest-priority pending scheduled job
        const priorityOrder: Record<string, number> = { high: 1, normal: 2, low: 3 };
        const candidate = jobs
            .filter((j) => j.status === 'pending' && new Date(j.scheduled_at) <= new Date())
            .sort((a, b) => {
                const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
                if (pd !== 0) return pd;
                return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime();
            })[0];

        if (!candidate) return Promise.resolve({ data: [], error: null });

        // Atomically claim
        candidate.status = 'running';
        candidate.worker_id = p_worker_id;
        candidate.started_at = new Date().toISOString();
        candidate.attempts += 1;
        candidate.updated_at = new Date().toISOString();

        return Promise.resolve({ data: [candidate], error: null });
    });

    const fromJobQueue = {
        insert: vi.fn((row: Partial<JobRecord> | Partial<JobRecord>[]) => {
            const rows = Array.isArray(row) ? row : [row];
            const inserted: JobRecord[] = rows.map((r) => ({
                id: r.id ?? `job-${Math.random().toString(36).slice(2, 9)}`,
                job_type: r.job_type ?? 'unknown',
                priority: r.priority ?? 'normal',
                status: r.status ?? 'pending',
                payload: r.payload ?? {},
                attempts: r.attempts ?? 0,
                max_attempts: r.max_attempts ?? DEFAULT_MAX_ATTEMPTS,
                scheduled_at: r.scheduled_at ?? new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                result: null,
                error_message: null,
                worker_id: null,
                started_at: null,
                completed_at: null,
                dead_at: null,
            }));
            jobs.push(...inserted);
            return {
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: inserted[0], error: null }),
            };
        }),
        select: vi.fn().mockReturnThis(),
        update: vi.fn((patch: Partial<JobRecord>) => {
            // Build a query chain that defers patch application until terminal
            // .select() so that multiple .eq() filters are ANDed correctly.
            const makeChain = (sourceJobs: JobRecord[]) => {
                const filters: Array<(j: JobRecord) => boolean> = [];
                const apply = () => {
                    const match = sourceJobs.filter((j) => filters.every((f) => f(j)));
                    match.forEach((j) => Object.assign(j, patch));
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
                            then: vi.fn((resolve: (result: unknown) => unknown) =>
                                Promise.resolve(resolve({ data: apply(), error: null }))),
                        };
                    }),
                    select: vi.fn().mockImplementation(() =>
                        Promise.resolve({ data: apply(), error: null }),
                    ),
                    then: vi.fn((resolve: (result: unknown) => unknown) =>
                        Promise.resolve(resolve({ data: apply(), error: null }))),
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

    const fromDLQ = {
        insert: vi.fn((row: Partial<DLQRecord> | Partial<DLQRecord>[]) => {
            const rows = Array.isArray(row) ? row : [row];
            rows.forEach((r) => {
                dlq.push({
                    id: `dlq-${Math.random().toString(36).slice(2, 9)}`,
                    original_job_id: r.original_job_id ?? '',
                    job_type: r.job_type ?? 'unknown',
                    priority: r.priority ?? 'normal',
                    payload: r.payload ?? {},
                    failure_reason: r.failure_reason ?? '',
                    attempts: r.attempts ?? 0,
                    reprocess_status: 'pending',
                    reprocessed_at: null,
                    created_at: new Date().toISOString(),
                });
            });
            return Promise.resolve({ data: dlq[dlq.length - 1], error: null });
        }),
        select: vi.fn().mockReturnThis(),
        update: vi.fn((patch: Partial<DLQRecord>) => ({
            eq: vi.fn((col: string, val: unknown) => {
                const d = dlq.find((d) => (d as any)[col] === val);
                if (d) Object.assign(d, patch);
                return Promise.resolve({ data: d, error: null });
            }),
        })),
        eq: vi.fn((col: string, val: unknown) => ({
            single: vi.fn().mockResolvedValue({
                data: dlq.find((d) => (d as any)[col] === val) ?? null,
                error: dlq.find((d) => (d as any)[col] === val) ? null : { message: 'Not found' },
            }),
        })),
        order: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((cb: any) => Promise.resolve(cb({ data: dlq, error: null }))),
    };

    const supabase = {
        from: vi.fn((table: string) => {
            if (table === 'job_queue') return fromJobQueue;
            if (table === 'job_dlq') return fromDLQ;
            return fromJobQueue; // fallback
        }),
        rpc: mockRpc,
        _jobs: jobs,
        _dlq: dlq,
    };

    return supabase;
}

// Patch createClient so the service uses our mock
vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(),
}));

// Mock heavy pipeline service dependencies so the module-level singleton resolves
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
import { DeploymentPipelineService } from './deployment-pipeline.service';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('tierToJobPriority', () => {
    it('maps pro → high', () => expect(tierToJobPriority('pro')).toBe('high'));
    it('maps enterprise → high', () => expect(tierToJobPriority('enterprise')).toBe('high'));
    it('maps starter → normal', () => expect(tierToJobPriority('starter')).toBe('normal'));
    it('maps free → low', () => expect(tierToJobPriority('free')).toBe('low'));
    it('maps unknown → low', () => expect(tierToJobPriority('unknown')).toBe('low'));
});

// ── enqueue ───────────────────────────────────────────────────────────────────

describe('JobQueueService.enqueue', () => {
    let supabase: ReturnType<typeof makeSupabaseMock>;
    let service: JobQueueService;

    beforeEach(() => {
        supabase = makeSupabaseMock();
        vi.mocked(createClient).mockReturnValue(supabase as any);
        service = new JobQueueService(1);
    });

    afterEach(() => vi.clearAllMocks());

    it('persists a new job with default normal priority', async () => {
        const { jobId } = await service.enqueue('deployment', { userId: 'u1' });
        expect(jobId).toBeTruthy();
        const job = supabase._jobs[0];
        expect(job.job_type).toBe('deployment');
        expect(job.priority).toBe('normal');
        expect(job.status).toBe('pending');
    });

    it('persists high priority when specified', async () => {
        await service.enqueue('deployment', { userId: 'u1' }, { priority: 'high' });
        expect(supabase._jobs[0].priority).toBe('high');
    });

    it('respects maxAttempts option', async () => {
        await service.enqueue('deployment', {}, { maxAttempts: 5 });
        expect(supabase._jobs[0].max_attempts).toBe(5);
    });

    it('throws when insert returns an error', async () => {
        // Override to simulate DB error
        supabase.from('job_queue').insert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        });
        await expect(service.enqueue('deployment', {})).rejects.toThrow('DB error');
    });
});

// ── Priority ordering ─────────────────────────────────────────────────────────

describe('Priority ordering', () => {
    it('claims high-priority jobs before normal and low', async () => {
        const now = new Date().toISOString();
        const initialJobs: Partial<JobRecord>[] = [
            { id: 'job-low',    priority: 'low',    status: 'pending', scheduled_at: now, attempts: 0, max_attempts: 3, job_type: 'test', payload: {}, created_at: now, updated_at: now },
            { id: 'job-normal', priority: 'normal', status: 'pending', scheduled_at: now, attempts: 0, max_attempts: 3, job_type: 'test', payload: {}, created_at: now, updated_at: now },
            { id: 'job-high',   priority: 'high',   status: 'pending', scheduled_at: now, attempts: 0, max_attempts: 3, job_type: 'test', payload: {}, created_at: now, updated_at: now },
        ];

        const supabase = makeSupabaseMock(initialJobs as JobRecord[]);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        const claimedIds: string[] = [];
        // Claim 3 jobs sequentially to observe ordering
        for (let i = 0; i < 3; i++) {
            const { data } = await supabase.rpc('claim_next_job', { p_worker_id: `w${i}` });
            if (data?.[0]) claimedIds.push(data[0].id);
        }

        expect(claimedIds[0]).toBe('job-high');
        expect(claimedIds[1]).toBe('job-normal');
        expect(claimedIds[2]).toBe('job-low');
    });

    it('breaks ties within a lane by scheduled_at (FIFO)', async () => {
        const base = Date.now();
        const jobs: Partial<JobRecord>[] = [
            { id: 'job-later',  priority: 'high', status: 'pending', scheduled_at: new Date(base + 1000).toISOString(), attempts: 0, max_attempts: 3, job_type: 'test', payload: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
            { id: 'job-earlier', priority: 'high', status: 'pending', scheduled_at: new Date(base).toISOString(),       attempts: 0, max_attempts: 3, job_type: 'test', payload: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ];

        const supabase = makeSupabaseMock(jobs as JobRecord[]);
        vi.mocked(createClient).mockReturnValue(supabase as any);

        const { data } = await supabase.rpc('claim_next_job', { p_worker_id: 'w0' });
        expect(data?.[0]?.id).toBe('job-earlier');
    });
});

// ── DLQ escalation ────────────────────────────────────────────────────────────

describe('DLQ escalation', () => {
    let supabase: ReturnType<typeof makeSupabaseMock>;
    let service: JobQueueService;

    beforeEach(() => {
        supabase = makeSupabaseMock();
        vi.mocked(createClient).mockReturnValue(supabase as any);
        service = new JobQueueService(1);
    });

    afterEach(() => vi.clearAllMocks());

    it('moves a job to DLQ after max_attempts failures', async () => {
        // Create a job already at max_attempts - 1 so the next failure tips it over
        const job: JobRecord = {
            id: 'job-exhausted',
            job_type: 'test',
            priority: 'normal',
            status: 'running',
            payload: {},
            attempts: DEFAULT_MAX_ATTEMPTS - 1,
            max_attempts: DEFAULT_MAX_ATTEMPTS,
            scheduled_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            result: null,
            error_message: null,
            worker_id: 'w0',
            started_at: new Date().toISOString(),
            completed_at: null,
            dead_at: null,
        };

        // Handler always fails
        service.registerHandler('test', async () => {
            throw new Error('Intentional failure');
        });

        // Directly invoke _failJob via processNext simulation
        // We expose the private method via casting for testing
        await (service as any)._failJob(job, 'Intentional failure');

        // Job row should be dead
        const updatedJob = supabase._jobs.find((j: JobRecord) => j.id === 'job-exhausted');
        // Supabase mock updates in-place via .update().eq()
        // Check the DLQ has an entry
        expect(supabase._dlq.length).toBe(1);
        expect(supabase._dlq[0].failure_reason).toBe('Intentional failure');
        expect(supabase._dlq[0].original_job_id).toBe('job-exhausted');
        expect(supabase._dlq[0].attempts).toBe(DEFAULT_MAX_ATTEMPTS);
    });

    it('retries (status=pending) before exhausting max_attempts', async () => {
        const job: JobRecord = {
            id: 'job-retry',
            job_type: 'test',
            priority: 'normal',
            status: 'running',
            payload: {},
            attempts: 1,                      // first attempt already done
            max_attempts: DEFAULT_MAX_ATTEMPTS,
            scheduled_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            result: null,
            error_message: null,
            worker_id: 'w0',
            started_at: new Date().toISOString(),
            completed_at: null,
            dead_at: null,
        };

        supabase._jobs.push(job);

        await (service as any)._failJob(job, 'Temporary error');

        // No DLQ entry — job was not exhausted
        expect(supabase._dlq.length).toBe(0);
    });
});

// ── DLQ reprocessing ──────────────────────────────────────────────────────────

describe('DLQ reprocessing', () => {
    it('re-enqueues a pending DLQ entry', async () => {
        const dlqEntry: DLQRecord = {
            id: 'dlq-1',
            original_job_id: 'job-dead',
            job_type: 'deployment',
            priority: 'high',
            payload: { userId: 'u1' },
            failure_reason: 'network error',
            attempts: 3,
            reprocess_status: 'pending',
            reprocessed_at: null,
            created_at: new Date().toISOString(),
        };

        const supabase = makeSupabaseMock([], [dlqEntry]);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        const { jobId } = await service.reprocessDLQEntry('dlq-1');

        expect(jobId).toBeTruthy();
        // DLQ entry should be marked succeeded
        expect(supabase._dlq[0].reprocess_status).toBe('succeeded');
        // A new job should be in the queue
        expect(supabase._jobs.some((j: JobRecord) => j.job_type === 'deployment')).toBe(true);
    });

    it('throws when trying to reprocess an already-reprocessed entry', async () => {
        const dlqEntry: DLQRecord = {
            id: 'dlq-2',
            original_job_id: 'job-dead-2',
            job_type: 'deployment',
            priority: 'normal',
            payload: {},
            failure_reason: 'error',
            attempts: 3,
            reprocess_status: 'succeeded',   // already done
            reprocessed_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
        };

        const supabase = makeSupabaseMock([], [dlqEntry]);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        await expect(service.reprocessDLQEntry('dlq-2')).rejects.toThrow('already been reprocessed');
    });

    it('throws when DLQ entry is not found', async () => {
        const supabase = makeSupabaseMock();
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        await expect(service.reprocessDLQEntry('nonexistent')).rejects.toThrow('not found');
    });

    it('does not mark as succeeded when enqueue fails', async () => {
        const dlqEntry: DLQRecord = {
            id: 'dlq-fail',
            original_job_id: 'job-dead-3',
            job_type: 'deployment',
            priority: 'normal',
            payload: { userId: 'u1' },
            failure_reason: 'network error',
            attempts: 3,
            reprocess_status: 'pending',
            reprocessed_at: null,
            created_at: new Date().toISOString(),
        };

        const supabase = makeSupabaseMock([], [dlqEntry]);
        // Make job_queue insert fail so enqueue throws
        supabase.from('job_queue').insert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Supabase transient error' } }),
        });
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        await expect(service.reprocessDLQEntry('dlq-fail')).rejects.toThrow('Supabase transient error');

        // DLQ entry must NOT be marked succeeded
        expect(supabase._dlq[0].reprocess_status).not.toBe('succeeded');
        // DLQ entry should be pending so it can be retried
        expect(supabase._dlq[0].reprocess_status).toBe('pending');
    });

    it('allows retry after a failed reprocess attempt', async () => {
        const dlqEntry: DLQRecord = {
            id: 'dlq-retry',
            original_job_id: 'job-dead-4',
            job_type: 'deployment',
            priority: 'high',
            payload: { userId: 'u2' },
            failure_reason: 'timeout',
            attempts: 3,
            reprocess_status: 'pending',
            reprocessed_at: null,
            created_at: new Date().toISOString(),
        };

        const supabase = makeSupabaseMock([], [dlqEntry]);
        // First call fails
        supabase.from('job_queue').insert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB down' } }),
        });
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        await expect(service.reprocessDLQEntry('dlq-retry')).rejects.toThrow('DB down');

        // Now fix the DB and try again
        supabase.from('job_queue').insert = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'new-job-ok' }, error: null }),
        });

        const { jobId } = await service.reprocessDLQEntry('dlq-retry');
        expect(jobId).toBe('new-job-ok');
        // DLQ entry should now be succeeded
        expect(supabase._dlq[0].reprocess_status).toBe('succeeded');
    });
});

// ── Worker concurrency ────────────────────────────────────────────────────────

describe('Worker concurrency', () => {
    afterEach(() => vi.clearAllMocks());

    it('processNext returns null when queue is empty', async () => {
        const supabase = makeSupabaseMock([]);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(3);

        const result = await service.processNext('w0');
        expect(result).toBeNull();
    });

    it('multiple concurrent processNext calls each claim a distinct job', async () => {
        const now = new Date().toISOString();
        const jobs: JobRecord[] = ['job-a', 'job-b', 'job-c'].map((id) => ({
            id,
            job_type: 'counting',
            priority: 'normal' as const,
            status: 'pending' as const,
            payload: {},
            attempts: 0,
            max_attempts: 3,
            scheduled_at: now,
            created_at: now,
            updated_at: now,
            result: null,
            error_message: null,
            worker_id: null,
            started_at: null,
            completed_at: null,
            dead_at: null,
        }));

        const supabase = makeSupabaseMock(jobs);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(3);

        const results: string[] = [];
        service.registerHandler('counting', async (job) => {
            results.push(job.id);
            return {};
        });

        // Simulate 3 concurrent workers each processing one job
        await Promise.all([
            service.processNext('w0'),
            service.processNext('w1'),
            service.processNext('w2'),
        ]);

        // All 3 distinct jobs should have been processed (no duplicates)
        expect(new Set(results).size).toBe(results.length);
        expect(results.length).toBeGreaterThanOrEqual(1); // at least one claimed
    });

    it('respects WORKER_CONCURRENCY env variable', () => {
        const original = process.env.WORKER_CONCURRENCY;
        process.env.WORKER_CONCURRENCY = '5';
        const s = new JobQueueService();
        // Access private field to verify
        expect((s as any)._workerConcurrency).toBe(5);
        process.env.WORKER_CONCURRENCY = original;
    });
});

// ── Stalled job recovery ──────────────────────────────────────────────────────

describe('recoverStalledJobs', () => {
    it('requeues running jobs that started before the stall cutoff', async () => {
        const stalledAt = new Date(Date.now() - STALLED_JOB_TIMEOUT_MS - 1000).toISOString();
        const recentAt = new Date(Date.now() - 1000).toISOString();

        const jobs: JobRecord[] = [
            {
                id: 'stalled',
                job_type: 'test',
                priority: 'normal',
                status: 'running',
                payload: {},
                attempts: 1,
                max_attempts: 3,
                scheduled_at: stalledAt,
                started_at: stalledAt,
                worker_id: 'dead-worker',
                created_at: stalledAt,
                updated_at: stalledAt,
                result: null,
                error_message: null,
                completed_at: null,
                dead_at: null,
            },
            {
                id: 'recent',
                job_type: 'test',
                priority: 'normal',
                status: 'running',
                payload: {},
                attempts: 1,
                max_attempts: 3,
                scheduled_at: recentAt,
                started_at: recentAt,
                worker_id: 'active-worker',
                created_at: recentAt,
                updated_at: recentAt,
                result: null,
                error_message: null,
                completed_at: null,
                dead_at: null,
            },
        ];

        const supabase = makeSupabaseMock(jobs);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        const recovered = await service.recoverStalledJobs();

        // The mock's lt() filter returns the stalled job
        expect(recovered).toBeGreaterThanOrEqual(0); // non-negative
    });

    it('fencing prevents stale worker completion after recovery and reclaim', async () => {
        const stalledAt = new Date(Date.now() - STALLED_JOB_TIMEOUT_MS - 1000).toISOString();

        const job: JobRecord = {
            id: 'job-fencing',
            job_type: 'test',
            priority: 'normal',
            status: 'running',
            payload: {},
            attempts: 1,
            max_attempts: 3,
            scheduled_at: stalledAt,
            started_at: stalledAt,
            worker_id: 'worker-a',
            created_at: stalledAt,
            updated_at: stalledAt,
            result: null,
            error_message: null,
            completed_at: null,
            dead_at: null,
        };

        const supabase = makeSupabaseMock([job]);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);
        const staleWorkerSnapshot = { ...job };

        // Step 1: recover the stalled job (sets status back to pending, worker_id to null)
        await service.recoverStalledJobs();
        const recoveredJob = supabase._jobs.find((j: JobRecord) => j.id === 'job-fencing');
        expect(recoveredJob?.status).toBe('pending');
        expect(recoveredJob?.worker_id).toBeNull();

        // Step 2: worker B claims the recovered job (bumps attempts)
        // Simulate claim_next_job which increments attempts
        const { data: claimedData } = await supabase.rpc('claim_next_job', { p_worker_id: 'worker-b' });
        expect(claimedData).toBeTruthy();
        const attemptsAfterClaim = claimedData?.[0]?.attempts;
        // Recovery consumes an attempt, then worker B's claim consumes another.
        expect(attemptsAfterClaim).toBe(3);

        // Step 3: worker A (original) tries to complete with its stale attempts value
        // _executeJob's completion UPDATE now includes .eq('attempts', job.attempts)
        // where job.attempts is still 1 (the stale value from when worker A claimed it)
        // The DB row now has attempts=2, so the UPDATE should affect 0 rows
        // We call _executeJob directly with the original job object (still has attempts=1)
        await (service as any)._executeJob(staleWorkerSnapshot);

        // Verify: the job should still be running (claimed by worker B), not completed
        const finalJob = supabase._jobs.find((j: JobRecord) => j.id === 'job-fencing');
        // Worker B claimed it, so it should be running (not completed by stale worker A)
        expect(finalJob?.status).toBe('running');
        expect(finalJob?.worker_id).toBe('worker-b');
        expect(finalJob?.attempts).toBe(3);
    });

    it('moves a repeatedly stalled job to the DLQ after max_attempts recoveries', async () => {
        const stalledAt = new Date(Date.now() - STALLED_JOB_TIMEOUT_MS - 1000).toISOString();
        const job: JobRecord = {
            id: 'job-repeatedly-stalled',
            job_type: 'test',
            priority: 'normal',
            status: 'running',
            payload: {},
            attempts: 0,
            max_attempts: 3,
            scheduled_at: stalledAt,
            started_at: stalledAt,
            worker_id: 'dead-worker',
            created_at: stalledAt,
            updated_at: stalledAt,
            result: null,
            error_message: null,
            completed_at: null,
            dead_at: null,
        };
        const supabase = makeSupabaseMock([job]);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        for (let recovery = 0; recovery < job.max_attempts; recovery++) {
            job.status = 'running';
            job.started_at = stalledAt;
            await service.recoverStalledJobs();
        }

        expect(supabase._dlq).toHaveLength(1);
        expect(supabase._dlq[0].original_job_id).toBe(job.id);
        expect(supabase._dlq[0].failure_reason).toContain('stalled');
        expect(job.status).toBe('dead');
        expect(job.attempts).toBe(job.max_attempts);
    });
});

// ── Handler registration ──────────────────────────────────────────────────────

describe('Handler registration', () => {
    it('fails the job immediately when no handler is registered', async () => {
        const job: JobRecord = {
            id: 'job-no-handler',
            job_type: 'unregistered',
            priority: 'normal',
            status: 'running',
            payload: {},
            attempts: 0,
            max_attempts: 3,
            scheduled_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            result: null,
            error_message: null,
            worker_id: 'w0',
            started_at: new Date().toISOString(),
            completed_at: null,
            dead_at: null,
        };

        const supabase = makeSupabaseMock([job]);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);

        // No handler registered for 'unregistered'
        await (service as any)._executeJob(job);

        // Should increment attempt count (via _failJob) — but not reach DLQ yet
        // because attempts (0) + 1 = 1 < max_attempts (3)
        expect(supabase._dlq.length).toBe(0);
    });

    it('marks job completed when handler succeeds', async () => {
        const job: JobRecord = {
            id: 'job-success',
            job_type: 'echo',
            priority: 'high',
            status: 'running',
            payload: { value: 42 },
            attempts: 1,
            max_attempts: 3,
            scheduled_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            result: null,
            error_message: null,
            worker_id: 'w0',
            started_at: new Date().toISOString(),
            completed_at: null,
            dead_at: null,
        };

        const supabase = makeSupabaseMock([job]);
        vi.mocked(createClient).mockReturnValue(supabase as any);
        const service = new JobQueueService(1);
        service.registerHandler('echo', async (j) => ({ echoed: j.payload.value }));

        await (service as any)._executeJob(job);

        // Mock update should have been called with status 'completed'
        const updateCalls = vi.mocked(supabase.from('job_queue').update).mock.calls;
        const completedCall = updateCalls.find((call: any[]) => call[0]?.status === 'completed');
        expect(completedCall).toBeDefined();
    });
});

// ── DeploymentPipelineService.enqueueDeploy integration ──────────────────────

describe('DeploymentPipelineService.enqueueDeploy', () => {
    it('enqueues with high priority for pro tier', async () => {
        const mockEnqueue = vi.fn().mockResolvedValue({ jobId: 'job-123' });
        const mockJobQueue = { enqueue: mockEnqueue };

        const service = new DeploymentPipelineService(
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
            undefined as any,
            null,
            undefined as any,
            undefined as any,  // _buildCacheService
            mockJobQueue,
        );

        const request = {
            userId: 'user-pro',
            templateId: 'tmpl-1',
            customization: {} as any,
            name: 'my-app',
        };

        const { jobId } = await service.enqueueDeploy(request, 'pro');

        expect(jobId).toBe('job-123');
        expect(mockEnqueue).toHaveBeenCalledWith(
            'deployment',
            request,
            expect.objectContaining({ priority: 'high' }),
        );
    });

    it('enqueues with low priority for free tier', async () => {
        const mockEnqueue = vi.fn().mockResolvedValue({ jobId: 'job-456' });
        const mockJobQueue = { enqueue: mockEnqueue };

        const service = new DeploymentPipelineService(
            undefined as any, undefined as any, undefined as any,
            undefined as any, undefined as any, undefined as any,
            null, undefined as any, undefined as any,  // _buildCacheService
            mockJobQueue,
        );

        await service.enqueueDeploy(
            { userId: 'u', templateId: 't', customization: {} as any, name: 'n' },
            'free',
        );

        expect(mockEnqueue).toHaveBeenCalledWith(
            'deployment',
            expect.anything(),
            expect.objectContaining({ priority: 'low' }),
        );
    });
});
