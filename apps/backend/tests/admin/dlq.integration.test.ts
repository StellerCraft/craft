// @vitest-environment node
/**
 * Combined DLQ Admin View – Integration Tests
 *
 * Verifies that GET /api/admin/dlq correctly aggregates entries from both
 * underlying dead-letter-queue sources:
 *
 *   • webhook_dlq  – in-memory WebhookDLQ (Stripe / GitHub webhook failures)
 *   • job_dlq      – Supabase-backed JobQueueService DLQ (background job failures)
 *
 * Because the real Supabase client is not available in the test environment,
 * jobQueueService.listDLQ() is mocked.  The webhook DLQ is exercised directly
 * against its real in-memory store to ensure the aggregation path is genuine.
 *
 * Run:
 *   npm run test --workspace=@craft/backend -- admin/dlq
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { webhookDLQ } from '@/lib/webhook-dlq/dead-letter-queue';
import type { DLQRecord } from '@/services/job-queue.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

/**
 * Stub the jobQueueService so we can seed job_dlq entries without Supabase.
 * We expose a mutable array that each test case can populate.
 */
const mockJobDLQRecords: DLQRecord[] = [];

vi.mock('@/services/job-queue.service', () => ({
    jobQueueService: {
        listDLQ: vi.fn(async () => [...mockJobDLQRecords]),
    },
}));

/**
 * The combined DLQ route uses withRole('admin'), which normally requires a
 * Supabase session.  We bypass it here by mocking withRole to call the handler
 * directly — this keeps the test focused on the aggregation logic rather than
 * auth plumbing.
 */
vi.mock('@/lib/api/with-role', () => ({
    withRole: (_role: string, handler: Function) => handler,
}));

// Import the route after mocks are set up.
const { GET } = await import('@/app/api/admin/dlq/route');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGetRequest(): NextRequest {
    return new NextRequest('http://localhost/api/admin/dlq', { method: 'GET' });
}

