/**
 * API Versioning Router
 *
 * Provides version negotiation for CRAFT API endpoints via the `API-Version`
 * request header.  The router validates the requested version against the
 * supported set, dispatches to the correct handler, and stamps response
 * headers (`X-API-Version`, `X-Latest-Version`, `Deprecation`,
 * `X-API-Upgrade-Available`).
 *
 * Usage:
 *   const router = new ApiVersionRouter({
 *     supportedVersions: ['v1'],
 *     currentVersion: 'v1',
 *   });
 *
 *   router.register('GET', {
 *     supportedVersions: ['v1'],
 *     handler: async (req, ctx) => NextResponse.json({ ... }),
 *   });
 *
 *   // In the route file:
 *   export const GET = withAuth(async (req, ctx) => router.handle(req, 'GET', ctx));
 */

import { NextRequest, NextResponse } from 'next/server';

// ── Types ────────────────────────────────────────────────────────────────────

export type ApiVersion = string;

export interface VersionedHandler {
  /** Versions this handler can serve. */
  supportedVersions: ApiVersion[];
  /** Whether this versioned endpoint is deprecated. */
  deprecated?: boolean;
  /** Version in which the endpoint was deprecated. */
  deprecatedSince?: ApiVersion;
  /** Replacement endpoint path, included in deprecation warnings. */
  replacedBy?: string;
  /** The actual route handler. */
  handler: (req: NextRequest, ctx: any) => Promise<NextResponse>;
}

export interface ApiVersionRouterConfig {
  /** All versions the API currently supports (e.g. ['v1']). */
  supportedVersions: ApiVersion[];
  /** The current / latest version — used for deprecation headers. */
  currentVersion: ApiVersion;
}

// ── Router ───────────────────────────────────────────────────────────────────

export class ApiVersionRouter {
  private handlers: Map<string, VersionedHandler[]> = new Map();
  private config: ApiVersionRouterConfig;

  constructor(config: ApiVersionRouterConfig) {
    if (!config.supportedVersions.length) {
      throw new Error('At least one supported version is required');
    }
    if (!config.supportedVersions.includes(config.currentVersion)) {
      throw new Error('currentVersion must be in supportedVersions');
    }
    this.config = config;
  }

  /** Register a versioned handler for an HTTP method. */
  register(method: string, handler: VersionedHandler): void {
    const key = method.toUpperCase();
    if (!this.handlers.has(key)) {
      this.handlers.set(key, []);
    }
    this.handlers.get(key)!.push(handler);
  }

  /**
   * Resolve, validate, and dispatch an incoming request to the correct
   * versioned handler, then stamp versioning response headers.
   */
  async handle(req: NextRequest, method: string, ctx: any): Promise<NextResponse> {
    const { version, valid, requested } = this.resolveVersion(req);

    // Unknown version → 400 with supported-versions list
    if (!valid) {
      return NextResponse.json(
        {
          error: `Unsupported API version: ${requested}`,
          supportedVersions: this.config.supportedVersions,
        },
        { status: 400 },
      );
    }

    // Find matching handler for this method + version
    const methodHandlers = this.handlers.get(method.toUpperCase()) ?? [];
    const handler = methodHandlers.find((h) => h.supportedVersions.includes(version!));

    if (!handler) {
      return NextResponse.json(
        {
          error: `${method.toUpperCase()} not available for version ${version}`,
          supportedVersions: this.config.supportedVersions,
        },
        { status: 404 },
      );
    }

    // Execute the handler
    const response = await handler.handler(req, ctx);

    // Stamp version headers
    response.headers.set('X-API-Version', version!);
    response.headers.set('X-Latest-Version', this.config.currentVersion);

    // Deprecation header when requesting a non-current version
    if (version !== this.config.currentVersion) {
      response.headers.set('Deprecation', 'true');
      response.headers.set('X-API-Upgrade-Available', this.config.currentVersion);
    }

    // Deprecation metadata on the handler itself (e.g. v1 endpoint marked deprecated)
    if (handler.deprecated) {
      response.headers.set('Deprecation', 'true');
      if (handler.deprecatedSince) {
        response.headers.set('Sunset', handler.deprecatedSince);
      }
    }

    return response;
  }

  /** Read and validate the API-Version header. Defaults to currentVersion when absent. */
  private resolveVersion(req: NextRequest): {
    version: ApiVersion | null;
    valid: boolean;
    requested: string | null;
  } {
    const raw = req.headers.get('API-Version');
    if (!raw) {
      return { version: this.config.currentVersion, valid: true, requested: null };
    }
    if (this.config.supportedVersions.includes(raw)) {
      return { version: raw, valid: true, requested: raw };
    }
    return { version: null, valid: false, requested: raw };
  }

  getSupportedVersions(): ApiVersion[] {
    return [...this.config.supportedVersions];
  }

  getCurrentVersion(): ApiVersion {
    return this.config.currentVersion;
  }
}
