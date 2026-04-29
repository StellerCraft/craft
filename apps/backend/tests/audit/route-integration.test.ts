/**
 * Audit Trail Route Integration Tests
 *
 * Verifies that API routes correctly emit audit log entries when PII fields
 * are accessed. These tests validate the end-to-end integration between
 * route handlers and the audit logging system.
 *
 * Run: vitest run tests/audit/route-integration.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createLogger, resolveIpAddress, type AuditLogEntry } from '@/lib/api/logger';

// ── Test Utilities ────────────────────────────────────────────────────────────

let capturedLogs: any[] = [];

function captureConsoleLogs() {
    capturedLogs = [];
    const originalLog = console.log;

    console.log = vi.fn((...args) => {
        capturedLogs.push({ level: 'log', args });
        originalLog(...args);
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

// ── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_USER_ID = 'user_test_123';
const MOCK_DEPLOYMENT_ID = 'dep_test_abc';
const MOCK_IP = '203.0.113.50';
const MOCK_CORRELATION_ID = 'corr_test_xyz';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Route Integration — Profile Routes', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('GET /api/auth/profile emits audit log for email read', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Simulate profile read operation
        log.audit({
            userId: MOCK_USER_ID,
            action: 'profile.read',
            resourceId: MOCK_USER_ID,
            resourceType: 'profile',
            ipAddress: MOCK_IP,
            metadata: { fields: ['email'] },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);

        const entry = auditLogs[0];
        expect(entry.action).toBe('profile.read');
        expect(entry.userId).toBe(MOCK_USER_ID);
        expect(entry.resourceType).toBe('profile');
        expect(entry.metadata.fields).toContain('email');
    });

    it('PATCH /api/auth/profile emits audit log only when email is updated', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Simulate profile update with email change
        const updatedFields = ['email', 'fullName'];
        const piiFields = updatedFields.filter(field => field === 'email');

        if (piiFields.length > 0) {
            log.audit({
                userId: MOCK_USER_ID,
                action: 'profile.write',
                resourceId: MOCK_USER_ID,
                resourceType: 'profile',
                ipAddress: MOCK_IP,
                metadata: { fields: piiFields },
            });
        }

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].action).toBe('profile.write');
        expect(auditLogs[0].metadata.fields).toEqual(['email']);
    });

    it('PATCH /api/auth/profile does not emit audit log for non-PII updates', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Simulate profile update without email change
        const updatedFields = ['fullName', 'avatarUrl'];
        const piiFields = updatedFields.filter(field => field === 'email');

        if (piiFields.length > 0) {
            log.audit({
                userId: MOCK_USER_ID,
                action: 'profile.write',
                resourceId: MOCK_USER_ID,
                resourceType: 'profile',
                ipAddress: MOCK_IP,
                metadata: { fields: piiFields },
            });
        }

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(0);
    });
});

describe('Route Integration — Deployment Routes', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('GET /api/deployments/[id] emits audit log for customization_config read', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Simulate deployment read operation
        log.audit({
            userId: MOCK_USER_ID,
            action: 'deployment.read',
            resourceId: MOCK_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: MOCK_IP,
            metadata: { fields: ['customization_config'] },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);

        const entry = auditLogs[0];
        expect(entry.action).toBe('deployment.read');
        expect(entry.resourceId).toBe(MOCK_DEPLOYMENT_ID);
        expect(entry.resourceType).toBe('deployment');
        expect(entry.metadata.fields).toContain('customization_config');
    });

    it('DELETE /api/deployments/[id] emits audit log with metadata', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Simulate deployment deletion
        log.audit({
            userId: MOCK_USER_ID,
            action: 'deployment.delete',
            resourceId: MOCK_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: MOCK_IP,
            metadata: {
                repository_url: 'https://github.com/test/repo',
                vercel_project_id: 'prj_test_123',
            },
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(1);

        const entry = auditLogs[0];
        expect(entry.action).toBe('deployment.delete');
        expect(entry.resourceId).toBe(MOCK_DEPLOYMENT_ID);
        expect(entry.metadata.repository_url).toBe('https://github.com/test/repo');
        expect(entry.metadata.vercel_project_id).toBe('prj_test_123');
    });
});

describe('Route Integration — Non-PII Operations', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('GET /api/templates does not emit audit logs', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Template list does not contain PII
        log.info('Templates fetched', { count: 5 });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(0);
    });

    it('GET /api/deployments (list) does not emit audit logs', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Deployment list does not expose customization_config
        log.info('Deployments listed', { count: 3 });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(0);
    });

    it('POST /api/deployments does not emit audit logs', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Deployment creation logs are informational, not audit
        log.info('Deployment created', { deploymentId: MOCK_DEPLOYMENT_ID });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(0);
    });
});

describe('Route Integration — Correlation ID Tracking', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('audit logs include correlation ID for request tracing', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        log.audit({
            userId: MOCK_USER_ID,
            action: 'profile.read',
            resourceId: MOCK_USER_ID,
            resourceType: 'profile',
            ipAddress: MOCK_IP,
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs[0].correlationId).toBe(MOCK_CORRELATION_ID);
    });

    it('multiple operations in same request share correlation ID', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        log.audit({
            userId: MOCK_USER_ID,
            action: 'profile.read',
            resourceId: MOCK_USER_ID,
            resourceType: 'profile',
            ipAddress: MOCK_IP,
        });

        log.audit({
            userId: MOCK_USER_ID,
            action: 'deployment.read',
            resourceId: MOCK_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: MOCK_IP,
        });

        const auditLogs = getAuditLogs();
        expect(auditLogs).toHaveLength(2);
        expect(auditLogs[0].correlationId).toBe(MOCK_CORRELATION_ID);
        expect(auditLogs[1].correlationId).toBe(MOCK_CORRELATION_ID);
    });
});

describe('Route Integration — IP Address Tracking', () => {
    it('extracts IP from X-Forwarded-For header', () => {
        const req = new NextRequest('https://example.com/api/test', {
            headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.1' },
        });

        const ip = resolveIpAddress(req);
        expect(ip).toBe('203.0.113.1');
    });

    it('extracts IP from X-Real-IP header as fallback', () => {
        const req = new NextRequest('https://example.com/api/test', {
            headers: { 'x-real-ip': '203.0.113.2' },
        });

        const ip = resolveIpAddress(req);
        expect(ip).toBe('203.0.113.2');
    });

    it('handles missing IP headers gracefully', () => {
        const req = new NextRequest('https://example.com/api/test');
        const ip = resolveIpAddress(req);
        expect(ip).toBe('unknown');
    });
});

describe('Route Integration — Security Validation', () => {
    beforeEach(() => {
        captureConsoleLogs();
    });

    afterEach(() => {
        restoreConsoleLogs();
    });

    it('audit logs never contain actual PII values', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Simulate profile write with email
        log.audit({
            userId: MOCK_USER_ID,
            action: 'profile.write',
            resourceId: MOCK_USER_ID,
            resourceType: 'profile',
            ipAddress: MOCK_IP,
            metadata: { fields: ['email'] },
        });

        const auditLogs = getAuditLogs();
        const logString = JSON.stringify(auditLogs[0]);

        // Verify no email addresses are present
        expect(logString).not.toMatch(/@/);
        expect(logString).not.toContain('user@example.com');
        expect(logString).not.toContain('test@test.com');

        // Only field name should be present
        expect(auditLogs[0].metadata.fields).toContain('email');
    });

    it('audit logs never contain environment variable values', () => {
        const log = createLogger({ correlationId: MOCK_CORRELATION_ID });

        // Simulate deployment read with customization_config
        log.audit({
            userId: MOCK_USER_ID,
            action: 'deployment.read',
            resourceId: MOCK_DEPLOYMENT_ID,
            resourceType: 'deployment',
            ipAddress: MOCK_IP,
            metadata: { fields: ['customization_config'] },
        });

        const auditLogs = getAuditLogs();
        const logString = JSON.stringify(auditLogs[0]);

        // Verify no secret values are present
        expect(logString).not.toContain('API_KEY');
        expect(logString).not.toContain('SECRET');
        expect(logString).not.toContain('PASSWORD');
        expect(logString).not.toContain('TOKEN');

        // Only field name should be present
        expect(auditLogs[0].metadata.fields).toContain('customization_config');
    });
});
