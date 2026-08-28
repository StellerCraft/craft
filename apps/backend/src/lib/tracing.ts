/**
 * Distributed trace instrumentation using W3C Trace Context (traceparent).
 *
 * Format: 00-<traceId>-<spanId>-<flags>
 *   - version:  "00" (W3C spec fixed value)
 *   - traceId:  32 hex chars (128-bit)
 *   - spanId:   16 hex chars (64-bit)
 *   - flags:    "01" = sampled
 *
 * Reference: https://www.w3.org/TR/trace-context/
 */

import { randomBytes } from 'crypto';

export const TRACEPARENT_HEADER = 'traceparent';
const TRACE_VERSION = '00';
const TRACE_FLAGS = '01'; // sampled

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TraceContext {
    /** 128-bit trace ID (32 hex chars). Stable across the full pipeline. */
    traceId: string;
    /** 64-bit span ID (16 hex chars). Unique per pipeline stage. */
    spanId: string;
    /** W3C traceparent header value. */
    traceparent: string;
}

export interface SpanAttributes {
    deploymentId?: string;
    templateId?: string;
    userId?: string;
    [key: string]: string | number | boolean | undefined;
}

export interface SpanEvent {
    name: string;
    timestampMs: number;
    attributes: Record<string, string>;
}

export interface SpanRecord {
    traceId: string;
    spanId: string;
    name: string;
    startTimeMs: number;
    endTimeMs: number;
    durationMs: number;
    attributes: SpanAttributes;
    events: SpanEvent[];
    status: 'ok' | 'error';
}

export interface SpanResult<T> {
    result: T;
    /** Wall-clock duration in milliseconds. */
    durationMs: number;
    traceId: string;
    spanId: string;
    span: SpanRecord;
}

// ── Core functions ────────────────────────────────────────────────────────────

/** Generate a new root trace context (call once per deployment/request). */
export function startTrace(): TraceContext {
    const traceId = randomBytes(16).toString('hex');
    return newSpan(traceId);
}

/** Create a child span within an existing trace. */
export function newSpan(traceId: string): TraceContext {
    const spanId = randomBytes(8).toString('hex');
    const traceparent = `${TRACE_VERSION}-${traceId}-${spanId}-${TRACE_FLAGS}`;
    return { traceId, spanId, traceparent };
}

/**
 * Parse a W3C traceparent header value.
 * Returns null if the header is missing or malformed.
 */
export function parseTraceparent(header: string | null | undefined): TraceContext | null {
    if (!header) return null;
    const parts = header.split('-');
    if (parts.length !== 4 || parts[0] !== TRACE_VERSION) return null;
    const [, traceId, spanId] = parts;
    if (!/^[0-9a-f]{32}$/.test(traceId) || !/^[0-9a-f]{16}$/.test(spanId)) return null;
    return { traceId, spanId, traceparent: header };
}

/**
 * Run an async operation as a named child span.
 *
 * On success the span is recorded with status "ok".
 * On error the span records an "exception" event with the error details,
 * sets status to "error", and re-throws so callers can still catch it.
 *
 * Attributes (deploymentId, templateId, userId, …) are attached to the span
 * and propagated through the traceparent context passed to `fn`.
 */
export async function withSpan<T>(
    name: string,
    traceId: string,
    fn: (span: TraceContext) => Promise<T>,
    attributes: SpanAttributes = {},
): Promise<SpanResult<T>> {
    const ctx = newSpan(traceId);
    const startTimeMs = Date.now();

    try {
        const result = await fn(ctx);
        const endTimeMs = Date.now();
        const span: SpanRecord = {
            traceId,
            spanId: ctx.spanId,
            name,
            startTimeMs,
            endTimeMs,
            durationMs: endTimeMs - startTimeMs,
            attributes,
            events: [],
            status: 'ok',
        };
        return { result, durationMs: span.durationMs, traceId, spanId: ctx.spanId, span };
    } catch (error: any) {
        const endTimeMs = Date.now();
        const span: SpanRecord = {
            traceId,
            spanId: ctx.spanId,
            name,
            startTimeMs,
            endTimeMs,
            durationMs: endTimeMs - startTimeMs,
            attributes,
            events: [
                {
                    name: 'exception',
                    timestampMs: endTimeMs,
                    attributes: {
                        'exception.type': error?.name ?? 'Error',
                        'exception.message': error?.message ?? 'Unknown error',
                        'exception.stacktrace': error?.stack ?? '',
                    },
                },
            ],
            status: 'error',
        };
        // Attach span to the error so callers can inspect it without re-running
        (error as any).__span = span;
        throw error;
    }
}
