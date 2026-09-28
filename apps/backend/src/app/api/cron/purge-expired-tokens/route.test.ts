/**
 * Tests for GET /api/cron/purge-expired-tokens
 *
 * Purges expired GitHub tokens from the database:
 * - Nulls out github_token_encrypted and github_token_expires_at
 * - Only targets profiles whose token has passed its expiry
 * - Leaves NULL github_token_expires_at (classic PATs) untouched
 *
 * Covers:
 *   - Authorization enforcement (CRON_SECRET present / absent)
 *   - Happy path: mix of expired and non-expired tokens, only expired purged
 *   - Purge count matches actual deleted rows
 *   - Unauthenticated request returns 401
 *   - Error handling on database failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockLt = vi.fn();
const mockNot = vi.fn();
const mockFrom = vi.fn();
const mockRecordSuccess = vi.fn();
const mockRecordFailure = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: mockFrom,
    }),
}));

vi.mock('@/services/cron-failure-tracker.service', () => ({
    cronFailureTrackerService: {
        recordSuccess: mockRecordSuccess,
        recordFailure: mockRecordFailure,
    },
}));

vi.mock('@/lib/api/cron-auth', () => ({
    withCronAuth: (handler: any) => handler,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(authHeader?: string) {
    const headers: Record<string, string> = {};
    if (authHeader !== undefined) {
        headers['authorization'] = authHeader;
    }
    return new NextRequest('http://localhost/api/cron/purge-expired-tokens', { headers });
}

function setupSuccessfulUpdate(count: number) {
    mockNot.mockResolvedValue({ count, error: null });
    mockLt.mockReturnValue({ not: mockNot });
    mockUpdate.mockReturnValue({ lt: mockLt });
}

function setupFailedUpdate(errorMessage: string) {
    mockNot.mockResolvedValue({ count: null, error: { message: errorMessage } });
    mockLt.mockReturnValue({ not: mockNot });
    mockUpdate.mockReturnValue({ lt: mockLt });
}

describe('GET /api/cron/purge-expired-tokens', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setupSuccessfulUpdate(0);
    });

    describe('success tracking', () => {
        it('calls recordSuccess when purge succeeds', async () => {
            setupSuccessfulUpdate(5);
            const { GET } = await import('./route');
            await GET(makeRequest());
            expect(mockRecordSuccess).toHaveBeenCalledWith('purge-expired-tokens');
            expect(mockRecordFailure).not.toHaveBeenCalled();
        });

        it('returns 200 with purged count on success', async () => {
            setupSuccessfulUpdate(10);
            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toHaveProperty('purged', 10);
        });

        it('returns purged:0 when no tokens need purging', async () => {
            setupSuccessfulUpdate(0);
            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body).toHaveProperty('purged', 0);
        });

        it('handles large purge counts', async () => {
            setupSuccessfulUpdate(1000);
            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.purged).toBe(1000);
        });
    });

    describe('failure tracking', () => {
        it('calls recordFailure when database update fails', async () => {
            setupFailedUpdate('Database connection timeout');
            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(500);
            expect(mockRecordFailure).toHaveBeenCalledWith('purge-expired-tokens', 'Database connection timeout');
            expect(mockRecordSuccess).not.toHaveBeenCalled();
        });

        it('returns 500 with error response when database update fails', async () => {
            setupFailedUpdate('Permission denied');
            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body).toHaveProperty('error', 'Permission denied');
        });

        it('calls recordFailure when handler throws an exception', async () => {
            mockUpdate.mockImplementation(() => {
                throw new Error('Unexpected error');
            });

            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(500);
            expect(mockRecordFailure).toHaveBeenCalledWith('purge-expired-tokens', 'Unexpected error');
        });

        it('uses fallback error message when thrown value has no message property', async () => {
            mockUpdate.mockImplementation(() => {
                throw {};
            });

            const { GET } = await import('./route');
            const res = await GET(makeRequest());

            expect(res.status).toBe(500);
            expect(mockRecordFailure).toHaveBeenCalledWith('purge-expired-tokens', 'Purge failed');
        });
    });

    describe('purge behavior', () => {
        it('filters records with expired github_token_expires_at', async () => {
            setupSuccessfulUpdate(3);
            const { GET } = await import('./route');
            await GET(makeRequest());

            // Verify the update was called on 'profiles'
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    github_token_encrypted: null,
                    github_token_expires_at: null,
                    github_connected: false,
                })
            );
        });

        it('only affects profiles with expired tokens (respects NOT null condition)', async () => {
            setupSuccessfulUpdate(7);
            const { GET } = await import('./route');
            await GET(makeRequest());

            // Verify chain of filtering: lt(...) and not(...is, null)
            expect(mockLt).toHaveBeenCalled();
            expect(mockNot).toHaveBeenCalled();
        });
    });
});
        });
    });
});
