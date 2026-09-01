/**
 * Adversarial parallel tests for VercelDomainLifecycleService — Issue #711
 *
 * Covers concurrent and edge-case scenarios not addressed in the baseline test suite:
 *
 *   1. Concurrent add + remove of the same domain does not leave inconsistent state.
 *   2. Verification polling terminates cleanly when the domain is removed mid-check.
 *   3. Multiple pending verifications resolve independently (no cross-contamination).
 *   4. Vercel returning domain_already_exists is surfaced as a structured failure.
 *   5. Idempotency: addDomainWithDns called twice with the same domain returns
 *      success on both calls when Vercel accepts, and DNS records are deterministic.
 *
 * All Vercel API calls are mocked — no live network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    VercelDomainLifecycleService,
    type VercelDomainClient,
} from './vercel-domain-lifecycle.service';
import type { AddDomainResult, DomainVerification, CertificateState } from './vercel.service';

// ── Mock VercelDomainClient ───────────────────────────────────────────────────

class MockVercelDomainClient implements VercelDomainClient {
    addDomain = vi.fn<
        [{ domain: string; projectId?: string; redirect?: boolean; forceHttps?: boolean }],
        Promise<AddDomainResult>
    >();
    verifyDomain = vi.fn<
        [string],
        Promise<{ verified: boolean; requirements?: DomainVerification[] }>
    >();
    getCertificate = vi.fn<
        [string, string],
        Promise<{ domain: string; state: CertificateState; expiresAt?: string; error?: string }>
    >();
    removeDomain = vi.fn<[string, string], Promise<void>>();
    listDeploymentAliases = vi.fn<
        [string],
        Promise<Array<{ uid: string; alias: string }>>
    >();
    listDomains = vi.fn<[string], Promise<Array<{ name: string }>>>();
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('VercelDomainLifecycleService — adversarial parallel tests', () => {
    let mockClient: MockVercelDomainClient;
    let service: VercelDomainLifecycleService;

    beforeEach(() => {
        mockClient = new MockVercelDomainClient();
        service = new VercelDomainLifecycleService(mockClient);
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── 1. Concurrent add + remove of the same domain ─────────────────────────

    describe('concurrent add and remove of the same domain', () => {
        it('both operations resolve with structured results — no uncaught exception', async () => {
            mockClient.addDomain.mockResolvedValue({ success: true, domain: 'example.com' });
            mockClient.removeDomain.mockResolvedValue(undefined);

            const [addResult, removeResult] = await Promise.all([
                service.addDomainWithDns('example.com', 'prj_123'),
                service.removeDomainWithCleanup('example.com', 'prj_123', []),
            ]);

            expect(addResult.success).toBe(true);
            expect(addResult.domain).toBe('example.com');
            expect(removeResult.success).toBe(true);
            expect(removeResult.domain).toBe('example.com');
        });

        it('final domain state is consistent — remove tracking records the last Vercel call', async () => {
            // Track which Vercel operation completed last
            let finalVercelCall: 'add' | 'remove' | null = null;

            mockClient.addDomain.mockImplementation(async () => {
                finalVercelCall = 'add';
                return { success: true, domain: 'example.com' };
            });

            mockClient.removeDomain.mockImplementation(async () => {
                finalVercelCall = 'remove';
            });

            await Promise.all([
                service.addDomainWithDns('example.com', 'prj_123'),
                service.removeDomainWithCleanup('example.com', 'prj_123', []),
            ]);

            // One operation completed last — state is deterministic, not corrupted
            expect(finalVercelCall).not.toBeNull();
            expect(['add', 'remove']).toContain(finalVercelCall);
        });

        it('remove completing before add: both return success and are independent', async () => {
            let removeResolve!: () => void;
            const removeBarrier = new Promise<void>((r) => { removeResolve = r; });

            mockClient.removeDomain.mockResolvedValue(undefined);
            // Add waits until remove signals it is done
            mockClient.addDomain.mockImplementation(async () => {
                await removeBarrier;
                return { success: true, domain: 'example.com' };
            });

            const removePromise = service.removeDomainWithCleanup('example.com', 'prj_123', []);
            const addPromise = service.addDomainWithDns('example.com', 'prj_123');

            removeResolve(); // remove completes first

            const [removeResult, addResult] = await Promise.all([removePromise, addPromise]);

            expect(removeResult.success).toBe(true);
            expect(addResult.success).toBe(true);
            // DNS records are still generated — callers can use them after the race
            expect(addResult.dnsRecords.length).toBeGreaterThan(0);
        });

        it('add failure does not affect concurrent remove result', async () => {
            mockClient.addDomain.mockRejectedValue(new Error('Network timeout'));
            mockClient.removeDomain.mockResolvedValue(undefined);

            const [addResult, removeResult] = await Promise.all([
                service.addDomainWithDns('example.com', 'prj_123'),
                service.removeDomainWithCleanup('example.com', 'prj_123', []),
            ]);

            // Add fails gracefully
            expect(addResult.success).toBe(false);
            expect(addResult.error).toBe('Network timeout');

            // Remove is unaffected
            expect(removeResult.success).toBe(true);
            expect(removeResult.aliasesMatched).toBe(0);
        });
    });

    // ── 2. Verification polling stops when domain is removed ──────────────────

    describe('verification terminates cleanly after domain removal', () => {
        it('verifyDnsPropagation after removeDomainWithCleanup returns not-verified', async () => {
            mockClient.removeDomain.mockResolvedValue(undefined);
            await service.removeDomainWithCleanup('example.com', 'prj_123', []);

            // Vercel reports domain no longer verified after removal
            mockClient.verifyDomain.mockResolvedValue({ verified: false });

            const result = await service.verifyDnsPropagation('example.com', 'prj_123');

            expect(result.verified).toBe(false);
            expect(result.domain).toBe('example.com');
        });

        it('verification returns structured result when Vercel errors for a removed domain', async () => {
            // Vercel throws when queried about a domain that no longer exists
            mockClient.verifyDomain.mockRejectedValue(new Error('Domain not found'));

            const result = await service.verifyDnsPropagation('removed.example.com', 'prj_123');

            // Must not throw — service wraps the error into a structured response
            expect(result.verified).toBe(false);
            expect(result.domain).toBe('removed.example.com');
            expect(result.certState).toBe('pending');
            expect(result.reason).toBe('Domain not found');
        });

        it('multiple pending verifications resolve independently with no cross-contamination', async () => {
            const domains = ['a.example.com', 'b.example.com', 'c.example.com'];

            // Only domain b is verified; a and c are still pending
            mockClient.verifyDomain.mockImplementation(async (domain: string) => ({
                verified: domain === 'b.example.com',
            }));

            mockClient.getCertificate.mockResolvedValue({
                domain: 'b.example.com',
                state: 'active',
            });

            const results = await Promise.all(
                domains.map((d) => service.verifyDnsPropagation(d, 'prj_123'))
            );

            expect(results[0].verified).toBe(false); // a: still pending
            expect(results[1].verified).toBe(true);  // b: verified + cert active
            expect(results[2].verified).toBe(false); // c: still pending

            // Domain labels are preserved — no result was assigned to the wrong domain
            expect(results[0].domain).toBe('a.example.com');
            expect(results[1].domain).toBe('b.example.com');
            expect(results[2].domain).toBe('c.example.com');
        });

        it('verify → remove → verify sequence terminates without error', async () => {
            // First verify: domain is pending
            mockClient.verifyDomain.mockResolvedValueOnce({ verified: false });

            const before = await service.verifyDnsPropagation('example.com', 'prj_123');
            expect(before.verified).toBe(false);

            // Remove domain
            mockClient.removeDomain.mockResolvedValue(undefined);
            const removeResult = await service.removeDomainWithCleanup('example.com', 'prj_123', []);
            expect(removeResult.success).toBe(true);

            // Second verify: domain gone, Vercel returns error
            mockClient.verifyDomain.mockRejectedValue(new Error('Domain not registered'));

            const after = await service.verifyDnsPropagation('example.com', 'prj_123');
            expect(after.verified).toBe(false);
            expect(after.reason).toBe('Domain not registered');
        });
    });

    // ── 3. domain_already_exists on re-add ────────────────────────────────────

    describe('Vercel returns domain_already_exists on re-add', () => {
        it('surfaces domain_already_exists as a structured failure — does not throw', async () => {
            mockClient.addDomain.mockResolvedValue({
                success: false,
                domain: 'example.com',
                error: 'Domain already exists',
                errorCode: 'DOMAIN_ALREADY_EXISTS',
            });

            const result = await service.addDomainWithDns('example.com', 'prj_123');

            expect(result.success).toBe(false);
            expect(result.domain).toBe('example.com');
            expect(result.dnsRecords).toEqual([]);
            expect(result.providerInstructions).toEqual([]);
            expect(result.error).toBe('Domain already exists');
        });

        it('re-add after explicit remove: Vercel accepts the domain on second registration', async () => {
            // First add: success
            mockClient.addDomain.mockResolvedValueOnce({ success: true, domain: 'example.com' });
            const first = await service.addDomainWithDns('example.com', 'prj_123');
            expect(first.success).toBe(true);

            // Remove the domain
            mockClient.removeDomain.mockResolvedValue(undefined);
            await service.removeDomainWithCleanup('example.com', 'prj_123', []);

            // Second add after remove: Vercel accepts again
            mockClient.addDomain.mockResolvedValueOnce({ success: true, domain: 'example.com' });
            const second = await service.addDomainWithDns('example.com', 'prj_123');

            expect(second.success).toBe(true);
            expect(second.domain).toBe('example.com');
            expect(second.dnsRecords.length).toBeGreaterThan(0);
        });

        it('domain_already_exists error includes no DNS records or provider instructions', async () => {
            mockClient.addDomain.mockResolvedValue({
                success: false,
                domain: 'duplicate.example.com',
                error: 'Domain already exists',
                errorCode: 'DOMAIN_ALREADY_EXISTS',
            });

            const result = await service.addDomainWithDns('duplicate.example.com', 'prj_999');

            expect(result.dnsRecords).toHaveLength(0);
            expect(result.providerInstructions).toHaveLength(0);
            expect(result.verificationRequirements).toBeUndefined();
        });
    });

    // ── 4. Idempotency: addDomainWithDns called twice ─────────────────────────

    describe('addDomainWithDns idempotency', () => {
        it('two sequential adds with same domain both return success when Vercel accepts', async () => {
            mockClient.addDomain.mockResolvedValue({ success: true, domain: 'example.com' });

            const first = await service.addDomainWithDns('example.com', 'prj_123');
            const second = await service.addDomainWithDns('example.com', 'prj_123');

            expect(first.success).toBe(true);
            expect(second.success).toBe(true);
            expect(mockClient.addDomain).toHaveBeenCalledTimes(2);
        });

        it('DNS records are generated deterministically across repeated calls for the same domain', async () => {
            mockClient.addDomain.mockResolvedValue({ success: true, domain: 'example.com' });

            const first = await service.addDomainWithDns('example.com', 'prj_123');
            const second = await service.addDomainWithDns('example.com', 'prj_123');

            // DNS record types and values must be identical
            expect(first.dnsRecords).toEqual(second.dnsRecords);
            expect(first.providerInstructions.length).toBe(second.providerInstructions.length);
        });

        it('concurrent adds of the same domain to different projects return independent results', async () => {
            mockClient.addDomain.mockResolvedValue({ success: true, domain: 'app.example.com' });

            const [resultA, resultB] = await Promise.all([
                service.addDomainWithDns('app.example.com', 'prj_aaa'),
                service.addDomainWithDns('app.example.com', 'prj_bbb'),
            ]);

            expect(resultA.success).toBe(true);
            expect(resultB.success).toBe(true);
            // DNS records are determined by domain only — both are identical
            expect(resultA.dnsRecords).toEqual(resultB.dnsRecords);
            expect(mockClient.addDomain).toHaveBeenCalledTimes(2);
            expect(mockClient.addDomain).toHaveBeenCalledWith(
                expect.objectContaining({ domain: 'app.example.com', projectId: 'prj_aaa' })
            );
            expect(mockClient.addDomain).toHaveBeenCalledWith(
                expect.objectContaining({ domain: 'app.example.com', projectId: 'prj_bbb' })
            );
        });

        it('second add after first fails still issues a fresh Vercel request', async () => {
            // First add: network failure
            mockClient.addDomain.mockRejectedValueOnce(new Error('Network timeout'));
            // Second add: success
            mockClient.addDomain.mockResolvedValueOnce({ success: true, domain: 'example.com' });

            const first = await service.addDomainWithDns('example.com', 'prj_123');
            const second = await service.addDomainWithDns('example.com', 'prj_123');

            expect(first.success).toBe(false);
            expect(first.error).toBe('Network timeout');

            expect(second.success).toBe(true);
            expect(second.dnsRecords.length).toBeGreaterThan(0);

            expect(mockClient.addDomain).toHaveBeenCalledTimes(2);
        });

        it('add twice then remove once cleans up aliases for the single live domain', async () => {
            mockClient.addDomain.mockResolvedValue({ success: true, domain: 'example.com' });
            mockClient.removeDomain.mockResolvedValue(undefined);
            mockClient.listDeploymentAliases.mockResolvedValue([
                { uid: 'alias_1', alias: 'example.com' },
            ]);

            // Add twice (idempotent from the caller's perspective)
            await service.addDomainWithDns('example.com', 'prj_123');
            await service.addDomainWithDns('example.com', 'prj_123');

            // Remove once — alias count reflects the actual live state, not the add count
            const removeResult = await service.removeDomainWithCleanup(
                'example.com',
                'prj_123',
                ['dpl_1'],
            );

            expect(removeResult.success).toBe(true);
            expect(removeResult.aliasesMatched).toBe(1);
            expect(mockClient.removeDomain).toHaveBeenCalledTimes(1);
        });
    });
});
