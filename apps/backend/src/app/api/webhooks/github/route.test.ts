/**
 * GitHub Webhook Endpoint Integration Tests
 *
 * Tests the GitHub webhook endpoint that triggers Vercel deployments.
 *
 * Functionality tested:
 *   - Signature verification
 *   - Event routing (push, ping)
 *   - Deployment triggering on push events
 *   - Error handling
 *   - Unsupported event types
 *
 * Security properties tested:
 *   - Invalid signatures are rejected
 *   - Missing signatures are rejected
 *   - Missing webhook secret returns 500
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';
import { generateGitHubWebhookSignature } from '@/lib/github/webhook-verification';

const WEBHOOK_SECRET = 'test-webhook-secret';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/services/github-to-vercel-deployment.service', () => ({
    githubToVercelDeploymentService: {
        triggerDeployment: vi.fn(),
    },
}));

vi.mock('@/lib/api/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    }),
    resolveCorrelationId: () => 'test-correlation-id',
    CORRELATION_ID_HEADER: 'X-Correlation-Id',
}));

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.GITHUB_DEPLOYMENT_BRANCH = 'main';
});

describe('POST /api/webhooks/github', () => {
    describe('Signature verification', () => {
        it('accepts valid signature', async () => {
            const payload = JSON.stringify({ test: 'data' });
            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'ping',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(200);
        });

        it('rejects missing signature', async () => {
            const payload = JSON.stringify({ test: 'data' });

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-github-event': 'ping',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(401);
        });

        it('rejects invalid signature', async () => {
            const payload = JSON.stringify({ test: 'data' });

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': 'sha256=invalid',
                    'x-github-event': 'ping',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(401);
        });

        it('returns 500 when webhook secret not configured', async () => {
            delete process.env.GITHUB_WEBHOOK_SECRET;

            const payload = JSON.stringify({ test: 'data' });
            const signature = generateGitHubWebhookSignature(payload, 'any-secret');

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'ping',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(500);
        });
    });

    describe('Event routing', () => {
        it('handles ping event', async () => {
            const payload = JSON.stringify({ zen: 'keep it simple' });
            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'ping',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.received).toBe(true);
            expect(data.processed).toBe(true);
        });

        it('handles push event to configured branch', async () => {
            const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
            vi.mocked(githubToVercelDeploymentService.triggerDeployment).mockResolvedValue({
                success: true,
                deploymentId: 'deploy-123',
                deploymentUrl: 'https://test.vercel.app',
                status: 'QUEUED',
            });

            const payload = JSON.stringify({
                ref: 'refs/heads/main',
                repository: {
                    full_name: 'owner/repo',
                    name: 'repo',
                },
                head_commit: {
                    id: 'abc123def456',
                    message: 'Test commit',
                    timestamp: '2024-01-01T00:00:00Z',
                },
                pusher: {
                    name: 'testuser',
                },
            });

            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'push',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.received).toBe(true);
            expect(data.processed).toBe(true);

            expect(githubToVercelDeploymentService.triggerDeployment).toHaveBeenCalledWith({
                repoFullName: 'owner/repo',
                repoName: 'repo',
                branch: 'main',
                commitSha: 'abc123def456',
                commitMessage: 'Test commit',
                pusherName: 'testuser',
            });
        });

        it('skips deployment for non-configured branch', async () => {
            const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');

            const payload = JSON.stringify({
                ref: 'refs/heads/feature-branch',
                repository: {
                    full_name: 'owner/repo',
                    name: 'repo',
                },
                head_commit: {
                    id: 'abc123def456',
                    message: 'Test commit',
                },
                pusher: {
                    name: 'testuser',
                },
            });

            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'push',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(200);

            expect(githubToVercelDeploymentService.triggerDeployment).not.toHaveBeenCalled();
        });

        it('acknowledges unsupported event types', async () => {
            const payload = JSON.stringify({ action: 'created' });
            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'deployment',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(200);

            const data = await response.json();
            expect(data.received).toBe(true);
            expect(data.processed).toBe(false);
        });

        it('returns 400 when event type header is missing', async () => {
            const payload = JSON.stringify({ test: 'data' });
            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(400);
        });
    });

    describe('Error handling', () => {
        it('returns 400 for invalid JSON', async () => {
            const payload = 'not-valid-json';
            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'ping',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(400);
        });

        it('returns 500 when deployment trigger fails', async () => {
            const { githubToVercelDeploymentService } = await import('@/services/github-to-vercel-deployment.service');
            vi.mocked(githubToVercelDeploymentService.triggerDeployment).mockResolvedValue({
                success: false,
                deploymentId: '',
                errorMessage: 'Vercel API error',
            });

            const payload = JSON.stringify({
                ref: 'refs/heads/main',
                repository: {
                    full_name: 'owner/repo',
                    name: 'repo',
                },
                head_commit: {
                    id: 'abc123def456',
                    message: 'Test commit',
                },
                pusher: {
                    name: 'testuser',
                },
            });

            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'push',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.status).toBe(500);
        });

        it('includes correlation ID in response headers', async () => {
            const payload = JSON.stringify({ test: 'data' });
            const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

            const request = new NextRequest('http://localhost:4001/api/webhooks/github', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-hub-signature-256': signature,
                    'x-github-event': 'ping',
                },
                body: payload,
            });

            const response = await POST(request);
            expect(response.headers.get('X-Correlation-Id')).toBe('test-correlation-id');
        });
    });
});
