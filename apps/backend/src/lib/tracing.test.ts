import { describe, it, expect } from 'vitest';
import {
    startTrace,
    newSpan,
    parseTraceparent,
    withSpan,
    TRACEPARENT_HEADER,
    type TraceContext,
} from './tracing';

describe('startTrace', () => {
    it('generates a new root trace context with valid IDs', () => {
        const ctx = startTrace();

        expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(ctx.traceparent).toBe(`00-${ctx.traceId}-${ctx.spanId}-01`);
    });

    it('generates a unique traceId on each call', () => {
        const ctx1 = startTrace();
        const ctx2 = startTrace();

        expect(ctx1.traceId).not.toBe(ctx2.traceId);
    });

    it('generates a unique spanId on each call', () => {
        const ctx1 = startTrace();
        const ctx2 = startTrace();

        expect(ctx1.spanId).not.toBe(ctx2.spanId);
    });
});

describe('newSpan', () => {
    it('creates a child span within an existing trace', () => {
        const traceId = 'a'.repeat(32);
        const ctx = newSpan(traceId);

        expect(ctx.traceId).toBe(traceId);
        expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(ctx.traceparent).toBe(`00-${traceId}-${ctx.spanId}-01`);
    });

    it('preserves the traceId from parent context', () => {
        const traceId = 'b'.repeat(32);
        const root = newSpan(traceId);
        const child = newSpan(root.traceId);

        expect(child.traceId).toBe(traceId);
    });

    it('generates a unique spanId for each child', () => {
        const traceId = 'c'.repeat(32);
        const span1 = newSpan(traceId);
        const span2 = newSpan(traceId);

        expect(span1.spanId).not.toBe(span2.spanId);
    });
});

describe('parseTraceparent', () => {
    it('parses a valid traceparent header', () => {
        const header = '00-12345678901234567890123456789012-1234567890123456-01';
        const ctx = parseTraceparent(header);

        expect(ctx).not.toBeNull();
        expect(ctx?.traceId).toBe('12345678901234567890123456789012');
        expect(ctx?.spanId).toBe('1234567890123456');
        expect(ctx?.traceparent).toBe(header);
    });

    it('returns null for null header', () => {
        expect(parseTraceparent(null)).toBeNull();
    });

    it('returns null for undefined header', () => {
        expect(parseTraceparent(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseTraceparent('')).toBeNull();
    });

    it('returns null for malformed header (wrong version)', () => {
        const header = '01-12345678901234567890123456789012-1234567890123456-01';
        expect(parseTraceparent(header)).toBeNull();
    });

    it('returns null for malformed header (too few parts)', () => {
        const header = '00-12345678901234567890123456789012-01';
        expect(parseTraceparent(header)).toBeNull();
    });

    it('returns null for invalid traceId length', () => {
        const header = '00-1234567890-1234567890123456-01';
        expect(parseTraceparent(header)).toBeNull();
    });

    it('returns null for invalid spanId length', () => {
        const header = '00-12345678901234567890123456789012-1234-01';
        expect(parseTraceparent(header)).toBeNull();
    });

    it('returns null for non-hex characters in traceId', () => {
        const header = '00-zzzz5678901234567890123456789012-1234567890123456-01';
        expect(parseTraceparent(header)).toBeNull();
    });
});

describe('withSpan', () => {
    it('wraps an async function and returns result with span info', async () => {
        const traceId = 'a'.repeat(32);
        const result = await withSpan('test-span', traceId, async () => 'hello');

        expect(result.result).toBe('hello');
        expect(result.traceId).toBe(traceId);
        expect(result.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(result.span.name).toBe('test-span');
        expect(result.span.status).toBe('ok');
    });

    it('records attributes on the span', async () => {
        const traceId = 'b'.repeat(32);
        const result = await withSpan(
            'test-span',
            traceId,
            async () => 'ok',
            { deploymentId: 'dep-123', userId: 'user-456' },
        );

        expect(result.span.attributes.deploymentId).toBe('dep-123');
        expect(result.span.attributes.userId).toBe('user-456');
    });

    it('propagates traceId to the span', async () => {
        const traceId = 'c'.repeat(32);
        const result = await withSpan('test-span', traceId, async (ctx: TraceContext) => {
            expect(ctx.traceId).toBe(traceId);
            return 'done';
        });

        expect(result.span.traceId).toBe(traceId);
    });

    it('records error span and re-throws on failure', async () => {
        const traceId = 'd'.repeat(32);
        const error = new Error('test error');

        await expect(
            withSpan('failing-span', traceId, async () => {
                throw error;
            }),
        ).rejects.toThrow('test error');
    });

    it('records exception event attributes on error', async () => {
        const traceId = 'e'.repeat(32);
        const error = new TypeError('bad type');

        try {
            await withSpan('error-span', traceId, async () => {
                throw error;
            });
        } catch (e: any) {
            const span = e.__span;
            expect(span).toBeDefined();
            expect(span.status).toBe('error');
            expect(span.events).toHaveLength(1);
            expect(span.events[0].name).toBe('exception');
            expect(span.events[0].attributes['exception.type']).toBe('TypeError');
            expect(span.events[0].attributes['exception.message']).toBe('bad type');
        }
    });

    it('generates a fresh spanId for each invocation (correlation-ID propagation)', async () => {
        const traceId = 'f'.repeat(32);
        const result1 = await withSpan('span-a', traceId, async () => 'a');
        const result2 = await withSpan('span-b', traceId, async () => 'b');

        expect(result1.spanId).not.toBe(result2.spanId);
    });

    it('does not throw when no incoming correlation ID is present (generates fresh)', async () => {
        const result = await withSpan(
            'root-span',
            startTrace().traceId,
            async () => 'success',
        );

        expect(result.result).toBe('success');
        expect(result.span.status).toBe('ok');
    });
});

describe('TRACEPARENT_HEADER', () => {
    it('is "traceparent"', () => {
        expect(TRACEPARENT_HEADER).toBe('traceparent');
    });
});
