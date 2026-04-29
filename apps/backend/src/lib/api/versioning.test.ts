import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { ApiVersionRouter } from '@/lib/api/versioning';

describe('ApiVersionRouter', () => {
  it('throws if no supported versions are provided', () => {
    expect(
      () => new ApiVersionRouter({ supportedVersions: [], currentVersion: 'v1' }),
    ).toThrow('At least one supported version is required');
  });

  it('throws if currentVersion is not in supportedVersions', () => {
    expect(
      () => new ApiVersionRouter({ supportedVersions: ['v1'], currentVersion: 'v2' }),
    ).toThrow('currentVersion must be in supportedVersions');
  });

  it('returns supported versions from config', () => {
    const router = new ApiVersionRouter({ supportedVersions: ['v1'], currentVersion: 'v1' });
    expect(router.getSupportedVersions()).toEqual(['v1']);
  });

  it('returns current version from config', () => {
    const router = new ApiVersionRouter({ supportedVersions: ['v1'], currentVersion: 'v1' });
    expect(router.getCurrentVersion()).toBe('v1');
  });

  describe('version resolution', () => {
    const router = new ApiVersionRouter({
      supportedVersions: ['v1'],
      currentVersion: 'v1',
    });

    router.register('GET', {
      supportedVersions: ['v1'],
      handler: async () => NextResponse.json({ ok: true }),
    });

    it('defaults to current version when API-Version header is absent', async () => {
      const req = new NextRequest('http://localhost/api/test', { method: 'GET' });
      const res = await router.handle(req, 'GET', {});
      expect(res.status).toBe(200);
      expect(res.headers.get('X-API-Version')).toBe('v1');
    });

    it('uses the API-Version header when present and valid', async () => {
      const req = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: { 'API-Version': 'v1' },
      });
      const res = await router.handle(req, 'GET', {});
      expect(res.status).toBe(200);
      expect(res.headers.get('X-API-Version')).toBe('v1');
    });

    it('returns 400 with supportedVersions list for unknown version', async () => {
      const req = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: { 'API-Version': 'v99' },
      });
      const res = await router.handle(req, 'GET', {});
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/Unsupported API version: v99/);
      expect(body.supportedVersions).toEqual(['v1']);
    });
  });

  describe('deprecation headers', () => {
    it('does not set Deprecation header when on current version', async () => {
      const router = new ApiVersionRouter({
        supportedVersions: ['v1'],
        currentVersion: 'v1',
      });
      router.register('GET', {
        supportedVersions: ['v1'],
        handler: async () => NextResponse.json({ ok: true }),
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: { 'API-Version': 'v1' },
      });
      const res = await router.handle(req, 'GET', {});
      expect(res.headers.get('Deprecation')).toBeNull();
    });

    it('sets Deprecation header when on non-current version', async () => {
      const router = new ApiVersionRouter({
        supportedVersions: ['v1', 'v2'],
        currentVersion: 'v2',
      });
      router.register('GET', {
        supportedVersions: ['v1'],
        handler: async () => NextResponse.json({ ok: true }),
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: { 'API-Version': 'v1' },
      });
      const res = await router.handle(req, 'GET', {});
      expect(res.headers.get('Deprecation')).toBe('true');
      expect(res.headers.get('X-API-Upgrade-Available')).toBe('v2');
    });

    it('sets Deprecation and Sunset headers for deprecated handlers', async () => {
      const router = new ApiVersionRouter({
        supportedVersions: ['v1', 'v2'],
        currentVersion: 'v2',
      });
      router.register('GET', {
        supportedVersions: ['v1'],
        deprecated: true,
        deprecatedSince: 'v2',
        replacedBy: '/api/v2/test',
        handler: async () => NextResponse.json({ ok: true }),
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: { 'API-Version': 'v1' },
      });
      const res = await router.handle(req, 'GET', {});
      expect(res.headers.get('Deprecation')).toBe('true');
      expect(res.headers.get('Sunset')).toBe('v2');
    });
  });

  describe('handler dispatch', () => {
    it('returns 404 when no handler matches the method+version', async () => {
      const router = new ApiVersionRouter({
        supportedVersions: ['v1', 'v2'],
        currentVersion: 'v2',
      });
      router.register('GET', {
        supportedVersions: ['v2'],
        handler: async () => NextResponse.json({ ok: true }),
      });

      const req = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: { 'API-Version': 'v1' },
      });
      const res = await router.handle(req, 'GET', {});
      expect(res.status).toBe(404);
    });

    it('dispatches to the correct handler based on version', async () => {
      const router = new ApiVersionRouter({
        supportedVersions: ['v1', 'v2'],
        currentVersion: 'v2',
      });
      router.register('GET', {
        supportedVersions: ['v1'],
        handler: async () => NextResponse.json({ version: 'v1' }),
      });
      router.register('GET', {
        supportedVersions: ['v2'],
        handler: async () => NextResponse.json({ version: 'v2' }),
      });

      const v1Req = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: { 'API-Version': 'v1' },
      });
      const v1Res = await router.handle(v1Req, 'GET', {});
      const v1Body = await v1Res.json();
      expect(v1Body.version).toBe('v1');

      const v2Req = new NextRequest('http://localhost/api/test', {
        method: 'GET',
        headers: { 'API-Version': 'v2' },
      });
      const v2Res = await router.handle(v2Req, 'GET', {});
      const v2Body = await v2Res.json();
      expect(v2Body.version).toBe('v2');
    });

    it('passes context to the handler', async () => {
      const router = new ApiVersionRouter({
        supportedVersions: ['v1'],
        currentVersion: 'v1',
      });
      let receivedCtx: any;
      router.register('GET', {
        supportedVersions: ['v1'],
        handler: async (_req: any, ctx: any) => {
          receivedCtx = ctx;
          return NextResponse.json({ ok: true });
        },
      });

      const req = new NextRequest('http://localhost/api/test', { method: 'GET' });
      await router.handle(req, 'GET', { userId: 'test-user' });
      expect(receivedCtx.userId).toBe('test-user');
    });
  });

  describe('response headers', () => {
    it('always sets X-API-Version and X-Latest-Version', async () => {
      const router = new ApiVersionRouter({
        supportedVersions: ['v1'],
        currentVersion: 'v1',
      });
      router.register('GET', {
        supportedVersions: ['v1'],
        handler: async () => NextResponse.json({ ok: true }),
      });

      const req = new NextRequest('http://localhost/api/test', { method: 'GET' });
      const res = await router.handle(req, 'GET', {});
      expect(res.headers.get('X-API-Version')).toBe('v1');
      expect(res.headers.get('X-Latest-Version')).toBe('v1');
    });
  });
});
