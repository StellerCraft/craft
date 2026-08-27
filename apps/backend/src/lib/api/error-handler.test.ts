import { describe, it, expect } from 'vitest';
import { handleApiError, validationError, unauthorizedError, AppError } from './error-handler';

class GitHubCredentialError extends Error {
    constructor(
        public readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'GitHubCredentialError';
    }
}

async function bodyOf(res: Response) {
    return res.json();
}

describe('handleApiError', () => {
    it('formats a known AppError using its own code, and includes details', async () => {
        const err = new AppError('AUTH_FORBIDDEN', 'You cannot do that.', { reason: 'not-owner' });

        const res = handleApiError(err);
        const body = await bodyOf(res);

        expect(res.status).toBe(403);
        expect(body).toMatchObject({
            code: 'AUTH_FORBIDDEN',
            category: 'auth',
            message: 'You cannot do that.',
            details: { reason: 'not-owner' },
        });
    });

    it('omits details for a plain Error', async () => {
        const res = handleApiError(new Error('boom'));
        const body = await bodyOf(res);

        expect(body.details).toBeUndefined();
    });

    it('includes the correlationId when provided', async () => {
        const res = handleApiError(new Error('boom'), 'corr-123');
        const body = await bodyOf(res);

        expect(body.correlationId).toBe('corr-123');
    });

    it('omits the correlationId when not provided', async () => {
        const res = handleApiError(new Error('boom'));
        const body = await bodyOf(res);

        expect(body.correlationId).toBeUndefined();
    });

    it('classifies an unauthorized message', async () => {
        const res = handleApiError(new Error('Unauthorized access'));
        const body = await bodyOf(res);

        expect(res.status).toBe(401);
        expect(body.code).toBe('AUTH_UNAUTHENTICATED');
    });

    it('classifies an unauthenticated message', async () => {
        const res = handleApiError(new Error('user is unauthenticated'));
        const body = await bodyOf(res);

        expect(body.code).toBe('AUTH_UNAUTHENTICATED');
    });

    it('classifies a forbidden message', async () => {
        const res = handleApiError(new Error('Forbidden: no access'));
        const body = await bodyOf(res);

        expect(res.status).toBe(403);
        expect(body.code).toBe('AUTH_FORBIDDEN');
    });

    it.each([
        ['NOT_CONNECTED', 'AUTH_TOKEN_NOT_CONNECTED'],
        ['TOKEN_EXPIRED', 'AUTH_TOKEN_EXPIRED'],
        ['TOKEN_INVALID', 'AUTH_TOKEN_INVALID'],
        ['SOMETHING_ELSE', 'GITHUB_AUTH_FAILED'],
    ])('maps GitHubCredentialError code %s to %s', async (credCode, expectedCode) => {
        const err = new GitHubCredentialError(credCode, 'credential problem');
        const res = handleApiError(err);
        const body = await bodyOf(res);

        expect(body.code).toBe(expectedCode);
        expect(body.message).toBe('credential problem');
    });

    it('classifies a GitHub rate-limit message', async () => {
        const res = handleApiError(new Error('GitHub API rate limit exceeded'));
        const body = await bodyOf(res);

        expect(res.status).toBe(429);
        expect(body.code).toBe('GITHUB_RATE_LIMITED');
    });

    it('classifies a Vercel rate-limit message', async () => {
        const res = handleApiError(new Error('vercel returned 429'));
        const body = await bodyOf(res);

        expect(body.code).toBe('VERCEL_RATE_LIMITED');
    });

    it('defaults an unattributed rate-limit message to GitHub', async () => {
        const res = handleApiError(new Error('rate limit hit'));
        const body = await bodyOf(res);

        expect(body.code).toBe('GITHUB_RATE_LIMITED');
    });

    it('classifies a GitHub network error', async () => {
        const res = handleApiError(new Error('github fetch failed: ECONNREFUSED'));
        const body = await bodyOf(res);

        expect(body.code).toBe('GITHUB_NETWORK_ERROR');
        expect(body.message).toBe('Could not reach GitHub.');
    });

    it('classifies a Vercel network error', async () => {
        const res = handleApiError(new Error('vercel network unreachable'));
        const body = await bodyOf(res);

        expect(body.code).toBe('VERCEL_NETWORK_ERROR');
    });

    it('classifies a Stellar network error', async () => {
        const res = handleApiError(new Error('stellar network timeout'));
        const body = await bodyOf(res);

        expect(body.code).toBe('STELLAR_ENDPOINT_UNREACHABLE');
    });

    it('classifies an unattributed network error as internal', async () => {
        const res = handleApiError(new Error('network unreachable'));
        const body = await bodyOf(res);

        expect(body.code).toBe('INTERNAL_SERVER_ERROR');
        expect(body.message).toBe('A network error occurred.');
    });

    it('classifies a database error without leaking the raw driver message', async () => {
        const rawMessage = 'supabase: relation "users" violates unique constraint at /internal/db.ts:42';
        const res = handleApiError(new Error(rawMessage));
        const body = await bodyOf(res);

        expect(res.status).toBe(500);
        expect(body.code).toBe('INTERNAL_DATABASE_ERROR');
        expect(body.message).toBe('A database error occurred.');
        expect(body.message).not.toContain(rawMessage);
        expect(JSON.stringify(body)).not.toContain('/internal/db.ts');
    });

    it('classifies an unknown generic error without leaking its message or a stack trace', async () => {
        const err = new Error('SELECT * FROM secrets WHERE token = "abc123"');
        const res = handleApiError(err);
        const body = await bodyOf(res);

        expect(res.status).toBe(500);
        expect(body.code).toBe('INTERNAL_SERVER_ERROR');
        expect(body.category).toBe('internal');
        expect(body.message).toBe('An unexpected error occurred.');
        expect(JSON.stringify(body)).not.toContain('secrets');
        expect(JSON.stringify(body)).not.toContain('abc123');
        expect(body).not.toHaveProperty('stack');
    });

    it('classifies a non-Error thrown value as an unexpected internal error', async () => {
        const res = handleApiError('just a string');
        const body = await bodyOf(res);

        expect(body.code).toBe('INTERNAL_SERVER_ERROR');
        expect(body.message).toBe('An unexpected error occurred.');
    });
});

describe('validationError', () => {
    it('returns a 400 with the validation code and provided details', async () => {
        const res = validationError({ field: 'email', issue: 'required' });
        const body = await bodyOf(res);

        expect(res.status).toBe(400);
        expect(body).toMatchObject({
            code: 'VALIDATION_SCHEMA_ERROR',
            category: 'validation',
            message: 'Validation failed.',
            details: { field: 'email', issue: 'required' },
        });
    });

    it('includes the correlationId when provided', async () => {
        const res = validationError({ field: 'email' }, 'corr-456');
        const body = await bodyOf(res);

        expect(body.correlationId).toBe('corr-456');
    });
});

describe('unauthorizedError', () => {
    it('returns a 401 with the auth code', async () => {
        const res = unauthorizedError();
        const body = await bodyOf(res);

        expect(res.status).toBe(401);
        expect(body).toMatchObject({
            code: 'AUTH_UNAUTHENTICATED',
            category: 'auth',
            message: 'Authentication required.',
        });
        expect(body.correlationId).toBeUndefined();
    });

    it('includes the correlationId when provided', async () => {
        const res = unauthorizedError('corr-789');
        const body = await bodyOf(res);

        expect(body.correlationId).toBe('corr-789');
    });
});
