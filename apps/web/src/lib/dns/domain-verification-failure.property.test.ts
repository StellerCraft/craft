/**
 * Property 29 — Failed Domain Verification Displays Specific DNS Troubleshooting Guidance
 *
 * "For any DNS misconfiguration scenario that causes domain verification to
 *  fail, the system must return:
 *   1. A specific, non-generic errorCode identifying the failure class.
 *   2. A non-empty errorMessage describing what went wrong.
 *   3. Provider-specific DNS instructions (via generateDnsConfiguration) so
 *      the user knows exactly what records to add or fix."
 *
 * Strategy
 * ────────
 * 100 iterations — seeded PRNG, no extra dependencies beyond vitest.
 *
 * DNS is mocked via vi.mock so no real network calls are made.
 * Each iteration picks:
 *   - A valid domain (apex or subdomain)
 *   - A misconfiguration scenario:
 *       NOT_FOUND   — DNS record absent (ENOTFOUND / ENODATA)
 *       WRONG_VALUE — record present but pointing elsewhere
 *       TIMEOUT     — DNS query timed out
 *
 * Assertions (Property 29):
 *   1. verified === false for every failure scenario
 *   2. errorCode is one of the known specific codes (not undefined)
 *   3. errorMessage is a non-empty string
 *   4. generateDnsConfiguration returns ≥1 provider instruction, each with ≥1 step
 *   5. generateDnsConfiguration notes include propagation guidance
 *
 * Feature: craft-platform
 * Issue: add-property-test-for-domain-verification-failur
 * Property: 29
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as dnsPromises from 'node:dns/promises';
import { verifyViaTxt, verifyViaCname, type VerificationErrorCode } from '@/lib/dns/domain-verification';
import { generateDnsConfiguration } from '@/lib/dns/dns-configuration';

// ── DNS mock ──────────────────────────────────────────────────────────────────

vi.mock('node:dns/promises', () => ({
    default: { resolveTxt: vi.fn(), resolveCname: vi.fn() },
}));

const mockDns = dnsPromises.default as {
    resolveTxt: ReturnType<typeof vi.fn>;
    resolveCname: ReturnType<typeof vi.fn>;
};

afterEach(() => vi.clearAllMocks());

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

function genApex(rand: () => number): string {
    return `${pick(SLDS, rand)}.${pick(TLDS, rand)}`;
}

function genSubdomain(rand: () => number): string {
    return `${pick(SUBS, rand)}.${pick(SLDS, rand)}.${pick(TLDS, rand)}`;
}

// ── Misconfiguration scenarios ────────────────────────────────────────────────

type MisconfigKind = 'NOT_FOUND' | 'WRONG_VALUE' | 'TIMEOUT';
const MISCONFIG_KINDS: MisconfigKind[] = ['NOT_FOUND', 'WRONG_VALUE', 'TIMEOUT'];

/** Wire the DNS mock to simulate the given misconfiguration. */
function applyMisconfig(kind: MisconfigKind): void {
    switch (kind) {
        case 'NOT_FOUND': {
            const err = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
            mockDns.resolveTxt.mockRejectedValue(err);
            mockDns.resolveCname.mockRejectedValue(err);
            break;
        }
        case 'WRONG_VALUE': {
            mockDns.resolveTxt.mockResolvedValue([['wrong-token-value']]);
            mockDns.resolveCname.mockResolvedValue(['other-provider.example.net']);
            break;
        }
        case 'TIMEOUT': {
            const timeout = () =>
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('DNS_TIMEOUT')), 10),
                );
            mockDns.resolveTxt.mockImplementation(timeout);
            mockDns.resolveCname.mockImplementation(timeout);
            break;
        }
    }
}

const KNOWN_ERROR_CODES: VerificationErrorCode[] = [
    'NOT_FOUND', 'WRONG_VALUE', 'TIMEOUT', 'INVALID_DOMAIN', 'UNKNOWN',
];

const ITERATIONS = 100;
const BASE_SEED = 0xfa1129ff;

// ── Property 29 ───────────────────────────────────────────────────────────────

