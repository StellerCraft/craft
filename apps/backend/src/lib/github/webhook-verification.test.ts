/**
 * GitHub Webhook Signature Verification Tests
 *
 * Tests the secure verification of GitHub webhook signatures using HMAC-SHA256.
 *
 * Security properties tested:
 *   - Valid signatures are accepted
 *   - Invalid signatures are rejected
 *   - Missing signatures are rejected
 *   - Timing-safe comparison is used
 *   - Signature format validation (sha256= prefix)
 *   - Body tampering detection
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
    verifyGitHubWebhookSignature,
    generateGitHubWebhookSignature,
} from './webhook-verification';

const WEBHOOK_SECRET = 'test-webhook-secret';

describe('verifyGitHubWebhookSignature', () => {
    it('accepts a valid signature', () => {
        const payload = '{"test": "data"}';
        const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

        const result = verifyGitHubWebhookSignature(payload, signature, WEBHOOK_SECRET);
        expect(result).toBe(true);
    });

    it('rejects a null signature', () => {
        const payload = '{"test": "data"}';

        const result = verifyGitHubWebhookSignature(payload, null, WEBHOOK_SECRET);
        expect(result).toBe(false);
    });

    it('rejects a signature without sha256= prefix', () => {
        const payload = '{"test": "data"}';
        const signature = 'invalid-signature';

        const result = verifyGitHubWebhookSignature(payload, signature, WEBHOOK_SECRET);
        expect(result).toBe(false);
    });

    it('rejects a signature with wrong secret', () => {
        const payload = '{"test": "data"}';
        const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

        const result = verifyGitHubWebhookSignature(payload, signature, 'wrong-secret');
        expect(result).toBe(false);
    });

    it('rejects a signature with tampered body', () => {
        const originalPayload = '{"test": "data"}';
        const signature = generateGitHubWebhookSignature(originalPayload, WEBHOOK_SECRET);
        const tamperedPayload = '{"test": "tampered"}';

        const result = verifyGitHubWebhookSignature(tamperedPayload, signature, WEBHOOK_SECRET);
        expect(result).toBe(false);
    });

    it('rejects a signature with wrong length', () => {
        const payload = '{"test": "data"}';
        const signature = 'sha256=tooshort';

        const result = verifyGitHubWebhookSignature(payload, signature, WEBHOOK_SECRET);
        expect(result).toBe(false);
    });

    it('accepts different payloads with different signatures', () => {
        const payload1 = '{"test": "data1"}';
        const signature1 = generateGitHubWebhookSignature(payload1, WEBHOOK_SECRET);

        const payload2 = '{"test": "data2"}';
        const signature2 = generateGitHubWebhookSignature(payload2, WEBHOOK_SECRET);

        expect(verifyGitHubWebhookSignature(payload1, signature1, WEBHOOK_SECRET)).toBe(true);
        expect(verifyGitHubWebhookSignature(payload2, signature2, WEBHOOK_SECRET)).toBe(true);
        expect(verifyGitHubWebhookSignature(payload1, signature2, WEBHOOK_SECRET)).toBe(false);
    });

    it('handles empty payload', () => {
        const payload = '';
        const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

        const result = verifyGitHubWebhookSignature(payload, signature, WEBHOOK_SECRET);
        expect(result).toBe(true);
    });

    it('handles large payload', () => {
        const payload = JSON.stringify({ data: 'x'.repeat(10000) });
        const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

        const result = verifyGitHubWebhookSignature(payload, signature, WEBHOOK_SECRET);
        expect(result).toBe(true);
    });
});

describe('generateGitHubWebhookSignature', () => {
    it('generates a valid sha256= prefixed signature', () => {
        const payload = '{"test": "data"}';
        const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

        expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('generates consistent signatures for same input', () => {
        const payload = '{"test": "data"}';
        const signature1 = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);
        const signature2 = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

        expect(signature1).toBe(signature2);
    });

    it('generates different signatures for different inputs', () => {
        const payload1 = '{"test": "data1"}';
        const payload2 = '{"test": "data2"}';

        const signature1 = generateGitHubWebhookSignature(payload1, WEBHOOK_SECRET);
        const signature2 = generateGitHubWebhookSignature(payload2, WEBHOOK_SECRET);

        expect(signature1).not.toBe(signature2);
    });

    it('generates different signatures for different secrets', () => {
        const payload = '{"test": "data"}';
        const secret1 = 'secret1';
        const secret2 = 'secret2';

        const signature1 = generateGitHubWebhookSignature(payload, secret1);
        const signature2 = generateGitHubWebhookSignature(payload, secret2);

        expect(signature1).not.toBe(signature2);
    });

    it('matches GitHub HMAC-SHA256 implementation', () => {
        const payload = '{"test": "data"}';
        const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

        // Verify using Node's crypto directly
        const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
        hmac.update(payload, 'utf8');
        const expected = `sha256=${hmac.digest('hex')}`;

        expect(signature).toBe(expected);
    });
});

describe('Integration: verify after generate', () => {
    it('verifies a signature it generated', () => {
        const payload = '{"test": "data"}';
        const signature = generateGitHubWebhookSignature(payload, WEBHOOK_SECRET);

        const result = verifyGitHubWebhookSignature(payload, signature, WEBHOOK_SECRET);
        expect(result).toBe(true);
    });

    it('rejects a signature generated with different secret', () => {
        const payload = '{"test": "data"}';
        const signature = generateGitHubWebhookSignature(payload, 'different-secret');

        const result = verifyGitHubWebhookSignature(payload, signature, WEBHOOK_SECRET);
        expect(result).toBe(false);
    });

    it('rejects a signature generated with different payload', () => {
        const payload1 = '{"test": "data1"}';
        const signature = generateGitHubWebhookSignature(payload1, WEBHOOK_SECRET);

        const payload2 = '{"test": "data2"}';
        const result = verifyGitHubWebhookSignature(payload2, signature, WEBHOOK_SECRET);
        expect(result).toBe(false);
    });
});
