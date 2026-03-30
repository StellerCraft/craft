/**
 * Property 27 — Custom Domain Configuration Triggers Correct Vercel API Calls
 *
 * "For any valid custom domain, calling the domain-configuration flow must:
 *   1. Issue a POST /v4/domains request to the Vercel API with the correct
 *      domain name in the request body.
 *   2. Return a DnsConfiguration containing at least one DNS record and at
 *      least one provider instruction set.
 *   3. Apex domains receive A/AAAA records; subdomains receive a CNAME record."
 *
 * Strategy
 * ────────
 * 100 iterations — no extra dependencies beyond vitest.
 * A seeded PRNG generates valid domain names across TLDs and formats
 * (apex, single-label subdomain, multi-label subdomain).
 *
 * Each iteration:
 *   1. Generate a valid domain string.
 *   2. Call VercelService.addDomain() via a mock fetch that captures the
 *      outgoing request.
 *   3. Call generateDnsConfiguration() for the same domain.
 *   4. Assert:
 *      - The Vercel API was called with POST /v4/domains.
 *      - The request body contains { name: domain }.
 *      - The DNS configuration has ≥ 1 record and ≥ 1 provider instruction.
 *      - Apex domains → A or AAAA records only (no CNAME).
 *      - Subdomains   → exactly one CNAME record.
 *
 * Feature: craft-platform
 * Issue: add-property-test-for-custom-domain-configuratio
 * Property: 27
 */

import { describe, it, expect } from 'vitest';
import { VercelService } from './vercel.service';
import {
    generateDnsConfiguration,
    isApexDomain,
} from '@/lib/dns/dns-configuration';

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

const TLDS = ['com', 'io', 'xyz', 'app', 'finance', 'network', 'exchange', 'dev'] as const;
const SLD_PARTS = ['my-app', 'stellar', 'defi', 'trade', 'vault', 'pay', 'token', 'craft'] as const;
const SUB_PARTS = ['app', 'www', 'api', 'dashboard', 'dex', 'portal'] as const;

/** Generates a valid apex domain, e.g. "stellar.io" */
function apexDomain(rand: () => number): string {
    return `${pick(SLD_PARTS, rand)}.${pick(TLDS, rand)}`;
}

/** Generates a valid single-label subdomain, e.g. "app.stellar.io" */
function subDomain(rand: () => number): string {
    return `${pick(SUB_PARTS, rand)}.${pick(SLD_PARTS, rand)}.${pick(TLDS, rand)}`;
}

/** Generates a valid multi-label subdomain, e.g. "api.dashboard.stellar.io" */
function deepSubDomain(rand: () => number): string {
    return `${pick(SUB_PARTS, rand)}.${pick(SUB_PARTS, rand)}.${pick(SLD_PARTS, rand)}.${pick(TLDS, rand)}`;
}

type DomainKind = 'apex' | 'sub' | 'deep';
const DOMAIN_KINDS: DomainKind[] = ['apex', 'sub', 'deep'];

function generateDomain(rand: () => number): { domain: string; kind: DomainKind } {
    const kind = pick(DOMAIN_KINDS, rand);
    const domain =
        kind === 'apex' ? apexDomain(rand) :
        kind === 'sub'  ? subDomain(rand)  :
                          deepSubDomain(rand);
    return { domain, kind };
}

// ── Mock fetch factory ────────────────────────────────────────────────────────

interface CapturedCall {
    url: string;
    method: string;
    body: Record<string, unknown>;
    authHeader: string | undefined;
}

function makeMockFetch(responseBody: unknown = { name: 'example.com', verified: false }) {
    const calls: CapturedCall[] = [];

    const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
        calls.push({
            url,
            method: (init.method ?? 'GET').toUpperCase(),
            body: init.body ? JSON.parse(init.body as string) : {},
            authHeader: (init.headers as Record<string, string>)?.['Authorization'],
        });
        return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => responseBody,
        } as unknown as Response;
    };

    return { fetch, calls };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ITERATIONS = 100;
const BASE_SEED = 0xdeadbeef;
const VERCEL_TOKEN = 'test_token_prop27';

// ── Property 27 ───────────────────────────────────────────────────────────────

