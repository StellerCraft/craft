// @vitest-environment node
/**
 * Tests for GitHub App webhook signature verification (#765)
 *
 * Covers:
 *   - verifyGitHubSignature: valid, invalid, missing header
 *   - withGitHubWebhookAuth middleware: 401 on missing/invalid sig, passes through on valid
 *   - Timing-safe comparison (no early exit on length mismatch)
 *   - WWW-Authenticate: HMAC header on failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api/logger', () => ({
    createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        audit: vi.fn(),
    }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = 'test-webhook-secret';

function sign(payload: string, secret = SECRET): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload, 'utf8');
    return `sha256=${hmac.digest('hex')}`;
}

function makeRequest(payload: string, signature?: string | null): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (signature !== undefined && signature !== null) {
        headers['x-hub-signature-256'] = signature;
    }
    return new NextRequest('http://localhost/api/admin/webhooks/test', {
        method: 'POST',
        headers,
        body: payload,
    });
}

// ── verifyGitHubSignature ─────────────────────────────────────────────────────

describe('verifyGitHubSignature', () => {
    // Dynamically import to allow env changes per test
    const load = async () => {
        const mod = await import('@/lib/github/github-webhook');
        return mod.verifyGitHubSignature;
    };

    it('returns true for a valid signature', async () => {
        const verifyGitHubSignature = await load();
        const payload = '{"action":"push"}';
        expect(verifyGitHubSignature(payload, sign(payload), SECRET)).toBe(true);
    });

    it('returns false for an invalid signature', async () => {
        const verifyGitHubSignature = await load();
        const payload = '{"action":"push"}';
        expect(verifyGitHubSignature(payload, sign(payload, 'wrong-secret'), SECRET)).toBe(false);
    });

    it('returns false for a null (missing) signature', async () => {
        const verifyGitHubSignature = await load();
        expect(verifyGitHubSignature('payload', null, SECRET)).toBe(false);
    });

    it('returns false for a signature without sha256= prefix', async () => {
        const verifyGitHubSignature = await load();
        expect(verifyGitHubSignature('payload', 'deadbeef', SECRET)).toBe(false);
    });

    it('returns false for a tampered payload', async () => {
        const verifyGitHubSignature = await load();
        const original = '{"action":"push"}';
        const sig = sign(original);
        expect(verifyGitHubSignature('{"action":"tampered"}', sig, SECRET)).toBe(false);
    });

    it('uses timing-safe comparison (does not throw on length mismatch)', async () => {
        const verifyGitHubSignature = await load();
        // Short signature — should return false, never throw
        expect(() =>
            verifyGitHubSignature('payload', 'sha256=short', SECRET)
        ).not.toThrow();
        expect(verifyGitHubSignature('payload', 'sha256=short', SECRET)).toBe(false);
    });
});

// ── withGitHubWebhookAuth middleware ──────────────────────────────────────────

describe('withGitHubWebhookAuth', () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
        process.env.GITHUB_WEBHOOK_SECRET = SECRET;
        vi.resetModules();
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        vi.resetModules();
    });

    async function load() {
        const mod = await import('@/lib/github/github-webhook');
        return mod.withGitHubWebhookAuth;
    }

    it('calls the handler when signature is valid', async () => {
        const withGitHubWebhookAuth = await load();
        const payload = '{"action":"push"}';
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withGitHubWebhookAuth(handler);
        const res = await wrapped(makeRequest(payload, sign(payload)));
        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledOnce();
    });

    it('returns 401 with WWW-Authenticate: HMAC when signature is missing', async () => {
        const withGitHubWebhookAuth = await load();
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withGitHubWebhookAuth(handler);
        const res = await wrapped(makeRequest('payload', null));
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toBe('HMAC');
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 401 with WWW-Authenticate: HMAC when signature is invalid', async () => {
        const withGitHubWebhookAuth = await load();
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withGitHubWebhookAuth(handler);
        const res = await wrapped(makeRequest('payload', 'sha256=badsignature'));
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toBe('HMAC');
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 401 when GITHUB_WEBHOOK_SECRET is not set', async () => {
        delete process.env.GITHUB_WEBHOOK_SECRET;
        const withGitHubWebhookAuth = await load();
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withGitHubWebhookAuth(handler);
        const res = await wrapped(makeRequest('payload', sign('payload')));
        expect(res.status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
    });
});
