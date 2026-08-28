/**
 * GitHub App Webhook Authentication Middleware
 *
 * Wraps route handlers with HMAC-SHA256 signature verification for all
 * /api/admin/webhooks/ routes. Secret is read from GITHUB_WEBHOOK_SECRET env var.
 *
 * On failure: returns 401 with WWW-Authenticate: HMAC, logs source IP.
 * On success: calls the handler.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/api/logger';
import { verifyGitHubWebhookSignature } from './webhook-verification';

const log = createLogger({ service: 'github-webhook-auth' });

/**
 * Timing-safe HMAC-SHA256 verification — thin wrapper over
 * verifyGitHubWebhookSignature for consumers that prefer the shorter name.
 */
export function verifyGitHubSignature(
    payload: string,
    signature: string | null,
    secret: string
): boolean {
    return verifyGitHubWebhookSignature(payload, signature, secret);
}

type RouteHandler = (req: NextRequest, ctx?: any) => Promise<NextResponse>;

/**
 * Middleware that verifies the X-Hub-Signature-256 header before calling the
 * wrapped handler.
 *
 * - Reads the webhook secret from GITHUB_WEBHOOK_SECRET env var.
 * - Returns 401 + WWW-Authenticate: HMAC on missing or invalid signature.
 * - Logs signature failures with the source IP (x-forwarded-for or remote addr).
 */
export function withGitHubWebhookAuth(handler: RouteHandler): RouteHandler {
    return async (req: NextRequest, ctx?: any): Promise<NextResponse> => {
        const secret = process.env.GITHUB_WEBHOOK_SECRET;
        if (!secret) {
            log.warn('GITHUB_WEBHOOK_SECRET is not configured; rejecting request');
            return _unauthorized();
        }

        const signature = req.headers.get('x-hub-signature-256');
        const sourceIp =
            req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

        let payload: string;
        try {
            payload = await req.text();
        } catch {
            return _unauthorized();
        }

        if (!verifyGitHubSignature(payload, signature, secret)) {
            log.warn('GitHub webhook signature verification failed', { sourceIp });
            return _unauthorized();
        }

        // Re-construct a request with the already-consumed body so the handler
        // can call req.json() if it needs to.
        const cloned = new Request(req.url, {
            method: req.method,
            headers: req.headers,
            body: payload,
        });

        return handler(new NextRequest(cloned), ctx);
    };
}

function _unauthorized(): NextResponse {
    return NextResponse.json(
        { error: 'Unauthorized: invalid or missing webhook signature' },
        {
            status: 401,
            headers: { 'WWW-Authenticate': 'HMAC' },
        }
    );
}