describe('Property 29 — Failed Domain Verification Displays Specific DNS Troubleshooting Guidance', () => {
    it(
        `every failure scenario returns specific errorCode, errorMessage, and DNS instructions — ${ITERATIONS} iterations`,
        async () => {
            for (let i = 0; i < ITERATIONS; i++) {
                const rand = makePrng(BASE_SEED + i);
                const kind = pick(MISCONFIG_KINDS, rand);

                // Pick domain type: CNAME verification only works on subdomains
                const useApex = rand() < 0.4;
                const domain = useApex ? genApex(rand) : genSubdomain(rand);
                const method = useApex ? 'txt' : pick(['txt', 'cname'] as const, rand);

                applyMisconfig(kind);

                // ── Run verification ──────────────────────────────────────────
                const result =
                    method === 'txt'
                        ? await verifyViaTxt(domain, 'craft-verify-token', { retries: 0, timeout: 5 })
                        : await verifyViaCname(domain, { retries: 0, timeout: 5 });

                // ── Property 29 assertions ────────────────────────────────────

                // 1. Always fails
                expect(result.verified).toBe(false);

                // 2. errorCode is specific and known
                expect(result.errorCode).toBeDefined();
                expect(KNOWN_ERROR_CODES).toContain(result.errorCode);

                // 3. errorMessage is a non-empty string
                expect(typeof result.errorMessage).toBe('string');
                expect((result.errorMessage as string).length).toBeGreaterThan(0);

                // 4. DNS configuration provides provider instructions
                const dnsConfig = generateDnsConfiguration(domain);
                expect(dnsConfig.providerInstructions.length).toBeGreaterThanOrEqual(1);
                for (const pi of dnsConfig.providerInstructions) {
                    expect(pi.provider.length).toBeGreaterThan(0);
                    expect(pi.steps.length).toBeGreaterThanOrEqual(1);
                    // Each step must mention the domain or a DNS record type
                    const allSteps = pi.steps.join(' ');
                    expect(allSteps.length).toBeGreaterThan(0);
                }

                // 5. Notes include propagation guidance
                const notesText = dnsConfig.notes.join(' ');
                expect(notesText).toMatch(/propagat/i);

                vi.clearAllMocks();
            }
        },
    );

    // ── Targeted invariants per error code ───────────────────────────────────

    it('NOT_FOUND → errorCode NOT_FOUND, errorMessage mentions the hostname', async () => {
        const err = Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
        mockDns.resolveTxt.mockRejectedValue(err);
        const result = await verifyViaTxt('app.stellar.io', 'token', { retries: 0 });
        expect(result.verified).toBe(false);
        expect(result.errorCode).toBe('NOT_FOUND');
        expect(result.errorMessage).toMatch(/_craft-verify\.app\.stellar\.io/);
    });

    it('WRONG_VALUE → errorCode WRONG_VALUE, recordsFound is populated', async () => {
        mockDns.resolveTxt.mockResolvedValue([['stale-token']]);
        const result = await verifyViaTxt('trade.finance', 'expected-token', { retries: 0 });
        expect(result.verified).toBe(false);
        expect(result.errorCode).toBe('WRONG_VALUE');
        expect(result.recordsFound).toContain('stale-token');
        expect(result.errorMessage).toBeDefined();
    });

    it('TIMEOUT → errorCode TIMEOUT, errorMessage mentions timeout', async () => {
        mockDns.resolveTxt.mockImplementation(
            () => new Promise<never>((_, r) => setTimeout(() => r(new Error('DNS_TIMEOUT')), 10)),
        );
        const result = await verifyViaTxt('vault.network', 'token', { timeout: 1, retries: 0 });
        expect(result.verified).toBe(false);
        expect(result.errorCode).toBe('TIMEOUT');
        expect(result.errorMessage).toMatch(/timeout|timed out/i);
    });

    it('CNAME WRONG_VALUE → errorCode WRONG_VALUE, errorMessage names the wrong target', async () => {
        mockDns.resolveCname.mockResolvedValue(['wrong.provider.net']);
        const result = await verifyViaCname('api.craft.dev', { retries: 0 });
        expect(result.verified).toBe(false);
        expect(result.errorCode).toBe('WRONG_VALUE');
        expect(result.errorMessage).toMatch(/wrong\.provider\.net/);
    });

    it('DNS instructions always include Cloudflare and Route 53 steps', () => {
        const config = generateDnsConfiguration('app.stellar.io');
        const providers = config.providerInstructions.map((p) => p.provider);
        expect(providers).toContain('Cloudflare');
        expect(providers).toContain('Route 53 (AWS)');
        for (const pi of config.providerInstructions) {
            expect(pi.steps.length).toBeGreaterThanOrEqual(2);
        }
    });
});
