# Audit Trail Tests

This directory contains tests for the audit trail system that tracks access to Personally Identifiable Information (PII) fields.

## Test Files

### `pii-audit-trail.test.ts`
Unit tests for the audit logging system:
- Logger extension with `audit()` method
- IP address resolution from request headers
- Audit log format and structure
- PII value exclusion (security requirement)
- SOC2 CC7 compliance validation

### `route-integration.test.ts`
Integration tests for API routes:
- Profile routes (GET/PATCH) audit logging
- Deployment routes (GET/DELETE) audit logging
- Non-PII operations (no audit logs)
- Correlation ID tracking
- Security validation (no PII values in logs)

## Running Tests

Run all audit tests:
```bash
npm test -- tests/audit
```

Run specific test file:
```bash
npm test -- tests/audit/pii-audit-trail.test.ts
npm test -- tests/audit/route-integration.test.ts
```

## Compliance Requirements

These tests verify compliance with:

- **GDPR Article 30**: Records of processing activities
- **SOC2 CC7**: System monitoring and audit trails
- **NIST SP 800-92**: Computer security log management

## Key Test Scenarios

### ✅ Audit Log Emission
- Audit logs are emitted for PII field access
- All required fields are present (userId, action, resourceId, timestamp, etc.)
- Logs are in valid JSON format

### ✅ PII Protection
- Audit logs never contain actual PII values
- Only field names are logged (e.g., "email", not "user@example.com")
- Environment variables and secrets are never logged

### ✅ Selective Logging
- PII operations trigger audit logs
- Non-PII operations do not trigger audit logs
- Profile updates only log if email is changed

### ✅ Request Tracking
- Correlation IDs link audit logs to requests
- IP addresses are extracted from headers
- Multiple operations in same request share correlation ID

## Related Documentation

- [Audit Trail Documentation](../../docs/audit/AUDIT_TRAIL.md)
- [Compliance Verification Tests](../compliance/verification.test.ts)
- [Logger Implementation](../../src/lib/api/logger.ts)