function makeJobDLQRecord(overrides: Partial<DLQRecord> = {}): DLQRecord {
    return {
        id: `job-dlq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        original_job_id: `job-${Date.now()}`,
        job_type: 'deploy:template',
        priority: 'normal',
        payload: { templateId: 'tpl-abc' },
        failure_reason: 'Deployment timed out',
        attempts: 3,
        reprocess_status: 'pending',
        reprocessed_at: null,
        created_at: new Date().toISOString(),
        ...overrides,
    };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
    // Reset both DLQ stores before each test.
    webhookDLQ._reset();
    mockJobDLQRecords.length = 0;
});

afterEach(() => {
    webhookDLQ._reset();
    mockJobDLQRecords.length = 0;
    vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/dlq – combined DLQ view', () => {
    // ── Empty state ────────────────────────────────────────────────────────────
    describe('when both DLQ sources are empty', () => {
        it('returns a 200 with zero entries', async () => {
            const res = await GET(makeGetRequest());
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.total).toBe(0);
            expect(body.entries).toHaveLength(0);
            expect(body.bySource.webhook_dlq).toBe(0);
            expect(body.bySource.job_dlq).toBe(0);
        });

        it('includes _links to individual DLQ routes', async () => {
            const res = await GET(makeGetRequest());
            const body = await res.json();
            expect(body._links.webhookDlq).toBe('/api/admin/webhooks/dlq');
            expect(body._links.webhookReplay).toBe('/api/admin/webhooks/replay');
        });
    });

    // ── Source tagging ─────────────────────────────────────────────────────────
    describe('source tagging', () => {
        it('tags webhook DLQ entries with source="webhook_dlq"', async () => {
            webhookDLQ.capture(
                'stripe',
                'charge.failed',
                JSON.stringify({ chargeId: 'ch_001' }),
                'Max retries exhausted',
                3
            );

            const res = await GET(makeGetRequest());
            const body = await res.json();
            const webhookEntry = body.entries.find((e: any) => e.source === 'webhook_dlq');
            expect(webhookEntry).toBeDefined();
            expect(webhookEntry.source).toBe('webhook_dlq');
        });

        it('tags job DLQ entries with source="job_dlq"', async () => {
            mockJobDLQRecords.push(makeJobDLQRecord());

            const res = await GET(makeGetRequest());
            const body = await res.json();
            const jobEntry = body.entries.find((e: any) => e.source === 'job_dlq');
            expect(jobEntry).toBeDefined();
            expect(jobEntry.source).toBe('job_dlq');
        });
    });

    // ── Aggregation ────────────────────────────────────────────────────────────
    describe('aggregation of both sources', () => {
        it('reflects entries from both sources in a single response', async () => {
            // Seed webhook DLQ
            webhookDLQ.capture(
                'github',
                'push',
                JSON.stringify({ ref: 'refs/heads/main' }),
                'Processing error',
                3
            );
            webhookDLQ.capture(
                'stripe',
                'invoice.payment_failed',
                JSON.stringify({ invoiceId: 'inv_001' }),
                'Stripe unreachable',
                3
            );

            // Seed job DLQ
            mockJobDLQRecords.push(
                makeJobDLQRecord({ job_type: 'deploy:template', failure_reason: 'Timeout' }),
                makeJobDLQRecord({ job_type: 'notify:email', failure_reason: 'SMTP error' })
            );

            const res = await GET(makeGetRequest());
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.total).toBe(4);
            expect(body.bySource.webhook_dlq).toBe(2);
            expect(body.bySource.job_dlq).toBe(2);
        });

        it('total equals bySource.webhook_dlq + bySource.job_dlq', async () => {
            webhookDLQ.capture('stripe', 'charge.failed', '{}', 'err', 3);
            mockJobDLQRecords.push(makeJobDLQRecord());

            const res = await GET(makeGetRequest());
            const body = await res.json();
            expect(body.total).toBe(body.bySource.webhook_dlq + body.bySource.job_dlq);
        });

        it('returns only webhook entries when job DLQ is empty', async () => {
            webhookDLQ.capture('github', 'push', '{}', 'err', 3);

            const res = await GET(makeGetRequest());
            const body = await res.json();
            expect(body.total).toBe(1);
            expect(body.bySource.webhook_dlq).toBe(1);
            expect(body.bySource.job_dlq).toBe(0);
        });

        it('returns only job entries when webhook DLQ is empty', async () => {
            mockJobDLQRecords.push(makeJobDLQRecord());

            const res = await GET(makeGetRequest());
            const body = await res.json();
            expect(body.total).toBe(1);
            expect(body.bySource.webhook_dlq).toBe(0);
            expect(body.bySource.job_dlq).toBe(1);
        });
    });

    // ── Entry shape ────────────────────────────────────────────────────────────
    describe('unified entry shape', () => {
        it('webhook DLQ entry has required unified fields', async () => {
            webhookDLQ.capture(
                'stripe',
                'charge.failed',
                JSON.stringify({ chargeId: 'ch_shape' }),
                'Network timeout',
                3
            );

            const res = await GET(makeGetRequest());
            const body = await res.json();
            const entry = body.entries[0];

            expect(entry).toMatchObject({
                source: 'webhook_dlq',
                id: expect.any(String),
                jobType: expect.stringContaining('stripe'),
                createdAt: expect.any(String),
                attempts: expect.any(Number),
                failureReason: expect.any(String),
                reprocessStatus: expect.stringMatching(/^(pending|in_progress|succeeded|failed)$/),
            });
            // reprocessedAt may be null
            expect('reprocessedAt' in entry).toBe(true);
            // raw field preserved for diagnostics
            expect(entry.raw).toBeDefined();
        });

        it('job DLQ entry has required unified fields', async () => {
            mockJobDLQRecords.push(
                makeJobDLQRecord({
                    job_type: 'deploy:stellar',
                    failure_reason: 'Horizon unreachable',
                    attempts: 3,
                })
            );

            const res = await GET(makeGetRequest());
            const body = await res.json();
            const entry = body.entries[0];

            expect(entry).toMatchObject({
                source: 'job_dlq',
                id: expect.any(String),
                jobType: 'deploy:stellar',
                createdAt: expect.any(String),
                attempts: 3,
                failureReason: 'Horizon unreachable',
                reprocessStatus: expect.stringMatching(/^(pending|in_progress|succeeded|failed)$/),
            });
            expect('reprocessedAt' in entry).toBe(true);
            expect(entry.raw).toBeDefined();
        });
    });

    // ── Ordering ───────────────────────────────────────────────────────────────
    describe('sort order', () => {
        it('entries are sorted by createdAt descending (newest first)', async () => {
            // Capture webhook entry first
            webhookDLQ.capture('stripe', 'charge.failed', '{"id":1}', 'err', 3);

            // Add a job DLQ entry with an older timestamp
            const oldDate = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
            mockJobDLQRecords.push(makeJobDLQRecord({ created_at: oldDate }));

            const res = await GET(makeGetRequest());
            const body = await res.json();

            // Should have 2 entries
            expect(body.entries).toHaveLength(2);

            // Entries should be newest-first
            const timestamps = body.entries.map((e: any) => new Date(e.createdAt).getTime());
            expect(timestamps[0]).toBeGreaterThanOrEqual(timestamps[1]);
        });
    });

    // ── Resilience ─────────────────────────────────────────────────────────────
    describe('resilience', () => {
        it('returns webhook entries even when jobQueueService.listDLQ throws', async () => {
            // Make the mock throw to simulate a DB outage
            const { jobQueueService } = await import('@/services/job-queue.service');
            vi.mocked(jobQueueService.listDLQ).mockRejectedValueOnce(
                new Error('Supabase connection refused')
            );

            webhookDLQ.capture('stripe', 'invoice.payment_failed', '{}', 'err', 3);

            const res = await GET(makeGetRequest());
            expect(res.status).toBe(200);

            const body = await res.json();
            // Webhook entries still present
            expect(body.bySource.webhook_dlq).toBe(1);
            // Job entries degrade gracefully to zero
            expect(body.bySource.job_dlq).toBe(0);
            expect(body.total).toBe(1);
        });
    });

    // ── Cross-reference links ──────────────────────────────────────────────────
    describe('cross-reference _links', () => {
        it('always includes _links regardless of entry count', async () => {
            const res = await GET(makeGetRequest());
            const body = await res.json();

            expect(body._links).toEqual({
                webhookDlq: '/api/admin/webhooks/dlq',
                webhookReplay: '/api/admin/webhooks/replay',
            });
        });
    });
});
