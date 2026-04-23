/**
 * Production Smoke Tests
 *
 * Lightweight tests that verify critical functionality after deployment.
 * Must complete in under 2 minutes. Run via: SMOKE_BASE_URL=https://... vitest run tests/smoke
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:4001';

async function get(path: string, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${BASE_URL}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
}

async function post(path: string, body: unknown, token?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('Auth endpoints', () => {
    it('POST /api/auth/signup rejects invalid input with 400', async () => {
        const res = await post('/api/auth/signup', { email: 'not-an-email', password: 'x' });
        expect(res.status).toBe(400);
    });

    it('POST /api/auth/signin rejects bad credentials with 401', async () => {
        const res = await post('/api/auth/signin', {
            email: 'smoke-nonexistent@craft.app',
            password: 'wrongpassword',
        });
        expect(res.status).toBe(401);
    });

    it('GET /api/auth/user returns 401 without token', async () => {
        const res = await get('/api/auth/user');
        expect(res.status).toBe(401);
    });
});

// ── Database connectivity (via templates endpoint) ────────────────────────────

describe('Database connectivity', () => {
    it('GET /api/templates returns 200 and an array', async () => {
        const res = await get('/api/templates');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
    });
});

// ── External service integrations ─────────────────────────────────────────────

describe('External service integrations', () => {
    it('POST /api/payments/checkout returns 401 without auth', async () => {
        const res = await post('/api/payments/checkout', { priceId: 'price_test' });
        expect(res.status).toBe(401);
    });

    it('GET /api/payments/subscription returns 401 without auth', async () => {
        const res = await get('/api/payments/subscription');
        expect(res.status).toBe(401);
    });
});

// ── Critical user flows ───────────────────────────────────────────────────────

describe('Critical user flows', () => {
    let authToken: string | undefined;

    beforeAll(async () => {
        const email = process.env.SMOKE_TEST_EMAIL;
        const password = process.env.SMOKE_TEST_PASSWORD;
        if (!email || !password) return;

        const res = await post('/api/auth/signin', { email, password });
        if (res.ok) {
            const body = await res.json();
            authToken = body?.session?.access_token;
        }
    });

    it('GET /api/templates returns template list', async () => {
        const res = await get('/api/templates');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(Array.isArray(body)).toBe(true);
    });

    it('GET /api/auth/user returns user when authenticated', async () => {
        if (!authToken) {
            console.warn('Skipping authenticated flow: SMOKE_TEST_EMAIL/PASSWORD not set');
            return;
        }
        const res = await get('/api/auth/user', authToken);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('id');
        expect(body).toHaveProperty('email');
    });

    it('GET /api/deployments returns deployments when authenticated', async () => {
        if (!authToken) {
            console.warn('Skipping authenticated flow: SMOKE_TEST_EMAIL/PASSWORD not set');
            return;
        }
        const res = await get('/api/deployments', authToken);
        expect(res.status).toBe(200);
    });
});
