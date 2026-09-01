/**
 * API version negotiation and deprecation header management.
 *
 * Supports version specification via:
 * - URL path: /api/v2/...
 * - Accept header: Accept: application/vnd.craft.v2+json
 * - Query parameter: ?api-version=2
 */

export const SUPPORTED_VERSIONS = [1, 2] as const;
export type APIVersion = typeof SUPPORTED_VERSIONS[number];

/** Unversioned requests use v2, the current internal API representation. */
export const DEFAULT_API_VERSION: APIVersion = 2;
/** @deprecated Use DEFAULT_API_VERSION for new callers. */
export const CURRENT_API_VERSION = DEFAULT_API_VERSION;

interface VersionInfo {
    version: APIVersion;
    isDeprecated: boolean;
    sunsetDate?: string;
    alternative?: string;
}

const VERSION_METADATA: Record<APIVersion, VersionInfo> = {
    1: {
        version: 1,
        isDeprecated: false,
    },
    2: {
        version: 2,
        isDeprecated: false,
    },
};

export interface ParsedVersion {
    version: APIVersion;
    source: 'path' | 'header' | 'query' | 'default';
}

export interface VersionHeaders {
    'api-version': string;
    'deprecation'?: string;
    'sunset'?: string;
    'link'?: string;
}

/**
 * Parse API version from URL path (e.g., /api/v2/...)
 */
export function parseVersionFromPath(pathname: string): APIVersion | null {
    const match = pathname.match(/^\/api\/v(\d+)\//);
    if (match) {
        const version = parseInt(match[1], 10) as APIVersion;
        if (SUPPORTED_VERSIONS.includes(version)) {
            return version;
        }
    }
    return null;
}

/**
 * Parse API version from Accept header
 * Expects: Accept: application/vnd.craft.v2+json
 */
export function parseVersionFromHeader(acceptHeader: string): APIVersion | null {
    const match = acceptHeader.match(/application\/vnd\.craft\.v(\d+)\+json/);
    if (match) {
        const version = parseInt(match[1], 10) as APIVersion;
        if (SUPPORTED_VERSIONS.includes(version)) {
            return version;
        }
    }
    return null;
}

/**
 * Parse API version from query parameter
 * Expects: ?api-version=2
 */
export function parseVersionFromQuery(queryParam: string): APIVersion | null {
    if (!/^\d+$/.test(queryParam)) {
        return null;
    }
    const version = parseInt(queryParam, 10) as APIVersion;
    if (SUPPORTED_VERSIONS.includes(version)) {
        return version;
    }
    return null;
}

/**
 * Negotiate API version from request headers and URL.
 * Priority order: path > header > query > default
 */
export function negotiateVersion(
    pathname: string,
    acceptHeader?: string,
    queryVersion?: string,
): ParsedVersion {
    // Try path-based versioning first (highest priority)
    const pathVersion = parseVersionFromPath(pathname);
    if (pathVersion !== null) {
        return { version: pathVersion, source: 'path' };
    }

    // Try header-based versioning
    if (acceptHeader) {
        const headerVersion = parseVersionFromHeader(acceptHeader);
        if (headerVersion !== null) {
            return { version: headerVersion, source: 'header' };
        }
    }

    // Try query-based versioning
    if (queryVersion) {
        const qVersion = parseVersionFromQuery(queryVersion);
        if (qVersion !== null) {
            return { version: qVersion, source: 'query' };
        }
    }

    return { version: DEFAULT_API_VERSION, source: 'default' };
}

/**
 * Generate deprecation and sunset headers for deprecated API versions
 */
export function getDeprecationHeaders(version: APIVersion): Partial<VersionHeaders> {
    const metadata = VERSION_METADATA[version];

    if (!metadata.isDeprecated) {
        return { 'api-version': String(version) };
    }

    const headers: VersionHeaders = {
        'api-version': String(version),
        'deprecation': 'true',
    };

    if (metadata.sunsetDate) {
        headers.sunset = new Date(metadata.sunsetDate).toUTCString();
    }

    if (metadata.alternative) {
        headers.link = `<${metadata.alternative}>; rel="successor-version"`;
    }

    return headers;
}

/**
 * Validate that the requested version is supported
 */
export function isVersionSupported(version: APIVersion): boolean {
    return SUPPORTED_VERSIONS.includes(version);
}

/**
 * Get information about a specific API version
 */
export function getVersionInfo(version: APIVersion): VersionInfo | null {
    return VERSION_METADATA[version] || null;
}

/**
 * Get all supported versions
 */
export function getSupportedVersions(): APIVersion[] {
    return Array.from(SUPPORTED_VERSIONS);
}
