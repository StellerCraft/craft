/**
 * API Version Migration Middleware
 *
 * Negotiates API version via the Accept-Version header
 * (e.g. application/vnd.craft.v1+json) and applies backward-compatible
 * schema migrations so all route handlers receive the current internal format.
 *
 * Supported versions: v1, v2 (internal)
 *
 * Schema migration:
 *   v1 → internal: repositoryName (string) → repository.name (nested object)
 *   v2 → internal: identity (v2 IS the internal format)
 *
 * Behaviour:
 *   - Unknown version → 406 Not Acceptable
 *   - Missing header  → defaults to v2 (latest), adds deprecation warning header
 *   - Valid version   → migrates body, attaches (req as any).migratedBody, adds X-Api-Version header
 *
 * Issue: #760
 */

import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_API_VERSION } from './version-negotiation';

// ── Version constants ─────────────────────────────────────────────────────────

export const SUPPORTED_VERSIONS = [1, 2] as const;
export type MigrationVersion = typeof SUPPORTED_VERSIONS[number];

// ── Schema transforms ─────────────────────────────────────────────────────────

/**
 * Migrates a v1 DeploymentRequest body to the internal (v2) format.
 * v1 uses a flat `repositoryName` string; v2 nests it under `repository.name`.
 */
export function migrateV1ToInternal(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    const b = body as Record<string, unknown>;
    const { repositoryName, ...rest } = b;
    if (repositoryName !== undefined) {
        return { ...rest, repository: { name: repositoryName } };
    }
    return body;
}

/**
 * v2 is the internal format — identity transform.
 */
export function migrateV2ToInternal(body: unknown): unknown {
    return body;
}

const MIGRATIONS: Record<MigrationVersion, (body: unknown) => unknown> = {
    1: migrateV1ToInternal,
    2: migrateV2ToInternal,
};

// ── Version parsing ───────────────────────────────────────────────────────────

/**
 * Parses the numeric version from an Accept-Version header value.
 * Expects the format: application/vnd.craft.vN+json
 * Returns null if the header is absent or unparseable.
 */
export function parseAcceptVersion(header: string | null): MigrationVersion | null {
    if (!header) return null;
    const match = header.match(/application\/vnd\.craft\.v(\d+)\+json/);
    if (!match) return null;
    const v = parseInt(match[1], 10) as MigrationVersion;
    return (SUPPORTED_VERSIONS as readonly number[]).includes(v) ? v : null;
}

// ── Middleware ────────────────────────────────────────────────────────────────

type RouteHandler = (req: NextRequest, ctx?: any) => Promise<NextResponse>;

/**
 * Wraps a route handler with Accept-Version negotiation and body migration.
 *
 * The migrated body is attached to the request as `(req as any).migratedBody`
 * so handlers can read it without re-parsing the (already-consumed) body.
 */
export function withVersionMigration(handler: RouteHandler): RouteHandler {
    return async (req: NextRequest, ctx?: any): Promise<NextResponse> => {
        const acceptVersion = req.headers.get('accept-version');
        let version: MigrationVersion;
        let defaulted = false;

        if (acceptVersion === null) {
            version = DEFAULT_API_VERSION;
            defaulted = true;
        } else {
            const parsed = parseAcceptVersion(acceptVersion);
            if (parsed === null) {
                return NextResponse.json(
                    {
                        error: `Unsupported API version: ${acceptVersion}. Supported versions: ${SUPPORTED_VERSIONS.map((v) => `application/vnd.craft.v${v}+json`).join(', ')}`,
                    },
                    { status: 406 }
                );
            }
            version = parsed;
        }

        // Parse and migrate body (best-effort; handlers that don't need a body
        // will simply see migratedBody = undefined).
        let migratedBody: unknown;
        try {
            const raw = await req.json();
            migratedBody = MIGRATIONS[version](raw);
        } catch {
            migratedBody = undefined;
        }

        // Attach migrated body to request for downstream handlers
        (req as any).migratedBody = migratedBody;

        const response = await handler(req, ctx);

        // Stamp version onto response
        response.headers.set('x-api-version', String(version));

        if (defaulted) {
            response.headers.set(
                'x-api-deprecation-warning',
                'Specify Accept-Version header; defaulting to v2'
            );
        }

        return response;
    };
}
