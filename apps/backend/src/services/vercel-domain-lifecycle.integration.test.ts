/**
 * Integration test: Vercel Domain Provisioning Lifecycle (Issue #796)
 *
 * Simulates the complete lifecycle from project creation through domain
 * assignment and DNS verification. All Vercel API calls are intercepted
 * via an injected mock fetch (msw-equivalent without the external package).
 *
 * Lifecycle stages covered:
 *   1. Project creation  → POST /v9/projects
 *   2. Deployment trigger → POST /v13/deployments
 *   3. Domain registration → POST /v4/domains
 *   4. Domain verification polling → POST /v4/domains/{domain}/verify
 *      (returns verified: false twice, then verified: true on the third call)
 *   5. Certificate / DNS check → GET /v7/projects/{id}/domains/{domain}/cert
 *
 * Additional error paths:
 *   - domain_already_in_use (409) surfaces as DOMAIN_ALREADY_EXISTS and
 *     is returned to the caller with success: false (maps to HTTP 409)
 *
 * Issue: #796
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VercelService } from './vercel.service';
import { VercelDomainLifecycleService } from './vercel-domain-lifecycle.service';

// ── Response factory ──────────────────────────────────────────────────────────

function makeResponse(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
        json: async () => body,
    } as unknown as Response;
}

// ── Minimal deployment record tracker (stands in for deployments DB table) ────

type LifecycleStatus =
    | 'pending'
    | 'generating'
    | 'deploying'
    | 'completed'
    | 'failed';

interface DeploymentRecord {
    status: LifecycleStatus;
    domain: string | null;
    domainVerified: boolean;
    vercelProjectId: string | null;
    vercelDeploymentId: string | null;
}

function makeRecord(): {
    state: DeploymentRecord;
    transition(s: LifecycleStatus): void;
    setDomain(d: string): void;
    setDomainVerified(v: boolean): void;
    setProjectId(id: string): void;
    setDeploymentId(id: string): void;
    history: LifecycleStatus[];
} {
    const state: DeploymentRecord = {
        status: 'pending',
        domain: null,
        domainVerified: false,
        vercelProjectId: null,
        vercelDeploymentId: null,
    };
    const history: LifecycleStatus[] = ['pending'];
    return {
        state,
        history,
        transition(s) { state.status = s; history.push(s); },
        setDomain(d) { state.domain = d; },
        setDomainVerified(v) { state.domainVerified = v; },
        setProjectId(id) { state.vercelProjectId = id; },
        setDeploymentId(id) { state.vercelDeploymentId = id; },
    };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Vercel Domain Provisioning Lifecycle (integration)', () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    let vercelService: VercelService;
    let lifecycleService: VercelDomainLifecycleService;

    beforeEach(() => {
        process.env.VERCEL_TOKEN = 'test-vercel-token';
        delete process.env.VERCEL_TEAM_ID;
        mockFetch = vi.fn();
        vercelService = new VercelService(mockFetch);
        lifecycleService = new VercelDomainLifecycleService(vercelService);
    });

    // ── Stage 1: Project creation ─────────────────────────────────────────────

    describe('stage 1 — project creation (POST /v9/projects)', () => {
        it('creates project and transitions record to generating', async () => {
            const record = makeRecord();
            mockFetch.mockResolvedValueOnce(
                makeResponse(200, { id: 'prj-abc', name: 'my-dapp', url: 'my-dapp.vercel.app' }),
            );

            const project = await vercelService.createProject({
                name: 'my-dapp',
                gitRepo: 'org/my-dapp',
                envVars: [],
            });

            record.setProjectId(project.id);
            record.transition('generating');

            expect(project.id).toBe('prj-abc');
            expect(project.name).toBe('my-dapp');
            expect(record.state.vercelProjectId).toBe('prj-abc');
            expect(record.history).toEqual(['pending', 'generating']);
        });

        it('sends correct framework and gitRepository payload to Vercel', async () => {
            mockFetch.mockResolvedValueOnce(
                makeResponse(200, { id: 'prj-xyz', name: 'craft-app', url: 'craft-app.vercel.app' }),
            );

            await vercelService.createProject({
                name: 'craft-app',
                gitRepo: 'owner/craft-app',
                envVars: [],
                framework: 'nextjs',
            });

            const [, init] = mockFetch.mock.calls[0];
            const body = JSON.parse(init.body as string);
            expect(body.framework).toBe('nextjs');
            expect(body.gitRepository).toEqual({ type: 'github', repo: 'owner/craft-app' });
        });
    });

    // ── Stage 2: Deployment trigger ──────────────────────────────────────────

    describe('stage 2 — deployment trigger (POST /v13/deployments)', () => {
        it('triggers deployment and transitions record to deploying', async () => {
            const record = makeRecord();
            mockFetch.mockResolvedValueOnce(
                makeResponse(200, { id: 'dpl-001', url: 'my-dapp-abc.vercel.app', status: 'QUEUED' }),
            );

            const result = await vercelService.triggerDeployment('prj-abc', 'org/my-dapp');

            record.setDeploymentId(result.deploymentId);
            record.transition('deploying');

            expect(result.deploymentId).toBe('dpl-001');
            expect(result.deploymentUrl).toBe('https://my-dapp-abc.vercel.app');
            expect(result.status).toBe('QUEUED');
            expect(record.state.vercelDeploymentId).toBe('dpl-001');
            expect(record.history).toContain('deploying');
        });
    });

    // ── Stage 3: Domain registration ─────────────────────────────────────────

    describe('stage 3 — domain registration (POST /v4/domains)', () => {
        it('adds domain with DNS records and verification requirements', async () => {
            const record = makeRecord();
            mockFetch.mockResolvedValueOnce(
                makeResponse(200, {
                    name: 'app.example.com',
                    verification: [
                        {
                            domain: 'app.example.com',
                            type: 'CNAME',
                            value: 'cname.vercel-dns.com',
                            name: 'app',
                        },
                    ],
                }),
            );

            const result = await lifecycleService.addDomainWithDns('app.example.com', 'prj-abc');

            record.setDomain('app.example.com');

            expect(result.success).toBe(true);
            expect(result.domain).toBe('app.example.com');
            expect(result.dnsRecords.length).toBeGreaterThan(0);
            expect(record.state.domain).toBe('app.example.com');
        });

        it('handles domain_already_in_use (409) — returns success:false with DOMAIN_ALREADY error', async () => {
            mockFetch.mockResolvedValueOnce(
                makeResponse(409, {
                    error: {
                        code: 'domain_already_in_use',
                        message: 'The domain "taken.example.com" is already in use',
                    },
                }),
            );

            const result = await lifecycleService.addDomainWithDns('taken.example.com', 'prj-abc');

            // Service returns success:false — caller can map this to HTTP 409
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error).toMatch(/already/i);
            expect(result.dnsRecords).toHaveLength(0);
        });
    });

    // ── Stage 4: Domain verification polling ─────────────────────────────────

    describe('stage 4 — domain verification polling (POST /v4/domains/{d}/verify)', () => {
        it('poller returns verified: false on first two calls, verified: true on third — stops immediately', async () => {
            const verifyCallLog: boolean[] = [];

            const mockClient = {
                addDomain: vi.fn().mockResolvedValue({
                    success: true,
                    domain: 'app.example.com',
                    verification: undefined,
                }),
                verifyDomain: vi.fn()
                    .mockImplementationOnce(async () => {
                        verifyCallLog.push(false);
                        return { verified: false, requirements: [{ domain: 'app.example.com', type: 'TXT', value: '_vercel=abc', name: '_vercel' }] };
                    })
                    .mockImplementationOnce(async () => {
                        verifyCallLog.push(false);
                        return { verified: false, requirements: [] };
                    })
                    .mockImplementationOnce(async () => {
                        verifyCallLog.push(true);
                        return { verified: true };
                    }),
                getCertificate: vi.fn().mockResolvedValue({
                    domain: 'app.example.com',
                    state: 'active',
                    expiresAt: '2027-06-01T00:00:00Z',
                }),
                removeDomain: vi.fn(),
                listDeploymentAliases: vi.fn().mockResolvedValue([]),
                listDomains: vi.fn().mockResolvedValue([]),
            };

            const svc = new VercelDomainLifecycleService(mockClient);

            // Poll 1 — not yet verified
            const poll1 = await svc.verifyDnsPropagation('app.example.com', 'prj-abc');
            expect(poll1.verified).toBe(false);
            expect(poll1.certState).toBe('pending');

            // Poll 2 — still not verified
            const poll2 = await svc.verifyDnsPropagation('app.example.com', 'prj-abc');
            expect(poll2.verified).toBe(false);

            // Poll 3 — verified: true → poller should stop after this call
            const poll3 = await svc.verifyDnsPropagation('app.example.com', 'prj-abc');
            expect(poll3.verified).toBe(true);
            expect(poll3.certState).toBe('active');

            // verifyDomain was called exactly 3 times — one per poll invocation
            expect(mockClient.verifyDomain).toHaveBeenCalledTimes(3);
            // getCertificate only called once — only on the successful poll
            expect(mockClient.getCertificate).toHaveBeenCalledTimes(1);
            expect(verifyCallLog).toEqual([false, false, true]);
        });

        it('does not call getCertificate when domain is not yet verified', async () => {
            const mockClient = {
                addDomain: vi.fn(),
                verifyDomain: vi.fn().mockResolvedValue({ verified: false, requirements: [] }),
                getCertificate: vi.fn(),
                removeDomain: vi.fn(),
                listDeploymentAliases: vi.fn(),
                listDomains: vi.fn(),
            };

            const svc = new VercelDomainLifecycleService(mockClient);
            const result = await svc.verifyDnsPropagation('app.example.com', 'prj-abc');

            expect(result.verified).toBe(false);
            expect(mockClient.getCertificate).not.toHaveBeenCalled();
        });

        it('returns cert pending when domain verified but certificate still provisioning', async () => {
            const mockClient = {
                addDomain: vi.fn(),
                verifyDomain: vi.fn().mockResolvedValue({ verified: true }),
                getCertificate: vi.fn().mockResolvedValue({ domain: 'app.example.com', state: 'pending' }),
                removeDomain: vi.fn(),
                listDeploymentAliases: vi.fn(),
                listDomains: vi.fn(),
            };

            const svc = new VercelDomainLifecycleService(mockClient);
            const result = await svc.verifyDnsPropagation('app.example.com', 'prj-abc');

            expect(result.verified).toBe(false);
            expect(result.certState).toBe('pending');
            expect(result.reason).toMatch(/provisioning/i);
        });

        it('returns cert error when certificate provisioning fails', async () => {
            const mockClient = {
                addDomain: vi.fn(),
                verifyDomain: vi.fn().mockResolvedValue({ verified: true }),
                getCertificate: vi.fn().mockResolvedValue({
                    domain: 'app.example.com',
                    state: 'error',
                    error: 'DNS CNAME record does not point to Vercel',
                }),
                removeDomain: vi.fn(),
                listDeploymentAliases: vi.fn(),
                listDomains: vi.fn(),
            };

            const svc = new VercelDomainLifecycleService(mockClient);
            const result = await svc.verifyDnsPropagation('app.example.com', 'prj-abc');

            expect(result.verified).toBe(false);
            expect(result.certState).toBe('error');
            expect(result.reason).toMatch(/CNAME|DNS/i);
        });
    });

    // ── Stage 5: DNS / certificate check ─────────────────────────────────────

    describe('stage 5 — certificate / DNS check (GET /v7/projects/.../cert)', () => {
        it('returns active certificate after DNS has propagated', async () => {
            const record = makeRecord();
            mockFetch.mockResolvedValueOnce(
                makeResponse(200, {
                    cns: ['app.example.com'],
                    expiresAt: '2027-06-01T00:00:00Z',
                }),
            );

            const cert = await vercelService.getCertificate('prj-abc', 'app.example.com');

            record.setDomainVerified(true);
            record.transition('completed');

            expect(cert.state).toBe('active');
            expect(cert.expiresAt).toBe('2027-06-01T00:00:00Z');
            expect(record.state.domainVerified).toBe(true);
            expect(record.state.status).toBe('completed');
        });

        it('returns pending state when Vercel has not yet issued a certificate (404)', async () => {
            mockFetch.mockResolvedValueOnce(
                makeResponse(404, { error: { message: 'Not found', code: 'NOT_FOUND' } }),
            );

            const cert = await vercelService.getCertificate('prj-abc', 'app.example.com');
            expect(cert.state).toBe('pending');
        });
    });

    // ── Full end-to-end lifecycle ─────────────────────────────────────────────

    describe('full lifecycle: project → deploy → domain → verify → cert', () => {
        it('completes all 5 stages and records correct status transitions', async () => {
            const record = makeRecord();

            // Stage 1: create project
            mockFetch
                .mockResolvedValueOnce(makeResponse(200, { id: 'prj-e2e', name: 'e2e-dapp', url: 'e2e-dapp.vercel.app' }))
                // Stage 2: trigger deployment
                .mockResolvedValueOnce(makeResponse(200, { id: 'dpl-e2e', url: 'e2e-abc.vercel.app', status: 'QUEUED' }))
                // Stage 3: add domain
                .mockResolvedValueOnce(makeResponse(200, { name: 'dapp.example.com', verification: [] }))
                // Stage 4a: verify domain — false
                .mockResolvedValueOnce(makeResponse(200, { verified: false, verification: [] }))
                // Stage 4b: verify domain — true
                .mockResolvedValueOnce(makeResponse(200, { verified: true }))
                // Stage 5: get certificate
                .mockResolvedValueOnce(makeResponse(200, { expiresAt: '2027-01-01T00:00:00Z' }));

            // Stage 1
            const project = await vercelService.createProject({ name: 'e2e-dapp', gitRepo: 'org/e2e', envVars: [] });
            record.setProjectId(project.id);
            record.transition('generating');

            // Stage 2
            const deployment = await vercelService.triggerDeployment(project.id, 'org/e2e');
            record.setDeploymentId(deployment.deploymentId);
            record.transition('deploying');

            // Stage 3
            const domainAdd = await lifecycleService.addDomainWithDns('dapp.example.com', project.id);
            expect(domainAdd.success).toBe(true);
            record.setDomain('dapp.example.com');

            // Stage 4a: first verify call — not yet verified
            const verify1 = await lifecycleService.verifyDnsPropagation('dapp.example.com', project.id);
            expect(verify1.verified).toBe(false);

            // Stage 4b: second verify call — verified
            const verify2 = await lifecycleService.verifyDnsPropagation('dapp.example.com', project.id);
            expect(verify2.verified).toBe(true);
            expect(verify2.certState).toBe('active');

            record.setDomainVerified(true);
            record.transition('completed');

            // Final assertions
            expect(record.state.status).toBe('completed');
            expect(record.state.domain).toBe('dapp.example.com');
            expect(record.state.domainVerified).toBe(true);
            expect(record.history).toEqual(['pending', 'generating', 'deploying', 'completed']);
            expect(mockFetch).toHaveBeenCalledTimes(6);
        });
    });
});
