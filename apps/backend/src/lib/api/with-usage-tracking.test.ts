import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withUsageTracking, detectOperationType } from './with-usage-tracking';

const makeRequest = (pathname = '/api/deployments', method = 'GET') =>
    new NextRequest(`http://localhost${pathname}`, { method });

describe('withUsageTracking', () => {
    it('returns the handler response unchanged on success (pass-through)', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ id: 'dep_1' }, { status: 201 }));
        const wrapped = await withUsageTracking(handler);

        const res = await wrapped(makeRequest(), { params: {} });

        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ id: 'dep_1' });
        expect(handler).toHaveBeenCalledOnce();
    });

    it('passes params and the resolved operationType through to the handler', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = await withUsageTracking(handler, 'custom_op');

        await wrapped(makeRequest('/api/deployments'), { params: { id: 'dep_1' } });

        expect(handler).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ params: { id: 'dep_1' }, operationType: 'custom_op' })
        );
    });

    it('detects the operation type from the request path when none is supplied', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = await withUsageTracking(handler);

        await wrapped(makeRequest('/api/deployments/abc/preview'), { params: {} });

        expect(handler).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ operationType: 'deployment_preview' })
        );
    });

    it('propagates errors thrown by the wrapped handler', async () => {
        const handler = vi.fn().mockRejectedValue(new Error('handler failed'));
        const wrapped = await withUsageTracking(handler);

        await expect(wrapped(makeRequest(), { params: {} })).rejects.toThrow('handler failed');
        expect(handler).toHaveBeenCalledOnce();
    });

    // withUsageTracking has a TODO (see with-usage-tracking.ts) to extract the
    // authenticated user from the session/JWT and record real usage. Until that
    // lands there is nothing to assert here — these are marked todo rather than
    // silently omitted so the gap stays visible in `vitest run`.
    it.todo('records usage for the authenticated user after a successful response');
    it.todo('does not record usage when the wrapped handler throws');
});

describe('detectOperationType', () => {
    it('detects deployment_preview', () => {
        expect(detectOperationType('/api/deployments/abc/preview')).toBe('deployment_preview');
    });

    it('detects domain_config for https and dns paths', () => {
        expect(detectOperationType('/api/domains/https')).toBe('domain_config');
        expect(detectOperationType('/api/domains/dns')).toBe('domain_config');
    });

    it('detects template_clone', () => {
        expect(detectOperationType('/api/templates/tpl_1/clone')).toBe('template_clone');
    });

    it('detects custom_domain', () => {
        expect(detectOperationType('/api/deployments/abc/custom-domain')).toBe('custom_domain');
    });

    it('detects github_sync', () => {
        expect(detectOperationType('/api/github/webhook')).toBe('github_sync');
    });

    it('falls back to api_call for unrecognized paths', () => {
        expect(detectOperationType('/api/whatever')).toBe('api_call');
    });
});
