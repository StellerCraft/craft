/**
 * Tests for lib/api/with-validation (#230)
 *
 * Covers:
 *   withValidation
 *     — passes valid body to handler with validatedBody attached
 *     — returns 400 with field-level errors for invalid body
 *     — returns 400 for malformed JSON
 *
 *   withQueryValidation
 *     — passes valid query params to handler with validatedQuery attached
 *     — returns 400 with field-level errors for invalid query
 *
 *   withParamsValidation
 *     — passes valid params to handler
 *     — returns 400 with field-level errors for invalid params
 */

import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withValidation, withQueryValidation, withParamsValidation } from './with-validation';

const makeReq = (body?: unknown, url = 'http://localhost/api/test') => {
    return new NextRequest(url, {
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : 'not-json{{{',
        headers: { 'content-type': 'application/json' },
    });
};

const makeGetReq = (params: Record<string, string> = {}) => {
    const url = new URL('http://localhost/api/test');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return new NextRequest(url.toString());
};

describe('withValidation', () => {
    const schema = z.object({ email: z.string().email(), name: z.string().min(1) });

    it('calls handler with validatedBody when body is valid', async () => {
        const handler = vi.fn(async (req: any) =>
            NextResponse.json({ received: req.validatedBody }),
        );
        const wrapped = withValidation(schema)(handler);
        const res = await wrapped(makeReq({ email: 'a@b.com', name: 'Alice' }), { params: {} });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: { email: 'a@b.com', name: 'Alice' } });
        expect(handler).toHaveBeenCalledOnce();
    });

    it('returns 400 with field-level errors for invalid body', async () => {
        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withValidation(schema)(handler);
        const res = await wrapped(makeReq({ email: 'not-an-email', name: '' }), { params: {} });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Validation failed');
        expect(body.details).toBeDefined();
        expect(body.details.email).toBeDefined();
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 400 for malformed JSON', async () => {
        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withValidation(schema)(handler);
        // Pass a request with invalid JSON body
        const req = new NextRequest('http://localhost/api/test', {
            method: 'POST',
            body: '{invalid-json',
            headers: { 'content-type': 'application/json' },
        });
        const res = await wrapped(req, { params: {} });

        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Invalid JSON body');
        expect(handler).not.toHaveBeenCalled();
    });

    it('returns 400 when required fields are missing', async () => {
        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withValidation(schema)(handler);
        const res = await wrapped(makeReq({}), { params: {} });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.details.email).toBeDefined();
        expect(body.details.name).toBeDefined();
    });

    it('does not leak raw Zod error internals in response', async () => {
        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withValidation(schema)(handler);
        const res = await wrapped(makeReq({ email: 'invalid-email' }), { params: {} });

        expect(res.status).toBe(400);
        const body = await res.json();
        const bodyStr = JSON.stringify(body);

        expect(bodyStr).not.toContain('_errors');
        expect(bodyStr).not.toContain('ZodError');
        expect(bodyStr).not.toContain('code:');
        expect(body.error).toBe('Validation failed');
        expect(body.details).toBeDefined();
        expect(typeof body.details).toBe('object');
    });

    it('formats validation errors consistently as fieldErrors object', async () => {
        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withValidation(schema)(handler);
        const res = await wrapped(makeReq({ email: 'not-email', name: '' }), { params: {} });

        expect(res.status).toBe(400);
        const body = await res.json();

        expect(body.error).toBe('Validation failed');
        expect(Array.isArray(body.details.email)).toBe(true);
        expect(Array.isArray(body.details.name)).toBe(true);
        expect(body.details.email.length).toBeGreaterThan(0);
        expect(body.details.email[0]).toEqual(expect.any(String));
    });
});

describe('withQueryValidation', () => {
    const schema = z.object({
        page: z.coerce.number().int().positive(),
        limit: z.coerce.number().int().positive().max(100),
    });

    it('calls handler with validatedQuery when params are valid', async () => {
        const handler = vi.fn(async (req: any) =>
            NextResponse.json({ received: req.validatedQuery }),
        );
        const wrapped = withQueryValidation(schema)(handler);
        const res = await wrapped(makeGetReq({ page: '1', limit: '10' }), { params: {} });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ received: { page: 1, limit: 10 } });
    });

    it('returns 400 with field-level errors for invalid query params', async () => {
        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withQueryValidation(schema)(handler);
        const res = await wrapped(makeGetReq({ page: 'abc', limit: '999' }), { params: {} });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Validation failed');
        expect(body.details).toBeDefined();
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('withParamsValidation', () => {
    const schema = z.object({ id: z.string().uuid() });

    it('calls handler when params are valid', async () => {
        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withParamsValidation(schema)(handler);
        const res = await wrapped(makeGetReq(), {
            params: { id: '123e4567-e89b-12d3-a456-426614174000' },
        });

        expect(res.status).toBe(200);
        expect(handler).toHaveBeenCalledOnce();
    });

    it('returns 400 with field-level errors for invalid params', async () => {
        const handler = vi.fn(async () => NextResponse.json({ ok: true }));
        const wrapped = withParamsValidation(schema)(handler);
        const res = await wrapped(makeGetReq(), { params: { id: 'not-a-uuid' } });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe('Validation failed');
        expect(body.details.id).toBeDefined();
        expect(handler).not.toHaveBeenCalled();
    });
});