describe('Property 27 — Custom Domain Configuration', () => {
    it(
        `Vercel API is called correctly and DNS instructions are generated — ${ITERATIONS} iterations`,
        async () => {
            for (let i = 0; i < ITERATIONS; i++) {
                const rand = makePrng(BASE_SEED + i);
                const { domain, kind } = generateDomain(rand);

                // ── 1. Vercel API call ────────────────────────────────────────
                const { fetch, calls } = makeMockFetch({ name: domain, verified: false });
                process.env.VERCEL_TOKEN = VERCEL_TOKEN;
                const service = new VercelService(fetch as typeof globalThis.fetch);

                const result = await service.addDomain({ domain });

                // The service must have issued exactly one POST to /v4/domains
                expect(calls).toHaveLength(1);
                const call = calls[0];
                expect(call.method).toBe('POST');
                expect(call.url).toContain('/v4/domains');
                expect(call.body.name).toBe(domain);
                expect(call.authHeader).toBe(`Bearer ${VERCEL_TOKEN}`);

                // The result must reflect the domain
                expect(result.domain).toBe(domain);
                expect(result.success).toBe(true);

                // ── 2. DNS configuration ──────────────────────────────────────
                const dnsConfig = generateDnsConfiguration(domain);

                expect(dnsConfig.domain).toBe(domain);
                expect(dnsConfig.records.length).toBeGreaterThanOrEqual(1);
                expect(dnsConfig.providerInstructions.length).toBeGreaterThanOrEqual(1);
                expect(dnsConfig.notes.length).toBeGreaterThanOrEqual(1);

                // Every provider instruction must have at least one step
                for (const pi of dnsConfig.providerInstructions) {
                    expect(pi.steps.length).toBeGreaterThanOrEqual(1);
                }

                // ── 3. Record type invariants ─────────────────────────────────
                const apex = isApexDomain(domain);

                if (apex) {
                    // Apex: only A and/or AAAA records — no CNAME
                    expect(kind).toBe('apex');
                    for (const rec of dnsConfig.records) {
                        expect(['A', 'AAAA']).toContain(rec.type);
                    }
                    const hasA = dnsConfig.records.some((r) => r.type === 'A');
                    expect(hasA).toBe(true);
                } else {
                    // Subdomain: exactly one CNAME record
                    expect(['sub', 'deep']).toContain(kind);
                    expect(dnsConfig.records).toHaveLength(1);
                    expect(dnsConfig.records[0].type).toBe('CNAME');
                    expect(dnsConfig.records[0].value).toBe('cname.vercel-dns.com');
                }

                delete process.env.VERCEL_TOKEN;
            }
        },
    );

    // ── Targeted invariants ───────────────────────────────────────────────────

    it('apex domain → A + AAAA records, no CNAME', () => {
        const config = generateDnsConfiguration('stellar.io');
        const types = config.records.map((r) => r.type);
        expect(types).not.toContain('CNAME');
        expect(types).toContain('A');
    });

    it('subdomain → single CNAME pointing to cname.vercel-dns.com', () => {
        const config = generateDnsConfiguration('app.stellar.io');
        expect(config.records).toHaveLength(1);
        expect(config.records[0].type).toBe('CNAME');
        expect(config.records[0].value).toBe('cname.vercel-dns.com');
        expect(config.records[0].host).toBe('app');
    });

    it('multi-label subdomain → CNAME host is the full prefix', () => {
        const config = generateDnsConfiguration('api.dashboard.stellar.io');
        expect(config.records[0].type).toBe('CNAME');
        expect(config.records[0].host).toBe('api.dashboard');
    });

    it('Vercel API POST body contains the domain name', async () => {
        const domain = 'trade.finance';
        const { fetch, calls } = makeMockFetch({ name: domain, verified: false });
        process.env.VERCEL_TOKEN = VERCEL_TOKEN;
        const service = new VercelService(fetch as typeof globalThis.fetch);

        await service.addDomain({ domain, projectId: 'prj_test' });

        expect(calls[0].body.name).toBe(domain);
        expect(calls[0].body.projectId).toBe('prj_test');
        delete process.env.VERCEL_TOKEN;
    });

    it('Vercel API error is surfaced in result without throwing', async () => {
        const domain = 'vault.network';
        const errorFetch = async (): Promise<Response> => ({
            ok: false,
            status: 409,
            headers: { get: () => null },
            json: async () => ({ error: { message: 'Domain already exists' } }),
        } as unknown as Response);

        process.env.VERCEL_TOKEN = VERCEL_TOKEN;
        const service = new VercelService(errorFetch as typeof globalThis.fetch);
        const result = await service.addDomain({ domain });

        expect(result.success).toBe(false);
        expect(result.domain).toBe(domain);
        expect(result.error).toBeDefined();
        delete process.env.VERCEL_TOKEN;
    });
});
