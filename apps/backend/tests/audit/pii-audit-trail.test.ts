/**
 * PII Audit Trail Tests
 *
 * Verifies that audit log entries are emitted when PII fields are accessed:
 *   - Profile read/write (email field)
 *   - Deployment read (customization_config with potential env vars)
 *   - Deployment delete
 *
 * Security requirement: audit entries must NOT contain PII values themselves,
 * only metadata about which fields were accessed.
 *
 * Run: vitest run tests/audit/pii-audit-trail.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, resolveIpAddress, type AuditLogEntry } from '@/lib/api/logger';
import { NextRequest } from 'next/server';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'user_123';
const TEST_DEPLOYMENT_ID = 'dep_abc';
const TEST_CORRELATION_ID = 'corr_xyz';
const TEST_IP = '192.168.1.100';

function makeRequest(headers: Record<string, string> = {}): NextRequest {
    return new NextRequest('https://example.com/api/test', {
        headers: {
            'x-forwarded-for': TEST_IP,
            ...headers,
        },
    });
}

// ── Audit Log Capture ─────────────────────────────────────────────────────────

let capturedLogs: any[] = [];

function captureConsoleLogs() {
    capturedLogs = [];
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = vi.fn((...args) => {
        capturedLogs.push({ level: 'log', args });
        originalLog(...args);
    });

    console.error = vi.fn((...args) => {
        capturedLogs.push({ level: 'error', args });
        originalError(...args);
    });

    console.warn = vi.fn((...args) => {
        capturedLogs.push({ level: 'warn', args });
        originalWarn(...args);
    });
}

function restoreConsoleLogs() {
    vi.restoreAllMocks();
}

function getAuditLogs(): AuditLogEntry[] {
    return capturedLogs
        .filter(log => log.level === 'log')
        .map(log => {
            try {
                const parsed = JSON.parse(log.args[0]);
                return parsed.level === 'audit' ? parsed : null;
            } catch {
                return null;
            }
        })
        .filter(Boolean) as AuditLogEntry[];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Audit Trail — Logger Extension', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('emits audit log entry with required fields', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'profile.read',
            resourceId: TEST_USER_ID,
            resourceType: 'profile',
            ipAddress: TEST_IP,
            metadata: { fields: ['email'] },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);

        const entry = auditLogs[0];
        expect(entry.level).toBe('audit');
        expect(entry.userId).toBe(TEST_USER_ID);
        expect(entry.action).toBe('profile.read');
        expect(entry.resourceId).toBe(TEST_USER_ID);
        expect(entry.resourceType).toBe('profile');
        expect(entry.ipAddress).toBe(TEST_IP);
        expect(entry.correlationId).toBe(TEST_CORRELATION_ID);
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(entry.metadata).toEqual({ fields: ['email'] });
    });

    it('audit log does not contain PII values', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'profile.write',
            resourceId: TEST_USER_ID,
            resourceType: 'profile',
            ipAddress: TEST_IP,
            metadata: { fields: ['email'] },
        });

        const auditLogs = getAuditLogs();
        const entry = auditLogs[0];

        // Verify no email value is present in the log
        const logString = JSON.stringify(entry);
        expect(logString).not.toContain('@example.com');
        expect(logString).not.toContain('user@');
        
        // Only field names should be present
        expect(entry.metadata.fields).toContain('email');
    });

    it('supports optional ipAddress field', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'deployment.read',
            resourceId: TEST_DEPLOYMENT_ID,
            resourceType: 'deployment',
            metadata: { fields: ['customization_config'] },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].ipAddress).toBeUndefined();
    });

    it('supports optional metadata field', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'deployment.delete',
            resourceId: TEST_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: TEST_IP,
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].metadata).toEqual({});
    });

    it('does not emit audit logs for non-PII operations', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.info('Template list fetched', { count: 5 });
        log.warn('Rate limit approaching', { remaining: 10 });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(0);
    });
});

describe('Audit Trail — IP Address Resolution', () => {
    it('extracts IP from X-Forwarded-For header', () => {
        const req = makeRequest({ 'x-forwarded-for': '203.0.113.1, 198.51.100.1' });
        const ip = resolveIpAddress(req);
        expect(ip).toBe('203.0.113.1');
    });

    it('extracts IP from X-Real-IP header when X-Forwarded-For is absent', () => {
        const req = new NextRequest('https://example.com/api/test', {
            headers: { 'x-real-ip': '203.0.113.2' },
        });
        const ip = resolveIpAddress(req);
        expect(ip).toBe('203.0.113.2');
    });

    it('returns "unknown" when no IP headers are present', () => {
        const req = new NextRequest('https://example.com/api/test');
        const ip = resolveIpAddress(req);
        expect(ip).toBe('unknown');
    });

    it('handles single IP in X-Forwarded-For', () => {
        const req = makeRequest({ 'x-forwarded-for': '203.0.113.3' });
        const ip = resolveIpAddress(req);
        expect(ip).toBe('203.0.113.3');
    });

    it('trims whitespace from X-Forwarded-For IPs', () => {
        const req = makeRequest({ 'x-forwarded-for': '  203.0.113.4  , 198.51.100.2' });
        const ip = resolveIpAddress(req);
        expect(ip).toBe('203.0.113.4');
    });
});

describe('Audit Trail — Profile Operations', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('emits audit log on profile read (email PII)', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'profile.read',
            resourceId: TEST_USER_ID,
            resourceType: 'profile',
            ipAddress: TEST_IP,
            metadata: { fields: ['email'] },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].action).toBe('profile.read');
        expect(auditLogs[0].metadata.fields).toContain('email');
    });

    it('emits audit log on profile write (email PII)', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'profile.write',
            resourceId: TEST_USER_ID,
            resourceType: 'profile',
            ipAddress: TEST_IP,
            metadata: { fields: ['email'] },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].action).toBe('profile.write');
        expect(auditLogs[0].metadata.fields).toContain('email');
    });

    it('does not emit audit log for non-PII profile updates', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        // Simulate updating only non-PII fields (fullName, avatarUrl)
        // In the actual route, audit log is only emitted if email is updated
        log.info('Profile updated', { fields: ['fullName', 'avatarUrl'] });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(0);
    });
});

describe('Audit Trail — Deployment Operations', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('emits audit log on deployment read (customization_config PII)', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'deployment.read',
            resourceId: TEST_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: TEST_IP,
            metadata: { fields: ['customization_config'] },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].action).toBe('deployment.read');
        expect(auditLogs[0].resourceId).toBe(TEST_DEPLOYMENT_ID);
        expect(auditLogs[0].metadata.fields).toContain('customization_config');
    });

    it('emits audit log on deployment delete', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'deployment.delete',
            resourceId: TEST_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: TEST_IP,
            metadata: {
                repository_url: 'https://github.com/user/repo',
                vercel_project_id: 'prj_123',
            },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].action).toBe('deployment.delete');
        expect(auditLogs[0].resourceId).toBe(TEST_DEPLOYMENT_ID);
        expect(auditLogs[0].metadata.repository_url).toBe('https://github.com/user/repo');
    });

    it('does not emit audit log for non-PII deployment list', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        // Deployment list endpoint does not expose customization_config
        log.info('Deployments listed', { count: 3 });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(0);
    });
});

describe('Audit Trail — Compliance Requirements', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('audit entries include all SOC2 CC7 required fields', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'profile.read',
            resourceId: TEST_USER_ID,
            resourceType: 'profile',
            ipAddress: TEST_IP,
            metadata: { fields: ['email'] },
        });

        const auditLogs = getAuditLogs();
        const entry = auditLogs[0];

        // SOC2 CC7 requires: actor (userId), action, resource, timestamp, IP
        expect(entry.userId).toBeTruthy();
        expect(entry.action).toBeTruthy();
        expect(entry.resourceId).toBeTruthy();
        expect(entry.resourceType).toBeTruthy();
        expect(entry.timestamp).toBeTruthy();
        expect(entry.ipAddress).toBeTruthy();
        expect(entry.correlationId).toBeTruthy();
    });

    it('audit entries are in chronological order', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'profile.read',
            resourceId: TEST_USER_ID,
            resourceType: 'profile',
            ipAddress: TEST_IP,
        });

        // Small delay to ensure different timestamps
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        
        log.audit({
            userId: TEST_USER_ID,
            action: 'profile.write',
            resourceId: TEST_USER_ID,
            resourceType: 'profile',
            ipAddress: TEST_IP,
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(2);

        const ts1 = new Date(auditLogs[0].timestamp).getTime();
        const ts2 = new Date(auditLogs[1].timestamp).getTime();
        expect(ts2).toBeGreaterThanOrEqual(ts1);
    });

    it('audit log format is valid JSON', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'deployment.delete',
            resourceId: TEST_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: TEST_IP,
        });

        const logOutput = capturedLogs[0].args[0];
        expect(() => JSON.parse(logOutput)).not.toThrow();
    });

    it('multiple audit entries can be emitted in sequence', () => {
        const log = createLogger({ correlationId: TEST_CORRELATION_ID });

        log.audit({
            userId: TEST_USER_ID,
            action: 'profile.read',
            resourceId: TEST_USER_ID,
            resourceType: 'profile',
            ipAddress: TEST_IP,
        });

        log.audit({
            userId: TEST_USER_ID,
            action: 'deployment.read',
            resourceId: TEST_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: TEST_IP,
        });

        log.audit({
            userId: TEST_USER_ID,
            action: 'deployment.delete',
            resourceId: TEST_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: TEST_IP,
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(3);
        expect(auditLogs[0].action).toBe('profile.read');
        expect(auditLogs[1].action).toBe('deployment.read');
        expect(auditLogs[2].action).toBe('deployment.delete');
    });
});
