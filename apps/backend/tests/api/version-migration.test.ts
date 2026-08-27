// @vitest-environment node
/**
 * Tests for API versioning schema migration middleware (#760)
 *
 * Covers:
 *   - v1 body with repositoryName gets migrated to repository.name
 *   - v2 body passes through unchanged
 *   - Missing Accept-Version header defaults to v2 with deprecation warning header
 *   - Unknown version returns 406 Not Acceptable
 *   - Valid v1 header sets X-Api-Version: 1 response header
 *   - Valid v2 header sets X-Api-Version: 2 response header
 */

import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
    migrateV1ToInternal,
    migrateV2ToInternal,
    parseAcceptVersion,
    withVersionMigration,
} from '@/lib/api/version-migration.middleware';
import { DEFAULT_API_VERSION } from '@/lib/api/version-negotiation';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, acceptVersion?: string): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (acceptVersion !== undefined) {
        headers['accept-version'] = acceptVersion;
    }
    return new NextRequest('http://localhost/api/deployments', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
}

// ── migrateV1ToInternal ───────────────────────────────────────────────────────

describe('migrateV1ToInternal', () => {
    it('maps repositoryName to repository.name', () => {
        const result = migrateV1ToInternal({ repositoryName: 'my-repo', foo: 'bar' });
        expect(result).toEqual({ repository: { name: 'my-repo' }, foo: 'bar' });
    });

    it('passes through body without repositoryName unchanged', () => {
        const body = { repository: { name: 'already-v2' }, foo: 'bar' };
        expect(migrateV1ToInternal(body)).toEqual(body);
    });

    it('returns non-object input as-is', () => {
        expect(migrateV1ToInternal(null)).toBe(null);
        expect(migrateV1ToInternal('string')).toBe('string');
    });
});

// ── migrateV2ToInternal ───────────────────────────────────────────────────────

describe('migrateV2ToInternal', () => {
    it('returns body unchanged', () => {
        const body = { repository: { name: 'my-repo' } };
        expect(migrateV2ToInternal(body)).toBe(body);
    });
});

// ── parseAcceptVersion ────────────────────────────────────────────────────────

describe('parseAcceptVersion', () => {
    it('parses v1 header', () => {
        expect(parseAcceptVersion('application/vnd.craft.v1+json')).toBe(1);
    });

    it('parses v2 header', () => {
        expect(parseAcceptVersion('application/vnd.craft.v2+json')).toBe(2);
    });

    it('returns null for unknown version', () => {
        expect(parseAcceptVersion('application/vnd.craft.v99+json')).toBe(null);
    });

    it('returns null for null input', () => {
        expect(parseAcceptVersion(null)).toBe(null);
    });

    it('returns null for unrecognised format', () => {
        expect(parseAcceptVersion('application/json')).toBe(null);
    });
});

// ── withVersionMigration ──────────────────────────────────────────────────────

describe('withVersionMigration', () => {
    it('migrates v1 repositoryName to repository.name', async () => {
        let captured: unknown;
        const handler = vi.fn().mockImplementation((req: NextRequest) => {
            captured = (req as any).migratedBody;
            return NextResponse.json({ ok: true });
        });

        const wrapped = withVersionMigration(handler);
        await wrapped(
            makeRequest({ repositoryName: 'my-repo' }, 'application/vnd.craft.v1+json')
        );

        expect(captured).toEqual({ repository: { name: 'my-repo' } });
    });

    it('passes v2 body through unchanged', async () => {
        let captured: unknown;
        const handler = vi.fn().mockImplementation((req: NextRequest) => {
            captured = (req as any).migratedBody;
            return NextResponse.json({ ok: true });
        });

        const body = { repository: { name: 'my-repo' } };
        const wrapped = withVersionMigration(handler);
        await wrapped(makeRequest(body, 'application/vnd.craft.v2+json'));

        expect(captured).toEqual(body);
    });

    it('defaults to v2 when Accept-Version is absent and adds deprecation header', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withVersionMigration(handler);
        const res = await wrapped(makeRequest({ repository: { name: 'r' } }));

        expect(res.status).toBe(200);
        expect(res.headers.get('x-api-version')).toBe(String(DEFAULT_API_VERSION));
        expect(res.headers.get('x-api-deprecation-warning')).toMatch(/Accept-Version/);
    });

    it('returns 406 for an unknown version', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withVersionMigration(handler);
        const res = await wrapped(
            makeRequest({}, 'application/vnd.craft.v99+json')
        );

        expect(res.status).toBe(406);
        expect(handler).not.toHaveBeenCalled();
    });

    it('sets X-Api-Version: 1 for v1 requests', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withVersionMigration(handler);
        const res = await wrapped(
            makeRequest({ repositoryName: 'r' }, 'application/vnd.craft.v1+json')
        );
        expect(res.headers.get('x-api-version')).toBe('1');
    });

    it('sets X-Api-Version: 2 for v2 requests', async () => {
        const handler = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
        const wrapped = withVersionMigration(handler);
        const res = await wrapped(
            makeRequest({ repository: { name: 'r' } }, 'application/vnd.craft.v2+json')
        );
        expect(res.headers.get('x-api-version')).toBe('2');
        // No deprecation warning for explicit header
        expect(res.headers.get('x-api-deprecation-warning')).toBeNull();
    });
});
