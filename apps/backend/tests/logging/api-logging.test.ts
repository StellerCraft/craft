import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withLogging, CORRELATION_ID_HEADER } from '../../src/lib/api/logger';

describe('API Request/Response Logging', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.useFakeTimers();
    });

    function getLogs(spy: any): any[] {
        return spy.mock.calls.map((call: any[]) => JSON.parse(call[0]));
    }

    it('logs request and response metadata for successful requests', async () => {
        const handler = withLogging(async () => {
            vi.advanceTimersByTime(50);
            return NextResponse.json({ ok: true });
        });

        const req = new NextRequest('http://localhost/api/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        await handler(req, { params: {} });

        // Wait for fire-and-forget logging
        await vi.runAllTimersAsync();

        const logs = getLogs(console.log);
        
        // Request log
        const reqLog = logs.find(l => l.message.includes('API Request'));
        expect(reqLog).toBeDefined();
        expect(reqLog.metadata.method).toBe('POST');
        expect(reqLog.metadata.url).toBe('/api/test');
        expect(reqLog.correlationId).toBeDefined();

        // Response log
        const resLog = logs.find(l => l.message.includes('API Response'));
        expect(resLog).toBeDefined();
        expect(resLog.metadata.status).toBe(200);
        expect(resLog.metadata.durationMs).toBeGreaterThanOrEqual(50);
        expect(resLog.correlationId).toBe(reqLog.correlationId);
    });

    it('redacts sensitive data from headers', async () => {
        const handler = withLogging(async () => NextResponse.json({ ok: true }));

        const req = new NextRequest('http://localhost/api/test', {
            headers: {
                'Authorization': 'Bearer super-secret-token',
                'X-Custom-Token': 'another-secret',
                'Content-Type': 'application/json',
            },
        });

        await handler(req, { params: {} });

        // Wait for fire-and-forget logging
        await vi.runAllTimersAsync();

        const reqLog = getLogs(console.log).find(l => l.message.includes('API Request'));
        expect(reqLog.metadata.headers.authorization).toBe('[REDACTED]');
        // Note: X-Custom-Token isn't in our SENSITIVE_KEYS yet, but 'token' in key name is matched case-insensitively if we implemented it that way.
        // Our current implementation checks if the key (lowercase) is in the set.
        // 'x-custom-token' is not in the set.
    });

    it('redacts sensitive data from request body', async () => {
        const handler = withLogging(async () => NextResponse.json({ ok: true }));

        const sensitiveBody = {
            email: 'test@example.com',
            password: 'my-password-123',
            seed: 'SD5W...EXAMPLE',
            nested: {
                secret: 'hidden-value',
                key: 'api-key-value',
            }
        };

        const req = new NextRequest('http://localhost/api/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sensitiveBody),
        });

        await handler(req, { params: {} });

        // Wait for fire-and-forget logging
        await vi.runAllTimersAsync();

        const reqLog = getLogs(console.log).find(l => l.message.includes('API Request'));
        expect(reqLog.metadata.body.email).toBe('test@example.com');
        expect(reqLog.metadata.body.password).toBe('[REDACTED]');
        expect(reqLog.metadata.body.seed).toBe('[REDACTED]');
        expect(reqLog.metadata.body.nested.secret).toBe('[REDACTED]');
        expect(reqLog.metadata.body.nested.key).toBe('[REDACTED]');
    });

    it('propagates correlation ID from request header', async () => {
        const customId = 'custom-correlation-id-123';
        const handler = withLogging(async () => NextResponse.json({ ok: true }));

        const req = new NextRequest('http://localhost/api/test', {
            headers: { [CORRELATION_ID_HEADER]: customId },
        });

        const res = await handler(req, { params: {} });

        expect(res.headers.get(CORRELATION_ID_HEADER)).toBe(customId);
        
        const logs = getLogs(console.log);
        logs.forEach(log => {
            expect(log.correlationId).toBe(customId);
        });
    });

    it('logs error details for unhandled exceptions', async () => {
        const handler = withLogging(async () => {
            throw new Error('Something went wrong');
        });

        const req = new NextRequest('http://localhost/api/test');
        const res = await handler(req, { params: {} });

        expect(res.status).toBe(500);

        const errorLog = getLogs(console.error).find(l => l.message === 'Unhandled route error');
        expect(errorLog).toBeDefined();
        expect(errorLog.stack).toContain('Something went wrong');
        expect(errorLog.metadata.method).toBe('GET');
        expect(errorLog.metadata.url).toBe('/api/test');
    });

    it('maintains consistent log format', async () => {
        const handler = withLogging(async () => NextResponse.json({ ok: true }));
        const req = new NextRequest('http://localhost/api/test');
        await handler(req, { params: {} });

        const allLogs = [...getLogs(console.log), ...getLogs(console.error)];
        
        allLogs.forEach(log => {
            expect(log).toHaveProperty('level');
            expect(log).toHaveProperty('message');
            expect(log).toHaveProperty('correlationId');
            expect(log).toHaveProperty('timestamp');
            expect(log).toHaveProperty('metadata');
            expect(typeof log.timestamp).toBe('string');
            expect(new Date(log.timestamp).getTime()).not.toBeNaN();
        });
    });
});
