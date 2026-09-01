import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SecurityHeader } from './security-headers';

// isDev/cspValue are computed once at module load time from NODE_ENV, so each
// test that needs a specific environment resets the module registry and
// re-imports it under that environment.
async function loadHeaders(nodeEnv: string): Promise<SecurityHeader[]> {
    vi.resetModules();
    process.env.NODE_ENV = nodeEnv;
    const mod = await import('./security-headers');
    return mod.getSecurityHeaders();
}

describe('getSecurityHeaders', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        vi.resetModules();
    });

    it('uses Content-Security-Policy-Report-Only in development', async () => {
        const headers = await loadHeaders('development');
        const csp = headers.find((h) => h.key.startsWith('Content-Security-Policy'));

        expect(csp?.key).toBe('Content-Security-Policy-Report-Only');
    });

    it('uses an enforced Content-Security-Policy in production', async () => {
        const headers = await loadHeaders('production');
        const csp = headers.find((h) => h.key.startsWith('Content-Security-Policy'));

        expect(csp?.key).toBe('Content-Security-Policy');
    });

    it('treats any non-production NODE_ENV as development for CSP purposes', async () => {
        const headers = await loadHeaders('test');
        const csp = headers.find((h) => h.key.startsWith('Content-Security-Policy'));

        expect(csp?.key).toBe('Content-Security-Policy-Report-Only');
    });

    it('returns exactly the documented set of headers, in order', async () => {
        const headers = await loadHeaders('production');
        const keys = headers.map((h) => h.key);

        expect(keys).toEqual([
            'Content-Security-Policy',
            'Strict-Transport-Security',
            'X-Content-Type-Options',
            'X-Frame-Options',
            'Referrer-Policy',
            'Permissions-Policy',
        ]);
    });

    it('sets the exact values for the static (non-CSP) headers', async () => {
        const headers = await loadHeaders('production');
        const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]));

        expect(byKey['Strict-Transport-Security']).toBe(
            'max-age=63072000; includeSubDomains; preload'
        );
        expect(byKey['X-Content-Type-Options']).toBe('nosniff');
        expect(byKey['X-Frame-Options']).toBe('DENY');
        expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
        expect(byKey['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()');
    });

    it('builds a CSP value containing every configured directive', async () => {
        const headers = await loadHeaders('production');
        const csp = headers.find((h) => h.key === 'Content-Security-Policy')!.value;

        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
        expect(csp).toContain("img-src 'self' data: https:");
        expect(csp).toContain("font-src 'self'");
        expect(csp).toContain(
            "connect-src 'self' https://*.supabase.co https://api.stripe.com https://api.vercel.com https://horizon-testnet.stellar.org https://horizon.stellar.org"
        );
        expect(csp).toContain("frame-src 'none'");
        expect(csp).toContain("object-src 'none'");
        expect(csp).toContain("base-uri 'self'");
        expect(csp).toContain("form-action 'self'");
        expect(csp).toContain('upgrade-insecure-requests');
    });

    it('produces the same CSP value regardless of dev/prod mode', async () => {
        const devCsp = (await loadHeaders('development')).find((h) =>
            h.key.startsWith('Content-Security-Policy')
        )!.value;
        const prodCsp = (await loadHeaders('production')).find((h) => h.key === 'Content-Security-Policy')!
            .value;

        expect(devCsp).toBe(prodCsp);
    });
});
