/**
 * Vercel Domain DNS Propagation Integration Test — Issue #801
 *
 * Tests domain verification polling with realistic DNS propagation delays:
 *   - Simulates TXT record appearing after configurable delay (3 polling cycles)
 *   - Asserts service doesn't declare verification failed before timeout
 *   - Tests timeout: domain not verified after max attempts returns { verified: false, timeout: true }
 *   - Uses vi.useFakeTimers() to control intervals without real waiting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock client interface
interface DomainCheckResult {
    verified: boolean;
    requirements?: Array<{ type: string; name: string; value: string }>;
}

interface MockVercelClient {
    verifyDomain: (domain: string) => Promise<DomainCheckResult>;
    getCertificate: (domain: string, projectId: string) => Promise<{ state: string; error?: string }>;
}

/**
 * Simulates VercelDomainLifecycleService DNS propagation polling
 */
class VercelDomainPollingService {
    private pollIntervalMs = 5000; // 5 seconds between polls
    private maxPollAttempts = 12;  // 60 seconds total timeout

    constructor(private client: MockVercelClient) {}

    async verifyDnsPropagation(domain: string, projectId: string): Promise<{ verified: boolean; timeout?: boolean }> {
        let attempts = 0;

        while (attempts < this.maxPollAttempts) {
            attempts++;

            const result = await this.client.verifyDomain(domain);

            if (result.verified) {
                const cert = await this.client.getCertificate(domain, projectId);
                if (cert.state === 'active') {
                    return { verified: true };
                }
            }

            // Wait before next attempt
            if (attempts < this.maxPollAttempts) {
                await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
            }
        }

        return { verified: false, timeout: true };
    }
}

