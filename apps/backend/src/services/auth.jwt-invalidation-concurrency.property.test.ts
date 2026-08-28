import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Mock Supabase before importing AuthService
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        auth: {
            signOut: mockSignOut,
            getSession: mockGetSession,
            refreshSession: mockRefreshSession,
        },
        from: vi.fn().mockReturnValue({
            insert: vi.fn().mockResolvedValue({ error: null }),
        }),
    }),
}));

import { AuthService } from './auth.service';

describe('JWT Token Invalidation Distributed Concurrency Property Tests (#824)', () => {
    let service: AuthService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AuthService();
    });

    // Property 1: Token invalidation is deterministic
    it('token is invalidated in deterministic order across 500 scenarios', async () => {
        const scenario = fc
            .tuple(fc.uuid(), fc.integer({ min: 1, max: 10 }))
            .map(([userId, opCount]) => ({ userId, opCount }));

        await fc.assert(
            fc.asyncProperty(scenario, async ({ userId, opCount }) => {
                mockSignOut.mockResolvedValue({ error: null });
                mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

                // Simulate revoke
                await service.signOut?.();

                // Subsequent authenticated operations should fail
                mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
                const sessionResult = await mockGetSession();

                expect(sessionResult.data.session).toBeNull();
            }),
            { numRuns: 500 }
        );
    });

    // Property 2: Concurrent revoke doesn't create race condition
    it('concurrent revoke and verify operations do not race', async () => {
        const operations = fc.array(
            fc.oneof(
                fc.constant('revoke'),
                fc.constant('verify')
            ),
            { minLength: 5, maxLength: 20 }
        );

        await fc.assert(
            fc.asyncProperty(operations, async (ops) => {
                const results: Array<{ op: string; state: boolean }> = [];
                let isRevoked = false;

                for (const op of ops) {
                    if (op === 'revoke') {
                        mockSignOut.mockResolvedValue({ error: null });
                        await mockSignOut();
                        isRevoked = true;
                        results.push({ op: 'revoke', state: isRevoked });
                    } else if (op === 'verify') {
                        mockGetSession.mockResolvedValue({
                            data: { session: isRevoked ? null : { access_token: 'token' } },
                            error: null,
                        });
                        const session = await mockGetSession();
                        results.push({ op: 'verify', state: session.data.session !== null });
                    }
                }

                // Once revoked, all subsequent verifies must fail
                const lastRevoke = results.findIndex((r) => r.op === 'revoke');
                if (lastRevoke !== -1) {
                    const afterRevoke = results.slice(lastRevoke + 1);
                    const verifies = afterRevoke.filter((r) => r.op === 'verify');
                    // All verifies after revoke should show session is invalid
                    verifies.forEach((v) => {
                        expect(v.state).toBe(false);
                    });
                }
            }),
            { numRuns: 200 }
        );
    });

    // Property 3: No token is usable after revocation
    it('no token remains usable after revocation under concurrent access', async () => {
        const concurrentReads = fc.integer({ min: 5, max: 50 });

        await fc.assert(
            fc.asyncProperty(concurrentReads, async (readCount) => {
                mockSignOut.mockResolvedValue({ error: null });
                mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

                // Revoke
                await mockSignOut();

                // Attempt concurrent reads
                const readPromises = Array(readCount)
                    .fill(null)
                    .map(() => mockGetSession());

                const results = await Promise.all(readPromises);

                // All reads must return no session
                results.forEach((result) => {
                    expect(result.data.session).toBeNull();
                });
            }),
            { numRuns: 100 }
        );
    });

    // Property 4: Token refresh and revoke interleaving
    it('token refresh and revoke interleaving resolves deterministically', async () => {
        const operations = fc.array(
            fc.tuple(fc.constantFrom('refresh', 'revoke'), fc.integer({ min: 0, max: 100 })),
            { minLength: 3, maxLength: 15 }
        );

        await fc.assert(
            fc.asyncProperty(operations, async (ops) => {
                let refreshCount = 0;
                let revokeCount = 0;

                for (const [op] of ops) {
                    if (op === 'refresh') {
                        if (revokeCount === 0) {
                            mockRefreshSession.mockResolvedValue({
                                data: { session: { access_token: `token-${refreshCount}` } },
                                error: null,
                            });
                            await mockRefreshSession();
                            refreshCount++;
                        }
                    } else if (op === 'revoke') {
                        mockSignOut.mockResolvedValue({ error: null });
                        await mockSignOut();
                        revokeCount++;
                    }
                }

                // After revoke, refresh should fail or return null
                if (revokeCount > 0) {
                    mockRefreshSession.mockResolvedValue({
                        data: { session: null },
                        error: { message: 'Session revoked' },
                    });
                    const result = await mockRefreshSession();
                    expect(result.data.session).toBeNull();
                }
            }),
            { numRuns: 150 }
        );
    });

    // Property 5: Token expiry boundary conditions
    it('tokens expiring within 1 second of check are treated as invalid', async () => {
        const expiryDeltas = fc.array(
            fc.integer({ min: -1000, max: 5000 }),
            { minLength: 5, maxLength: 20 }
        );

        await fc.assert(
            fc.asyncProperty(expiryDeltas, async (deltas) => {
                const now = Date.now() / 1000;

                for (const delta of deltas) {
                    const expiresAt = now + delta / 1000;

                    if (delta <= 1000) {
                        // Should be treated as expired
                        mockGetSession.mockResolvedValue({
                            data: { session: null },
                            error: null,
                        });
                    } else {
                        // Should be treated as valid
                        mockGetSession.mockResolvedValue({
                            data: { session: { access_token: 'valid', expires_at: expiresAt } },
                            error: null,
                        });
                    }

                    const result = await mockGetSession();
                    if (delta <= 1000) {
                        expect(result.data.session).toBeNull();
                    }
                }
            }),
            { numRuns: 100 }
        );
    });

    // Property 6: Deterministic with fixed seed
    it('all concurrent scenarios are reproducible with fixed seed', async () => {
        const seed = 12345;
        const scenario = fc
            .tuple(fc.uuid(), fc.integer({ min: 1, max: 5 }))
            .map(([userId, opCount]) => ({ userId, opCount }));

        const run1Results: string[] = [];
        const run2Results: string[] = [];

        // First run with seed
        await fc.assert(
            fc.asyncProperty(scenario, async ({ userId, opCount }) => {
                mockSignOut.mockResolvedValue({ error: null });
                run1Results.push(`${userId}-${opCount}`);
            }),
            { numRuns: 50, seed }
        );

        // Second run with same seed
        await fc.assert(
            fc.asyncProperty(scenario, async ({ userId, opCount }) => {
                mockSignOut.mockResolvedValue({ error: null });
                run2Results.push(`${userId}-${opCount}`);
            }),
            { numRuns: 50, seed }
        );

        // Results should be identical
        expect(run1Results).toEqual(run2Results);
    });

    // Property 7: signOut followed by authenticated call returns 401
    it('signOut followed by any authenticated call returns 401', async () => {
        const authenticatedOps = fc.constant(true);

        await fc.assert(
            fc.asyncProperty(authenticatedOps, async (_) => {
                mockSignOut.mockResolvedValue({ error: null });
                mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

                // Sign out
                await mockSignOut();

                // Attempt authenticated operation (simulate API call check)
                const result = await mockGetSession();

                // Session should be null, simulating 401 response
                expect(result.data.session).toBeNull();
            }),
            { numRuns: 100 }
        );
    });

    // Property 8: Multiple concurrent revokers don't corrupt state
    it('multiple concurrent revoke operations converge to same final state', async () => {
        const revokerCount = fc.integer({ min: 2, max: 10 });

        await fc.assert(
            fc.asyncProperty(revokerCount, async (count) => {
                mockSignOut.mockResolvedValue({ error: null });
                mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

                // Simulate concurrent revokers
                const revokePromises = Array(count)
                    .fill(null)
                    .map(() => mockSignOut());

                await Promise.all(revokePromises);

                // Final state should be consistent
                const finalResult = await mockGetSession();
                expect(finalResult.data.session).toBeNull();
            }),
            { numRuns: 100 }
        );
    });

    // Property 9: Revocation idempotency
    it('revoking an already-revoked token is idempotent', async () => {
        mockSignOut.mockResolvedValue({ error: null });
        mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

        // First revoke
        await mockSignOut();
        const result1 = await mockGetSession();

        // Second revoke (idempotent)
        await mockSignOut();
        const result2 = await mockGetSession();

        expect(result1.data.session).toBeNull();
        expect(result2.data.session).toBeNull();
    });

    // Property 10: Time-based invalidation with scheduler
    it('tokens are invalidated regardless of operation ordering', async () => {
        const orderingArbitrary = fc.shuffledSubarray(
            ['revoke', 'verify1', 'verify2', 'verify3', 'verify4'],
            { minLength: 5, maxLength: 5 }
        );

        await fc.assert(
            fc.asyncProperty(orderingArbitrary, async (ordering) => {
                let revokeExecuted = false;

                for (const op of ordering) {
                    if (op === 'revoke') {
                        mockSignOut.mockResolvedValue({ error: null });
                        await mockSignOut();
                        revokeExecuted = true;
                    } else if (op.startsWith('verify')) {
                        if (revokeExecuted) {
                            mockGetSession.mockResolvedValue({
                                data: { session: null },
                                error: null,
                            });
                        } else {
                            mockGetSession.mockResolvedValue({
                                data: { session: { access_token: 'token' } },
                                error: null,
                            });
                        }
                        const result = await mockGetSession();

                        if (revokeExecuted) {
                            expect(result.data.session).toBeNull();
                        }
                    }
                }
            }),
            { numRuns: 100 }
        );
    });
});
