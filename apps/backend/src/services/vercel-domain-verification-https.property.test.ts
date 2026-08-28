/**
 * Property 28 — Verified Domains Automatically Enable HTTPS
 *
 * "For any domain that passes Vercel ownership verification, the subsequent
 *  certificate state must be 'active', confirming that HTTPS is enabled.
 *  A domain that fails verification must never produce an 'active' certificate
 *  state through the same flow."
 *
 * Strategy
 * ────────
 * 100 iterations — seeded PRNG, no extra dependencies beyond vitest.
 *
 * Each iteration generates:
 *   - A valid domain (apex or subdomain, varied TLDs)
 *   - A verification outcome (verified: true | false)
 *   - An SSL configuration (state: 'active' | 'pending' | 'error', optional expiresAt)
 *
 * The mock fetch is wired so that:
 *   - POST /v4/domains/{domain}/verify → returns { verified } from the generated state
 *   - GET  /v7/projects/{projectId}/domains/{domain}/cert → returns the generated cert
 *
 * Assertions (Property 28):
 *   1. When verified === true  → cert.state must be 'active'
 *   2. When verified === false → cert.state must NOT be 'active'
 *   3. Active certs always carry a non-empty expiresAt string
 *   4. The verify call is always POST; the cert call is always GET
 *
 * Feature: craft-platform
 * Issue: add-property-test-for-domain-verification-succes
 * Property: 28
 */

import { describe, it, expect } from 'vitest';
import { VercelService, type DomainCertificate, type HttpsVerificationResult } from './vercel.service';

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────

