/**
 * GitHub Webhook Signature Verification
 *
 * Provides secure verification of GitHub webhook signatures using HMAC-SHA256.
 * Implements timing-safe comparison to prevent timing attacks.
 *
 * Usage:
 *   import { verifyGitHubWebhookSignature } from '@/lib/github/webhook-verification';
 *   const isValid = verifyGitHubWebhookSignature(payload, signature, secret);
 *
 * Security considerations:
 *   - Uses crypto.timingSafeEqual() to prevent timing attacks
 *   - Validates signature format (sha256= prefix)
 *   - Returns false for missing or malformed signatures
 */

import crypto from 'crypto';

/**
 * Verifies that a GitHub webhook signature matches the expected HMAC-SHA256.
 *
 * @param payload - Raw request body as string
 * @param signature - Value from x-hub-signature-256 header
 * @param secret - GitHub webhook secret configured in repository settings
 * @returns true if signature is valid, false otherwise
 */
export function verifyGitHubWebhookSignature(
    payload: string,
    signature: string | null,
    secret: string
): boolean {
    // 1. Require signature header
    if (!signature) {
        return false;
    }

    // 2. Validate signature format (must start with sha256=)
    if (!signature.startsWith('sha256=')) {
        return false;
    }

    // 3. Compute expected HMAC
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload, 'utf8');
    const expected = `sha256=${hmac.digest('hex')}`;

    // 4. Timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expected);

    // Length check must be done before timingSafeEqual
    if (sigBuffer.length !== expBuffer.length) {
        return false;
    }

    try {
        return crypto.timingSafeEqual(sigBuffer, expBuffer);
    } catch {
        // timingSafeEqual throws if buffers have different lengths (defensive)
        return false;
    }
}

/**
 * Generates a GitHub webhook signature for testing purposes.
 * Mirrors GitHub's own signing logic.
 *
 * @param payload - Raw request body as string
 * @param secret - GitHub webhook secret
 * @returns Signature string in format sha256=...
 */
export function generateGitHubWebhookSignature(
    payload: string,
    secret: string
): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload, 'utf8');
    return `sha256=${hmac.digest('hex')}`;
}