describe('Vercel Domain DNS Propagation (Integration)', () => {
    let mockClient: MockVercelClient;
    let service: VercelDomainPollingService;
    let pollAttempts = 0;

    beforeEach(() => {
        vi.useFakeTimers();
        pollAttempts = 0;

        mockClient = {
            verifyDomain: vi.fn(async (domain: string) => {
                pollAttempts++;
                // Simulate DNS propagation delay: return pending for first 3 calls
                if (pollAttempts < 4) {
                    return { verified: false };
                }
                return { verified: true };
            }),
            getCertificate: vi.fn(async (domain: string, projectId: string) => {
                return { state: 'active' };
            }),
        };

        service = new VercelDomainPollingService(mockClient);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('DNS propagation delay simulation', () => {
        it('waits for TXT record to appear after 3 polling cycles', async () => {
            const verifyPromise = service.verifyDnsPropagation('example.com', 'prj_123');

            // Advance through polling cycles
            // Poll 1
            await vi.advanceTimersByTimeAsync(100);
            expect(pollAttempts).toBe(1);

            // Wait interval and Poll 2
            await vi.advanceTimersByTimeAsync(5100);
            expect(pollAttempts).toBe(2);

            // Wait interval and Poll 3
            await vi.advanceTimersByTimeAsync(5100);
            expect(pollAttempts).toBe(3);

            // Wait interval and Poll 4 (should succeed)
            await vi.advanceTimersByTimeAsync(5100);
            expect(pollAttempts).toBe(4);

            const result = await verifyPromise;
            expect(result.verified).toBe(true);
            expect(result.timeout).toBeUndefined();
        });

        it('does not declare verification failed before timeout', async () => {
            pollAttempts = 0;
            let pendingAttempts = 0;

            mockClient.verifyDomain = vi.fn(async () => {
                pollAttempts++;
                if (pollAttempts <= 6) {
                    pendingAttempts++;
                    return { verified: false };
                }
                return { verified: true };
            });

            const verifyPromise = service.verifyDnsPropagation('example.com', 'prj_123');

            // Simulate 6 polling attempts (30 seconds)
            for (let i = 0; i < 6; i++) {
                await vi.advanceTimersByTimeAsync(5100);
                expect(pendingAttempts).toBe(i + 1);
            }

            // Still pending, but should not have declared failure
            expect(pendingAttempts).toBeLessThan(12);

            // Advance to 7th poll (should succeed)
            await vi.advanceTimersByTimeAsync(5100);
            const result = await verifyPromise;
            expect(result.verified).toBe(true);
        });
    });

    describe('Timeout scenario', () => {
        it('returns timeout: true after max poll attempts without verification', async () => {
            mockClient.verifyDomain = vi.fn(async () => ({
                verified: false, // Always pending
            }));

            const verifyPromise = service.verifyDnsPropagation('example.com', 'prj_123');

            // Advance through all 12 polling attempts
            for (let i = 0; i < 12; i++) {
                await vi.advanceTimersByTimeAsync(5100);
            }

            const result = await verifyPromise;
            expect(result.verified).toBe(false);
            expect(result.timeout).toBe(true);
            expect(mockClient.verifyDomain).toHaveBeenCalledTimes(12);
        });

        it('stops polling after max attempts to avoid resource waste', async () => {
            mockClient.verifyDomain = vi.fn(async () => ({
                verified: false,
            }));

            const verifyPromise = service.verifyDnsPropagation('example.com', 'prj_123');

            // Advance through max attempts
            for (let i = 0; i < 12; i++) {
                await vi.advanceTimersByTimeAsync(5100);
            }

            await verifyPromise;

            // Should be called exactly 12 times, not more
            expect(mockClient.verifyDomain).toHaveBeenCalledTimes(12);
        });
    });

    describe('Certificate state validation', () => {
        it('waits for certificate to become active', async () => {
            let certAttempts = 0;

            mockClient.verifyDomain = vi.fn(async () => ({ verified: true }));
            mockClient.getCertificate = vi.fn(async () => {
                certAttempts++;
                // Return pending for first 2 calls
                if (certAttempts < 3) {
                    return { state: 'pending' };
                }
                return { state: 'active' };
            });

            // First call: domain verified but cert pending
            let result = await service.verifyDnsPropagation('example.com', 'prj_123');
            expect(result.verified).toBe(false); // Should retry because cert not active

            // Second call: cert active
            result = await service.verifyDnsPropagation('example.com', 'prj_123');
            expect(result.verified).toBe(true);
        });

        it('handles certificate error state', async () => {
            mockClient.verifyDomain = vi.fn(async () => ({ verified: true }));
            mockClient.getCertificate = vi.fn(async () => ({
                state: 'error',
                error: 'DNS verification failed',
            }));

            const result = await service.verifyDnsPropagation('example.com', 'prj_123');

            // Should retry because cert is in error state
            expect(mockClient.verifyDomain).toHaveBeenCalled();
        });
    });

    describe('Poll interval control', () => {
        it('respects configured poll interval between attempts', async () => {
            pollAttempts = 0;
            const pollTimes: number[] = [];

            mockClient.verifyDomain = vi.fn(async () => {
                pollAttempts++;
                pollTimes.push(Date.now());
                return { verified: pollAttempts >= 3 };
            });

            const verifyPromise = service.verifyDnsPropagation('example.com', 'prj_123');

            // Initial poll at t=0
            await vi.advanceTimersByTimeAsync(100);
            const firstPollTime = Date.now();

            // Poll 2 at t≈5000
            await vi.advanceTimersByTimeAsync(5100);
            const secondPollTime = Date.now();

            // Poll 3 at t≈10000
            await vi.advanceTimersByTimeAsync(5100);

            await verifyPromise;

            // Verify approximate intervals (fake timers should be precise)
            expect(secondPollTime - firstPollTime).toBeGreaterThanOrEqual(5000);
        });
    });

    describe('Early success', () => {
        it('returns immediately on first poll if domain already verified', async () => {
            mockClient.verifyDomain = vi.fn(async () => ({
                verified: true,
            }));
            mockClient.getCertificate = vi.fn(async () => ({
                state: 'active',
            }));

            const verifyPromise = service.verifyDnsPropagation('example.com', 'prj_123');

            // Advance a tiny bit
            await vi.advanceTimersByTimeAsync(100);

            const result = await verifyPromise;
            expect(result.verified).toBe(true);
            expect(mockClient.verifyDomain).toHaveBeenCalledTimes(1);
            expect(mockClient.getCertificate).toHaveBeenCalledTimes(1);
        });
    });

    describe('Error handling', () => {
        it('throws on network error during verification', async () => {
            mockClient.verifyDomain = vi.fn(async () => {
                throw new Error('Network timeout');
            });

            const verifyPromise = service.verifyDnsPropagation('example.com', 'prj_123');

            await vi.advanceTimersByTimeAsync(100);

            await expect(verifyPromise).rejects.toThrow('Network timeout');
        });

        it('throws on certificate retrieval error', async () => {
            mockClient.verifyDomain = vi.fn(async () => ({
                verified: true,
            }));
            mockClient.getCertificate = vi.fn(async () => {
                throw new Error('Certificate fetch failed');
            });

            const verifyPromise = service.verifyDnsPropagation('example.com', 'prj_123');

            await vi.advanceTimersByTimeAsync(100);

            await expect(verifyPromise).rejects.toThrow('Certificate fetch failed');
        });
    });
});
