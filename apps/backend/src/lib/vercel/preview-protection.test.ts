import { beforeEach, describe, expect, it } from 'vitest';
import { issueBypassToken, validateBypassToken } from './preview-protection';

const TEST_SECRET = 'test-secret-12345';
const DEPLOYMENT_ID = 'dpl-test-deployment-abc';
const OTHER_DEPLOYMENT_ID = 'dpl-other-deployment-xyz';
const BASE_TIME = 1_700_000_000;

describe('preview-protection', () => {
    beforeEach(() => {
        process.env.VERCEL_PROTECTION_BYPASS_SECRET = TEST_SECRET;
    });

    describe('issueBypassToken', () => {
        it('throws when VERCEL_PROTECTION_BYPASS_SECRET is unset', () => {
            delete process.env.VERCEL_PROTECTION_BYPASS_SECRET;
            expect(() => issueBypassToken(DEPLOYMENT_ID, BASE_TIME)).toThrow(
                'VERCEL_PROTECTION_BYPASS_SECRET is not configured',
            );
        });

        it('issues a valid token with expected structure', () => {
            const result = issueBypassToken(DEPLOYMENT_ID, BASE_TIME);
            expect(result.token).toBeTruthy();
            expect(result.expiresAt).toBe(BASE_TIME + 3600);
            expect(result.queryParam).toContain('x-vercel-protection-bypass=');
            expect(result.queryParam).toContain(result.token);
        });
    });

    describe('validateBypassToken', () => {
        it('returns missing_secret when VERCEL_PROTECTION_BYPASS_SECRET is unset', () => {
            const issued = issueBypassToken(DEPLOYMENT_ID, BASE_TIME);
            delete process.env.VERCEL_PROTECTION_BYPASS_SECRET;
            const result = validateBypassToken(issued.token, DEPLOYMENT_ID, BASE_TIME);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('missing_secret');
        });

        it('returns missing_secret when secret is empty string', () => {
            process.env.VERCEL_PROTECTION_BYPASS_SECRET = '';
            const result = validateBypassToken('some-token', DEPLOYMENT_ID, BASE_TIME);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('missing_secret');
        });

        it('validates a round-trip token successfully', () => {
            const issued = issueBypassToken(DEPLOYMENT_ID, BASE_TIME);
            const result = validateBypassToken(issued.token, DEPLOYMENT_ID, BASE_TIME);
            expect(result.valid).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        it('returns invalid_signature for a tampered token', () => {
            const issued = issueBypassToken(DEPLOYMENT_ID, BASE_TIME);
            const buf = Buffer.from(issued.token, 'base64url');
            buf[0] ^= 0x01;
            const tampered = buf.toString('base64url');
            const result = validateBypassToken(tampered, DEPLOYMENT_ID, BASE_TIME);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('invalid_signature');
        });

        it('returns expired when token is used past expiresAt', () => {
            const issued = issueBypassToken(DEPLOYMENT_ID, BASE_TIME);
            const oneSecondPast = issued.expiresAt + 1;
            const result = validateBypassToken(issued.token, DEPLOYMENT_ID, oneSecondPast);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('expired');
        });

        it('returns expired exactly at expiry boundary', () => {
            const issued = issueBypassToken(DEPLOYMENT_ID, BASE_TIME);
            const result = validateBypassToken(issued.token, DEPLOYMENT_ID, issued.expiresAt);
            expect(result.valid).toBe(true);
        });

        it('returns deployment_mismatch for a different deployment ID', () => {
            const issued = issueBypassToken(DEPLOYMENT_ID, BASE_TIME);
            const result = validateBypassToken(issued.token, OTHER_DEPLOYMENT_ID, BASE_TIME);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('deployment_mismatch');
        });

        it('returns invalid_signature for malformed base64url input', () => {
            const result = validateBypassToken('not-a-valid-token!@#$', DEPLOYMENT_ID, BASE_TIME);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('invalid_signature');
        });

        it('returns invalid_signature for garbage input', () => {
            const result = validateBypassToken('/////', DEPLOYMENT_ID, BASE_TIME);
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('invalid_signature');
        });

        it('returns invalid_signature for token with wrong number of parts', () => {
            const result = validateBypassToken(
                Buffer.from('toofewparts').toString('base64url'),
                DEPLOYMENT_ID,
                BASE_TIME,
            );
            expect(result.valid).toBe(false);
            expect(result.reason).toBe('invalid_signature');
        });

        it('does not throw for any malformed input', () => {
            const inputs = ['', 'a', '////', '$$$', Buffer.from('a:b:c:d:e').toString('base64url')];
            for (const input of inputs) {
                expect(() => validateBypassToken(input, DEPLOYMENT_ID, BASE_TIME)).not.toThrow();
            }
        });
    });
});
