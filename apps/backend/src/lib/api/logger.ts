/**
 * Structured error logger with correlation ID support.
 *
 * Correlation IDs flow through the request lifecycle so that a single
 * user-facing error can be traced across service calls, deployment logs,
 * and external API calls.
 *
 * Usage:
 *   const log = createLogger({ correlationId, userId, deploymentId });
 *   log.error('GitHub push failed', err, { stage: 'pushing_code' });
 *
 * In API routes, prefer `withLogging` which generates the correlation ID
 * automatically and attaches it to the response as `X-Correlation-Id`.
 */

import { NextRequest, NextResponse } from 'next/server';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LogContext {
    correlationId: string;
    userId?: string;
    deploymentId?: string;
    /** Any additional key/value pairs to include in every log entry. */
    [key: string]: unknown;
}

export interface LogEntry {
    level: 'info' | 'warn' | 'error';
    message: string;
    correlationId: string;
    timestamp: string;
    /** Serialised error stack, present only on error-level entries. */
    stack?: string;
    /** Caller-supplied metadata merged with the base context. */
    metadata: Record<string, unknown>;
}

export interface Logger {
    info(message: string, metadata?: Record<string, unknown>): void;
    warn(message: string, metadata?: Record<string, unknown>): void;
    error(message: string, err?: unknown, metadata?: Record<string, unknown>): void;
}

// ── Correlation ID ────────────────────────────────────────────────────────────

export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

/**
 * Returns the correlation ID from an incoming request header, or generates a
 * new one if the header is absent or malformed.
 */
export function resolveCorrelationId(req: NextRequest): string {
    const fromHeader = req.headers.get(CORRELATION_ID_HEADER);
    if (fromHeader && /^[\w\-]{8,128}$/.test(fromHeader)) {
        return fromHeader;
    }
    return crypto.randomUUID();
}

// ── Logger factory ────────────────────────────────────────────────────────────

/**
 * Creates a logger bound to a fixed context (correlation ID, user, etc.).
 * All entries are written to `console` as JSON so they are captured by
 * Vercel's log drain and any structured logging aggregator.
 */
export function createLogger(ctx: LogContext): Logger {
    function write(entry: LogEntry): void {
        const line = JSON.stringify(entry);
        if (entry.level === 'error') {
            console.error(line);
        } else if (entry.level === 'warn') {
            console.warn(line);
        } else {
            console.log(line);
        }
    }

    function buildEntry(
        level: LogEntry['level'],
        message: string,
        err?: unknown,
        extra?: Record<string, unknown>,
    ): LogEntry {
        const { correlationId, ...ctxRest } = ctx;
        const entry: LogEntry = {
            level,
            message,
            correlationId,
            timestamp: new Date().toISOString(),
            metadata: { ...ctxRest, ...extra },
        };
        if (err instanceof Error && err.stack) {
            entry.stack = err.stack;
        }
        return entry;
    }

    return {
        info(message, metadata) {
            write(buildEntry('info', message, undefined, metadata));
        },
        warn(message, metadata) {
            write(buildEntry('warn', message, undefined, metadata));
        },
        error(message, err, metadata) {
            write(buildEntry('error', message, err, metadata));
        },
    };
}

// ── Redaction ────────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
    'password',
    'token',
    'secret',
    'authorization',
    'cookie',
    'key',
    'stripe_secret',
    'access_token',
    'refresh_token',
    'seed',
    'private_key',
    'secret_key',
    'mnemonic',
    'privatekey',
    'secretkey',
    'phrase',
    'api_key',
    'apikey',
    'x-api-key',
]);

/**
 * Recursively redacts sensitive keys from an object or array.
 * Returns a new object/array, leaving the original untouched.
 */
export function redact(obj: unknown, depth = 0): unknown {
    if (depth > 10 || !obj || typeof obj !== 'object') {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map((item) => redact(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
            result[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
            result[key] = redact(value, depth + 1);
        } else {
            result[key] = value;
        }
    }
    return result;
}

// ── Route middleware ──────────────────────────────────────────────────────────

type RouteHandler<TParams = {}> = (
    req: NextRequest,
    ctx: { params: TParams; correlationId: string; log: Logger }
) => Promise<NextResponse>;

/**
 * Wraps a route handler with automatic correlation ID resolution and a
 * pre-configured logger. Automatically logs incoming requests and outgoing
 * responses, ensuring sensitive data is redacted.
 */
export function withLogging<TParams = {}>(handler: RouteHandler<TParams>) {
    return async (req: NextRequest, { params }: { params: TParams }): Promise<NextResponse> => {
        const correlationId = resolveCorrelationId(req);
        const log = createLogger({ correlationId });
        const start = Date.now();

        const method = req.method;
        const url = req.nextUrl.pathname;

        // Capture request details for logging
        const logRequest = async () => {
            const headers = Object.fromEntries(req.headers.entries());
            let body: any = undefined;

            if (req.headers.get('content-type')?.includes('application/json')) {
                try {
                    // Clone request to avoid consuming the body stream
                    const cloned = req.clone();
                    body = await cloned.json();
                } catch {
                    // Body might be empty or invalid JSON
                }
            }

            log.info(`API Request: ${method} ${url}`, {
                method,
                url,
                headers: redact(headers),
                body: redact(body),
            });
        };

        // Fire-and-forget logging to avoid blocking the main request path
        logRequest().catch((err) => log.error('Logging failed', err));

        try {
            const response = await handler(req, { params, correlationId, log });
            const duration = Date.now() - start;

            response.headers.set(CORRELATION_ID_HEADER, correlationId);

            log.info(`API Response: ${method} ${url} ${response.status}`, {
                method,
                url,
                status: response.status,
                durationMs: duration,
            });

            return response;
        } catch (err: unknown) {
            const duration = Date.now() - start;
            log.error('Unhandled route error', err, {
                method,
                url,
                durationMs: duration,
            });

            const response = NextResponse.json(
                { error: 'Internal server error', correlationId },
                { status: 500 }
            );
            response.headers.set(CORRELATION_ID_HEADER, correlationId);
            return response;
        }
    };
}
