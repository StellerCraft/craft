import { describe, it, expect } from 'vitest';
import {
    negotiateVersion,
    DEFAULT_API_VERSION,
    parseVersionFromPath,
    parseVersionFromHeader,
    parseVersionFromQuery,
    getDeprecationHeaders,
    isVersionSupported,
    getSupportedVersions,
} from './version-negotiation';

describe('version-negotiation', () => {
    describe('parseVersionFromPath', () => {
        it('should parse version from path', () => {
            expect(parseVersionFromPath('/api/v1/users')).toBe(1);
            expect(parseVersionFromPath('/api/v2/users')).toBe(2);
        });

        it('should return null for unsupported versions', () => {
            expect(parseVersionFromPath('/api/v3/users')).toBeNull();
            expect(parseVersionFromPath('/api/v999/users')).toBeNull();
        });

        it('should return null for paths without version', () => {
            expect(parseVersionFromPath('/api/users')).toBeNull();
            expect(parseVersionFromPath('/users')).toBeNull();
        });
    });

    describe('parseVersionFromHeader', () => {
        it('should parse version from Accept header', () => {
            expect(parseVersionFromHeader('application/vnd.craft.v1+json')).toBe(1);
            expect(parseVersionFromHeader('application/vnd.craft.v2+json')).toBe(2);
        });

        it('should handle headers with multiple media types', () => {
            const header = 'text/html, application/vnd.craft.v2+json';
            expect(parseVersionFromHeader(header)).toBe(2);
        });

        it('should return null for unsupported versions', () => {
            expect(parseVersionFromHeader('application/vnd.craft.v3+json')).toBeNull();
        });

        it('should return null for invalid format', () => {
            expect(parseVersionFromHeader('application/json')).toBeNull();
        });
    });

    describe('parseVersionFromQuery', () => {
        it('should parse version from query parameter', () => {
            expect(parseVersionFromQuery('1')).toBe(1);
            expect(parseVersionFromQuery('2')).toBe(2);
        });

        it('should return null for unsupported versions', () => {
            expect(parseVersionFromQuery('3')).toBeNull();
            expect(parseVersionFromQuery('999')).toBeNull();
        });

        it('should return null for invalid format', () => {
            expect(parseVersionFromQuery('invalid')).toBeNull();
            expect(parseVersionFromQuery('1.5')).toBeNull();
        });
    });

    describe('negotiateVersion', () => {
        it('should prioritize path versioning', () => {
            const result = negotiateVersion(
                '/api/v2/users',
                'application/vnd.craft.v1+json',
                '1',
            );
            expect(result.version).toBe(2);
            expect(result.source).toBe('path');
        });

        it('should use header versioning when path version is not available', () => {
            const result = negotiateVersion('/api/users', 'application/vnd.craft.v2+json', '1');
            expect(result.version).toBe(2);
            expect(result.source).toBe('header');
        });

        it('should use query versioning when path and header are not available', () => {
            const result = negotiateVersion('/api/users', undefined, '2');
            expect(result.version).toBe(2);
            expect(result.source).toBe('query');
        });

        it('should default to the shared default version', () => {
            const result = negotiateVersion('/api/users');
            expect(result.version).toBe(DEFAULT_API_VERSION);
            expect(result.source).toBe('default');
        });

        it('should ignore invalid versions and use next priority', () => {
            const result = negotiateVersion(
                '/api/users',
                'application/vnd.craft.v999+json',
                '2',
            );
            expect(result.version).toBe(2);
            expect(result.source).toBe('query');
        });
    });

    describe('getDeprecationHeaders', () => {
        it('should return version header for non-deprecated version', () => {
            const headers = getDeprecationHeaders(1);
            expect(headers['api-version']).toBe('1');
            expect(headers.deprecation).toBeUndefined();
        });

        it('should include api-version header for all versions', () => {
            expect(getDeprecationHeaders(1)['api-version']).toBe('1');
            expect(getDeprecationHeaders(2)['api-version']).toBe('2');
        });
    });

    describe('isVersionSupported', () => {
        it('should return true for supported versions', () => {
            expect(isVersionSupported(1)).toBe(true);
            expect(isVersionSupported(2)).toBe(true);
        });

        it('should return false for unsupported versions', () => {
            expect(isVersionSupported(3 as any)).toBe(false);
            expect(isVersionSupported(999 as any)).toBe(false);
        });
    });

    describe('getSupportedVersions', () => {
        it('should return array of supported versions', () => {
            const versions = getSupportedVersions();
            expect(versions).toContain(1);
            expect(versions).toContain(2);
        });

        it('should return sorted array', () => {
            const versions = getSupportedVersions();
            expect(versions[0]).toBeLessThanOrEqual(versions[1]);
        });
    });
});
