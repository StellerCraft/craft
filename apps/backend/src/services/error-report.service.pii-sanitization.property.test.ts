/**
 * Property Tests — Error Report PII Sanitization Completeness
 *
 * Issue #742
 *
 * Verifies that ErrorReportService redacts all PII before storing an error
 * report.  Tests use generated fixtures only — no real error data.
 *
 * Properties:
 *   P1  Any description containing an email address must have it redacted.
 *   P2  Any errorContext.message containing an email address must have it
 *       redacted.
 *   P3  A Stellar G-key anywhere in the report must be truncated to its first
 *       4 and last 4 characters.
 *   P4  An email nested inside a stack-frame-like string must also be redacted.
 *   P5  Credit card numbers must be replaced with [REDACTED_CARD].
 *   P6  Reports that contain no PII must pass through unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ErrorReportService } from './error-report.service';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: () => ({
            insert: mockInsert,
        }),
    }),
}));

// ── Arbitraries ───────────────────────────────────────────────────────────────

const STELLAR_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Valid-looking Stellar G-key: 'G' + 55 base32 chars. */
const arbStellarKey = fc
    .tuple(
        fc.constant('G'),
        fc.stringOf(
            fc.constantFrom(...(STELLAR_CHARS.split('') as [string, ...string[]])),
            { minLength: 55, maxLength: 55 },
        ),
    )
    .map(([g, rest]) => g + rest);

// Chars valid in the local part that our sanitizer regex covers
const EMAIL_LOCAL_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const EMAIL_DOMAINS = ['example', 'test', 'mail', 'domain', 'craft'] as const;
const EMAIL_TLDS = ['com', 'io', 'net', 'org', 'app'] as const;

/**
 * Email addresses that match the sanitizer's practical email regex.
 * Avoids RFC-edge-case formats (e.g. `!@a.aa`) that the regex intentionally
 * does not cover.
 */
const arbEmail = fc
    .tuple(
        fc.stringOf(
            fc.constantFrom(...(EMAIL_LOCAL_CHARS.split('') as [string, ...string[]])),
            { minLength: 1, maxLength: 12 },
        ),
        fc.constantFrom(...EMAIL_DOMAINS),
        fc.constantFrom(...EMAIL_TLDS),
    )
    .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** 16-digit credit card number as a plain string. */
const arbCreditCard = fc
    .tuple(
        fc.integer({ min: 1000, max: 9999 }),
        fc.integer({ min: 1000, max: 9999 }),
        fc.integer({ min: 1000, max: 9999 }),
        fc.integer({ min: 1000, max: 9999 }),
    )
    .map(([a, b, c, d]) => `${a}${b}${c}${d}`);

/** Safe string — guaranteed not to contain email/Stellar-key/card patterns. */
const arbSafeText = fc.stringMatching(/^[a-z ]{1,40}$/);

// ── Helpers ───────────────────────────────────────────────────────────────────

function capturedInsertArg(): Record<string, unknown> {
    return mockInsert.mock.calls[0][0] as Record<string, unknown>;
}

