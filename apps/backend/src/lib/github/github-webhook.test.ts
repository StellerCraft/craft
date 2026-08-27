import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const { mockVerify, mockWarn } = vi.hoisted(() => ({
    mockVerify: vi.fn(),
    mockWarn: vi.fn(),
}));

vi.mock('./webhook-verification', () => ({
    verifyGitHubWebhookSignature: mockVerify,
}));

vi.mock('@/lib/api/logger', () => ({
    createLogger: () => ({ warn: mockWarn, info: vi.fn(), error: vi.fn() }),
}));

import { verifyGitHubSignature, withGitHubWebhookAuth } from './github-webhook';

function makeRequest(body: string, headers: Record<string, string> = {}) {
    return new NextRequest('http://localhost/api/admin/webhooks/github', {
        method: 'POST',
        headers,
        body,
    });
}

describe('verifyGitHubSignature', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to verifyGitHubWebhookSignature with the same arguments', () => {
        mockVerify.mockReturnValue(true);

        const result = verifyGitHubSignature('payload', 'sha256=abc', 'secret');

        expect(result).toBe(true);
        expect(mockVerify).toHaveBeenCalledWith('payload', 'sha256=abc', 'secret');
    });

    it('returns false when the underlying verifier rejects the signature', () => {
        mockVerify.mockReturnValue(false);

        expect(verifyGitHubSignature('payload', 'sha256=bad', 'secret')).toBe(false);
    });
});

describe('withGitHubWebhookAuth', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...ORIGINAL_ENV, GITHUB_WEBHOOK_SECRET: 'test-secret' };
    });

    afterEach(() => {
        process.env = ORIGINAL_ENV;
    });

    it('returns 401 with WWW-Authenticate: HMAC and skips verification when the secret is not configured', async () => {
        delete process.env.GITHUB_WEBHOOK_SECRET;
        const handler = vi.fn();
        const wrapped = withGitHubWebhookAuth(handler);

        const res = await wrapped(makeRequest('{}'));

        expect(res.status).toBe(401);
        expect(res.headers.get('WWW-Authenticate')).toBe('HMAC');
        expect(handler).not.toHaveBeenCalled();
        expect(mockVerify).not.toHaveBeenCalled();
    });

    it('returns 401 with WWW-Authenticate: HMAC when the signature is invalid', async () => {
        mockVerify.mockReturnValue(false);
        const handler = vi.fn();
        const wrapped = withGitHubWebhookAuth(handler);

        const res = await wrapped(makeRequest('{}', { 'x-hub-signature-256': 'sha256=bad' }));

        expect(res.status).toBe(401);
        expect(res.headers.get('WWW-Authenticate')).toBe('HMAC');
        expect(handler).not.toHaveBeenCalled();
    });

    it('logs the source IP (from x-forwarded-for) on signature failure', async () => {
        mockVerify.mockReturnValue(false);
        const wrapped = withGitHubWebhookAuth(vi.fn());

        await wrapped(makeRequest('{}', { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }));

        expect(mockWarn).toHaveBeenCalledWith('GitHub webhook signature verification failed', {
            sourceIp: '1.2.3.4',
        });
    });

    it('logs sourceIp as "unknown" when x-forwarded-for is absent', async () => {
        mockVerify.mockReturnValue(false);
        const wrapped = withGitHubWebhookAuth(vi.fn());

        await wrapped(makeRequest('{}'));

        expect(mockWarn).toHaveBeenCalledWith('GitHub webhook signature verification failed', {
            sourceIp: 'unknown',
        });
    });

    it('verifies using the raw body, x-hub-signature-256 header, and configured secret', async () => {
        mockVerify.mockReturnValue(true);
        const wrapped = withGitHubWebhookAuth(vi.fn().mockResolvedValue(NextResponse.json({ ok: true })));

        await wrapped(makeRequest('{"action":"opened"}', { 'x-hub-signature-256': 'sha256=xyz' }));

        expect(mockVerify).toHaveBeenCalledWith('{"action":"opened"}', 'sha256=xyz', 'test-secret');
    });

    it('calls the wrapped handler with a request whose body is still readable when the signature is valid', async () => {
        mockVerify.mockReturnValue(true);
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withGitHubWebhookAuth(handler);

        const res = await wrapped(makeRequest('{"action":"opened"}', { 'x-hub-signature-256': 'sha256=xyz' }));

        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledOnce();
        const forwardedReq = handler.mock.calls[0][0] as NextRequest;
        await expect(forwardedReq.json()).resolves.toEqual({ action: 'opened' });
    });

    it('forwards the ctx argument to the wrapped handler unchanged', async () => {
        mockVerify.mockReturnValue(true);
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withGitHubWebhookAuth(handler);
        const ctx = { params: { id: '1' } };

        await wrapped(makeRequest('{}', { 'x-hub-signature-256': 'sha256=xyz' }), ctx);

        expect(handler.mock.calls[0][1]).toBe(ctx);
    });
});