function makePrng(seed: number) {
    let s = seed;
    return (): number => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(arr: readonly T[], rand: () => number): T {
    return arr[Math.floor(rand() * arr.length)];
}

// ── Domain generators ─────────────────────────────────────────────────────────

const TLDS = ['com', 'io', 'xyz', 'app', 'finance', 'network', 'dev'] as const;
const SLDS = ['stellar', 'defi', 'trade', 'vault', 'pay', 'craft', 'token'] as const;
const SUBS = ['app', 'www', 'api', 'dex', 'portal'] as const;

function genDomain(rand: () => number): string {
    const isApex = rand() < 0.4;
    const sld = pick(SLDS, rand);
    const tld = pick(TLDS, rand);
    return isApex ? `${sld}.${tld}` : `${pick(SUBS, rand)}.${sld}.${tld}`;
}

// ── SSL state generators ──────────────────────────────────────────────────────

type CertState = 'active' | 'pending' | 'error';

interface GeneratedScenario {
    domain: string;
    projectId: string;
    verified: boolean;
    /** The cert state the mock Vercel API will return. */
    certState: CertState;
    expiresAt: string | undefined;
}

function genScenario(rand: () => number, index: number): GeneratedScenario {
    const domain = genDomain(rand);
    const projectId = `prj_prop28_${index}`;
    const verified = rand() < 0.5;

    // Invariant: only verified domains get an active cert
    const certState: CertState = verified
        ? 'active'
        : pick(['pending', 'error'] as const, rand);

    const expiresAt = certState === 'active'
        ? `2027-0${(Math.floor(rand() * 9) + 1).toString().padStart(2, '0')}-01T00:00:00Z`
        : undefined;

    return { domain, projectId, verified, certState, expiresAt };
}

// ── Mock fetch factory ────────────────────────────────────────────────────────

interface CapturedCall { url: string; method: string }

function makeMockFetch(scenario: GeneratedScenario) {
    const calls: CapturedCall[] = [];

    const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
        const method = (init.method ?? 'GET').toUpperCase();
        calls.push({ url, method });

        // POST .../verify → verification result
        if (method === 'POST' && url.includes('/verify')) {
            return {
                ok: true, status: 200,
                headers: { get: () => null },
                json: async () => ({ verified: scenario.verified }),
            } as unknown as Response;
        }

        // GET .../cert → certificate state
        if (method === 'GET' && url.includes('/cert')) {
            const body: Record<string, unknown> = {};
            if (scenario.certState === 'active') {
                body.expiresAt = scenario.expiresAt;
                body.cns = [scenario.domain];
            } else if (scenario.certState === 'error') {
                body.error = { message: 'DNS not propagated' };
            }
            // pending → empty body (no expiresAt, no error)
            return {
                ok: true, status: 200,
                headers: { get: () => null },
                json: async () => body,
            } as unknown as Response;
        }

        // Fallback — should not be reached
        return {
            ok: false, status: 500,
            headers: { get: () => null },
            json: async () => ({ error: { message: 'unexpected call' } }),
        } as unknown as Response;
    };

    return { fetch, calls };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ITERATIONS = 100;
const BASE_SEED = 0xc0ffee28;
const TOKEN = 'test_token_prop28';

// ── Property 28 ───────────────────────────────────────────────────────────────

describe('Property 28 — Verified Domains Automatically Enable HTTPS', () => {
    it(
        `verified → active cert; unverified → non-active cert — ${ITERATIONS} iterations`,
        async () => {
            for (let i = 0; i < ITERATIONS; i++) {
                const rand = makePrng(BASE_SEED + i);
                const scenario = genScenario(rand, i);
                const { fetch, calls } = makeMockFetch(scenario);

                process.env.VERCEL_TOKEN = TOKEN;
                const service = new VercelService(fetch as typeof globalThis.fetch);

                // Step 1 — verify domain ownership
                const verification = await service.verifyDomain(scenario.domain);

                // Step 2 — fetch certificate state
                const cert: DomainCertificate = await service.getCertificate(
                    scenario.projectId,
                    scenario.domain,
                );

                delete process.env.VERCEL_TOKEN;

                // ── Property 28 assertions ────────────────────────────────────

                // 1. Verified → HTTPS active
                if (scenario.verified) {
                    expect(cert.state).toBe('active');
                }

                // 2. Unverified → HTTPS not active
                if (!scenario.verified) {
                    expect(cert.state).not.toBe('active');
                }

                // 3. Active cert always has a non-empty expiresAt
                if (cert.state === 'active') {
                    expect(typeof cert.expiresAt).toBe('string');
                    expect((cert.expiresAt as string).length).toBeGreaterThan(0);
                }

                // 4. Verify call is POST; cert call is GET
                const verifyCalls = calls.filter((c) => c.url.includes('/verify'));
                const certCalls = calls.filter((c) => c.url.includes('/cert'));
                expect(verifyCalls.length).toBeGreaterThanOrEqual(1);
                expect(verifyCalls.every((c) => c.method === 'POST')).toBe(true);
                expect(certCalls.length).toBeGreaterThanOrEqual(1);
                expect(certCalls.every((c) => c.method === 'GET')).toBe(true);

                // 5. Verification result domain matches input
                expect(verification.verified).toBe(scenario.verified);
            }
        },
    );

    // ── Targeted invariants ───────────────────────────────────────────────────

    it('active cert always carries expiresAt', async () => {
        const scenario: GeneratedScenario = {
            domain: 'app.stellar.io',
            projectId: 'prj_targeted',
            verified: true,
            certState: 'active',
            expiresAt: '2027-06-01T00:00:00Z',
        };
        const { fetch } = makeMockFetch(scenario);
        process.env.VERCEL_TOKEN = TOKEN;
        const service = new VercelService(fetch as typeof globalThis.fetch);
        const cert = await service.getCertificate(scenario.projectId, scenario.domain);
        expect(cert.state).toBe('active');
        expect(cert.expiresAt).toBe('2027-06-01T00:00:00Z');
        delete process.env.VERCEL_TOKEN;
    });

    it('pending cert has no expiresAt', async () => {
        const scenario: GeneratedScenario = {
            domain: 'trade.finance',
            projectId: 'prj_pending',
            verified: false,
            certState: 'pending',
            expiresAt: undefined,
        };
        const { fetch } = makeMockFetch(scenario);
        process.env.VERCEL_TOKEN = TOKEN;
        const service = new VercelService(fetch as typeof globalThis.fetch);
        const cert = await service.getCertificate(scenario.projectId, scenario.domain);
        expect(cert.state).toBe('pending');
        expect(cert.expiresAt).toBeUndefined();
        delete process.env.VERCEL_TOKEN;
    });

    it('error cert state is surfaced without throwing', async () => {
        const scenario: GeneratedScenario = {
            domain: 'vault.network',
            projectId: 'prj_error',
            verified: false,
            certState: 'error',
            expiresAt: undefined,
        };
        const { fetch } = makeMockFetch(scenario);
        process.env.VERCEL_TOKEN = TOKEN;
        const service = new VercelService(fetch as typeof globalThis.fetch);
        const cert = await service.getCertificate(scenario.projectId, scenario.domain);
        expect(cert.state).toBe('error');
        expect(cert.error).toBeDefined();
        delete process.env.VERCEL_TOKEN;
    });

    it('unverified domain never produces active cert', async () => {
        const scenario: GeneratedScenario = {
            domain: 'pay.io',
            projectId: 'prj_unverified',
            verified: false,
            certState: 'pending',
            expiresAt: undefined,
        };
        const { fetch } = makeMockFetch(scenario);
        process.env.VERCEL_TOKEN = TOKEN;
        const service = new VercelService(fetch as typeof globalThis.fetch);
        await service.verifyDomain(scenario.domain);
        const cert = await service.getCertificate(scenario.projectId, scenario.domain);
        expect(cert.state).not.toBe('active');
        delete process.env.VERCEL_TOKEN;
    });
});

// ── Certificate error scenarios (Issue #739) ──────────────────────────────────
//
// Tests that verifyHttpsCertificate() surfaces the correct machine-readable
// reason for every certificate failure type.  The mock fetch intercepts both
// the Vercel cert API call (/cert) and the HSTS HEAD check (https://{domain}).
//
// All TLS behaviour is simulated — no real HTTPS connections are made.

const TOKEN_739 = 'test_token_issue_739';
const PROJECT_739 = 'prj_issue_739';
const DOMAIN_739 = 'app.stellar.finance';

/** Builds a mock fetch that returns the given cert body and optional HSTS header. */
function makeCertFetch(
    certBody: Record<string, unknown>,
    hstsValue: string | null = 'max-age=31536000; includeSubDomains',
) {
    return async (url: string, init: RequestInit = {}): Promise<Response> => {
        const method = (init.method ?? 'GET').toUpperCase();

        // Vercel cert API
        if (method === 'GET' && url.includes('/cert')) {
            return {
                ok: true, status: 200,
                headers: { get: () => null },
                json: async () => certBody,
            } as unknown as Response;
        }

        // HSTS HEAD check
        if (method === 'HEAD' && url.startsWith('https://')) {
            return {
                ok: true, status: 200,
                headers: { get: (h: string) => h.toLowerCase() === 'strict-transport-security' ? hstsValue : null },
            } as unknown as Response;
        }

        return {
            ok: false, status: 500,
            headers: { get: () => null },
            json: async () => ({ error: { message: 'unexpected call' } }),
        } as unknown as Response;
    };
}

describe('Issue #739 — HTTPS Verification Under Expired / Untrusted Certificate Scenarios', () => {
    // ── Expired certificate ───────────────────────────────────────────────────

    it('expired certificate → verified: false, reason: cert_expired', async () => {
        const fetch = makeCertFetch({ error: { message: 'Certificate expired' } });
        process.env.VERCEL_TOKEN = TOKEN_739;
        const service = new VercelService(fetch as typeof globalThis.fetch);

        const result: HttpsVerificationResult = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);

        delete process.env.VERCEL_TOKEN;
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('cert_expired');
        expect(result.certState).toBe('error');
    });

    it('cert error message containing "expired" always maps to cert_expired', async () => {
        const variants = [
            'Certificate expired',
            'SSL cert expired on 2024-01-01',
            'The certificate has expired',
            'cert expired for this domain',
        ];
        for (const msg of variants) {
            const fetch = makeCertFetch({ error: { message: msg } });
            process.env.VERCEL_TOKEN = TOKEN_739;
            const service = new VercelService(fetch as typeof globalThis.fetch);
            const result = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);
            delete process.env.VERCEL_TOKEN;

            expect(result.verified).toBe(false);
            expect(result.reason).toBe('cert_expired');
        }
    });

    // ── Self-signed / untrusted CA ────────────────────────────────────────────

    it('self-signed certificate → verified: false, reason: cert_untrusted', async () => {
        const fetch = makeCertFetch({ error: { message: 'Certificate is self-signed' } });
        process.env.VERCEL_TOKEN = TOKEN_739;
        const service = new VercelService(fetch as typeof globalThis.fetch);

        const result = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);

        delete process.env.VERCEL_TOKEN;
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('cert_untrusted');
        expect(result.certState).toBe('error');
    });

    it('untrusted CA certificate → verified: false, reason: cert_untrusted', async () => {
        const fetch = makeCertFetch({ error: { message: 'certificate signed by unknown ca' } });
        process.env.VERCEL_TOKEN = TOKEN_739;
        const service = new VercelService(fetch as typeof globalThis.fetch);

        const result = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);

        delete process.env.VERCEL_TOKEN;
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('cert_untrusted');
    });

    it('cert error messages indicating untrusted issuer always map to cert_untrusted', async () => {
        const variants = [
            'Certificate is self-signed',
            'self-signed certificate',
            'certificate issued by untrusted authority',
            'untrusted cert chain',
            'Certificate issued by unknown CA',
        ];
        for (const msg of variants) {
            const fetch = makeCertFetch({ error: { message: msg } });
            process.env.VERCEL_TOKEN = TOKEN_739;
            const service = new VercelService(fetch as typeof globalThis.fetch);
            const result = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);
            delete process.env.VERCEL_TOKEN;

            expect(result.verified).toBe(false);
            expect(result.reason).toBe('cert_untrusted');
        }
    });

    // ── Pending certificate ───────────────────────────────────────────────────

    it('pending certificate (no expiresAt, no error) → verified: false, reason: cert_pending', async () => {
        const fetch = makeCertFetch({}); // empty body = pending
        process.env.VERCEL_TOKEN = TOKEN_739;
        const service = new VercelService(fetch as typeof globalThis.fetch);

        const result = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);

        delete process.env.VERCEL_TOKEN;
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('cert_pending');
        expect(result.certState).toBe('pending');
    });

    // ── HSTS header validation ────────────────────────────────────────────────

    it('active cert with HSTS present → verified: true', async () => {
        const fetch = makeCertFetch(
            { expiresAt: '2027-06-01T00:00:00Z', cns: [DOMAIN_739] },
            'max-age=31536000; includeSubDomains',
        );
        process.env.VERCEL_TOKEN = TOKEN_739;
        const service = new VercelService(fetch as typeof globalThis.fetch);

        const result = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);

        delete process.env.VERCEL_TOKEN;
        expect(result.verified).toBe(true);
        expect(result.certState).toBe('active');
        expect(result.reason).toBeUndefined();
    });

    it('active cert but HSTS header absent → verified: false, reason: no_hsts', async () => {
        const fetch = makeCertFetch(
            { expiresAt: '2027-06-01T00:00:00Z', cns: [DOMAIN_739] },
            null, // HSTS header missing
        );
        process.env.VERCEL_TOKEN = TOKEN_739;
        const service = new VercelService(fetch as typeof globalThis.fetch);

        const result = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);

        delete process.env.VERCEL_TOKEN;
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('no_hsts');
        expect(result.certState).toBe('active');
    });

    it('HSTS header is validated as part of HTTPS verification — 100 domain iterations', async () => {
        const rand = makePrng(BASE_SEED + 739);

        for (let i = 0; i < 100; i++) {
            const domain = genDomain(rand);
            const hasHsts = rand() < 0.5;
            const certActive = rand() < 0.7;

            const certBody = certActive
                ? { expiresAt: '2027-06-01T00:00:00Z', cns: [domain] }
                : {};
            const hstsHeader = hasHsts ? 'max-age=31536000' : null;

            const fetch = makeCertFetch(certBody, hstsHeader);
            process.env.VERCEL_TOKEN = TOKEN_739;
            const service = new VercelService(fetch as typeof globalThis.fetch);
            const result = await service.verifyHttpsCertificate(PROJECT_739, domain);
            delete process.env.VERCEL_TOKEN;

            if (certActive && hasHsts) {
                // Invariant: cert active + HSTS present → fully verified
                expect(result.verified).toBe(true);
            } else {
                // Invariant: any missing condition → not verified
                expect(result.verified).toBe(false);
            }
        }
    });

    // ── Generic cert error (no specific keyword) ──────────────────────────────

    it('generic cert error with no recognized keyword → reason: cert_error', async () => {
        const fetch = makeCertFetch({ error: { message: 'provisioning failed' } });
        process.env.VERCEL_TOKEN = TOKEN_739;
        const service = new VercelService(fetch as typeof globalThis.fetch);

        const result = await service.verifyHttpsCertificate(PROJECT_739, DOMAIN_739);

        delete process.env.VERCEL_TOKEN;
        expect(result.verified).toBe(false);
        expect(result.reason).toBe('cert_error');
    });
});