function capturedContext(): Record<string, unknown> {
    return capturedInsertArg().error_context as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Property Tests — Error Report PII Sanitization (#742)', () => {
    let service: ErrorReportService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ErrorReportService();
        mockInsert.mockReturnValue({
            select: () => ({
                single: mockSingle,
            }),
        });
        mockSingle.mockResolvedValue({
            data: {
                id: 'r-1',
                user_id: 'u-1',
                correlation_id: null,
                description: 'sanitized',
                error_context: { message: 'sanitized' },
                status: 'open',
                created_at: '2026-01-01T00:00:00Z',
            },
            error: null,
        });
    });

    // ── P1: email in description ──────────────────────────────────────────────

    it('P1: email in description is always redacted', async () => {
        await fc.assert(
            fc.asyncProperty(arbEmail, arbSafeText, async (email, prefix) => {
                vi.clearAllMocks();
                mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
                mockSingle.mockResolvedValue({
                    data: {
                        id: 'r-1', user_id: 'u-1', correlation_id: null,
                        description: 'x', error_context: { message: 'x' },
                        status: 'open', created_at: '2026-01-01T00:00:00Z',
                    },
                    error: null,
                });

                await service.submit('u-1', {
                    description: `${prefix} ${email} error occurred`,
                    errorContext: { message: 'network failure' },
                });

                const stored = capturedInsertArg();
                const description = stored.description as string;

                // Invariant: original email must not appear in stored description
                expect(description).not.toContain(email);
                expect(description).toContain('[REDACTED_EMAIL]');
            }),
            { numRuns: 100 },
        );
    });

    // ── P2: email in errorContext.message ─────────────────────────────────────

    it('P2: email in errorContext.message is always redacted', async () => {
        await fc.assert(
            fc.asyncProperty(arbEmail, arbSafeText, async (email, ctx) => {
                vi.clearAllMocks();
                mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
                mockSingle.mockResolvedValue({
                    data: {
                        id: 'r-1', user_id: 'u-1', correlation_id: null,
                        description: 'x', error_context: { message: 'x' },
                        status: 'open', created_at: '2026-01-01T00:00:00Z',
                    },
                    error: null,
                });

                await service.submit('u-1', {
                    description: 'test',
                    errorContext: { message: `failed for user ${email} in ${ctx}` },
                });

                const ctxStored = capturedContext();
                const message = ctxStored.message as string;

                // Invariant: email must be redacted in stored context message
                expect(message).not.toContain(email);
                expect(message).toContain('[REDACTED_EMAIL]');
            }),
            { numRuns: 100 },
        );
    });

    // ── P3: Stellar G-key in errorContext is truncated ────────────────────────

    it('P3: Stellar G-key in errorContext.message is truncated to first/last 4 chars', async () => {
        await fc.assert(
            fc.asyncProperty(arbStellarKey, async (gkey) => {
                vi.clearAllMocks();
                mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
                mockSingle.mockResolvedValue({
                    data: {
                        id: 'r-1', user_id: 'u-1', correlation_id: null,
                        description: 'x', error_context: { message: 'x' },
                        status: 'open', created_at: '2026-01-01T00:00:00Z',
                    },
                    error: null,
                });

                await service.submit('u-1', {
                    description: 'stellar key error',
                    errorContext: { message: `account ${gkey} not found` },
                });

                const ctxStored = capturedContext();
                const message = ctxStored.message as string;
                const expected = `${gkey.slice(0, 4)}...${gkey.slice(-4)}`;

                // Invariant: full key must not appear; truncated form must appear
                expect(message).not.toContain(gkey);
                expect(message).toContain(expected);
            }),
            { numRuns: 100 },
        );
    });

    // ── P4: email nested in a stack-frame string ──────────────────────────────

    it('P4: email nested inside a stack-frame-like string is redacted', async () => {
        await fc.assert(
            fc.asyncProperty(arbEmail, async (email) => {
                vi.clearAllMocks();
                mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
                mockSingle.mockResolvedValue({
                    data: {
                        id: 'r-1', user_id: 'u-1', correlation_id: null,
                        description: 'x', error_context: { message: 'x' },
                        status: 'open', created_at: '2026-01-01T00:00:00Z',
                    },
                    error: null,
                });

                // Simulate a stack trace that accidentally captured user email
                const stackFrame = [
                    `Error: user ${email} triggered an exception`,
                    '    at UserService.getProfile (user.service.ts:42)',
                    '    at async handler (route.ts:15)',
                ].join('\n');

                await service.submit('u-1', {
                    description: stackFrame,
                    errorContext: { message: 'unhandled exception' },
                });

                const stored = capturedInsertArg();
                const description = stored.description as string;

                // Invariant: email must not survive even inside multi-line strings
                expect(description).not.toContain(email);
                expect(description).toContain('[REDACTED_EMAIL]');
            }),
            { numRuns: 100 },
        );
    });

    // ── P5: credit card numbers are replaced ──────────────────────────────────

    it('P5: credit card number in description is replaced with [REDACTED_CARD]', async () => {
        await fc.assert(
            fc.asyncProperty(arbCreditCard, async (card) => {
                vi.clearAllMocks();
                mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
                mockSingle.mockResolvedValue({
                    data: {
                        id: 'r-1', user_id: 'u-1', correlation_id: null,
                        description: 'x', error_context: { message: 'x' },
                        status: 'open', created_at: '2026-01-01T00:00:00Z',
                    },
                    error: null,
                });

                await service.submit('u-1', {
                    description: `payment failed card ${card}`,
                    errorContext: { message: 'stripe error' },
                });

                const stored = capturedInsertArg();
                const description = stored.description as string;

                // Invariant: raw card number must not be stored
                expect(description).not.toContain(card);
                expect(description).toContain('[REDACTED_CARD]');
            }),
            { numRuns: 100 },
        );
    });

    // ── P6: PII-free reports pass through unchanged ───────────────────────────

    it('P6: reports with no PII are stored without modification', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    description: arbSafeText,
                    message: arbSafeText,
                }),
                async ({ description, message }) => {
                    vi.clearAllMocks();
                    mockInsert.mockReturnValue({ select: () => ({ single: mockSingle }) });
                    mockSingle.mockResolvedValue({
                        data: {
                            id: 'r-1', user_id: 'u-1', correlation_id: null,
                            description: 'x', error_context: { message: 'x' },
                            status: 'open', created_at: '2026-01-01T00:00:00Z',
                        },
                        error: null,
                    });

                    await service.submit('u-1', {
                        description,
                        errorContext: { message },
                    });

                    const stored = capturedInsertArg();
                    const ctxStored = capturedContext();

                    // Invariant: safe text survives sanitization unchanged
                    expect(stored.description).toBe(description);
                    expect(ctxStored.message).toBe(message);
                },
            ),
            { numRuns: 100 },
        );
    });
});
