# Audit Trail for PII Field Access

## Overview

This document describes the audit trail implementation for tracking access to Personally Identifiable Information (PII) fields in compliance with GDPR and SOC2 CC7 requirements.

## Compliance Requirements

### GDPR Article 30
- Organizations must maintain records of processing activities
- Records must include purposes of processing, categories of data subjects, and recipients

### SOC2 CC7 (Monitoring Activities)
- System activities must be monitored to detect and respond to security incidents
- Audit logs must include: actor, action, resource, timestamp, IP address, and outcome

## PII Fields Tracked

The following fields are considered PII and trigger audit log entries:

1. **Profile Data**
   - `email` - User email address (read/write operations)

2. **Deployment Data**
   - `customization_config` - May contain environment variables with secrets (read operations)

3. **Deletion Operations**
   - Deployment deletion (includes all associated PII)

## Audit Log Format

Audit log entries are emitted as structured JSON to stdout with `level: "audit"`:

```json
{
  "level": "audit",
  "userId": "user_123",
  "action": "profile.read",
  "resourceId": "user_123",
  "resourceType": "profile",
  "timestamp": "2026-04-29T10:30:00.000Z",
  "correlationId": "corr_xyz",
  "ipAddress": "192.168.1.100",
  "metadata": {
    "fields": ["email"]
  }
}
```

### Required Fields

- `level`: Always "audit" for audit entries
- `userId`: ID of the user performing the action
- `action`: Action performed (e.g., "profile.read", "deployment.delete")
- `resourceId`: ID of the resource being accessed
- `resourceType`: Type of resource (e.g., "profile", "deployment")
- `timestamp`: ISO 8601 timestamp
- `correlationId`: Request correlation ID for tracing

### Optional Fields

- `ipAddress`: Client IP address (extracted from X-Forwarded-For or X-Real-IP headers)
- `metadata`: Additional context (field names, but never PII values)

## Security Considerations

### PII Value Exclusion

**CRITICAL**: Audit log entries must NEVER contain actual PII values. Only metadata about which fields were accessed should be logged.

❌ **WRONG**:
```json
{
  "action": "profile.write",
  "metadata": {
    "email": "user@example.com"  // ❌ Contains PII value
  }
}
```

✅ **CORRECT**:
```json
{
  "action": "profile.write",
  "metadata": {
    "fields": ["email"]  // ✅ Only field name
  }
}
```

### IP Address Extraction

IP addresses are extracted in the following order:
1. `X-Forwarded-For` header (first IP in comma-separated list)
2. `X-Real-IP` header
3. "unknown" if neither header is present

## Implementation

### Logger Extension

The `createLogger` function has been extended with an `audit()` method:

```typescript
const log = createLogger({ correlationId });

log.audit({
  userId: user.id,
  action: 'profile.read',
  resourceId: user.id,
  resourceType: 'profile',
  ipAddress: resolveIpAddress(req),
  metadata: { fields: ['email'] },
});
```

### Route Integration

#### Profile Routes (`/api/auth/profile`)

**GET** - Profile Read:
```typescript
log.audit({
  userId: user.id,
  action: 'profile.read',
  resourceId: user.id,
  resourceType: 'profile',
  ipAddress: resolveIpAddress(req),
  metadata: { fields: ['email'] },
});
```

**PATCH** - Profile Write (only if email is updated):
```typescript
const piiFields = updatedFields.filter(field => field === 'email');

if (piiFields.length > 0) {
  log.audit({
    userId: user.id,
    action: 'profile.write',
    resourceId: user.id,
    resourceType: 'profile',
    ipAddress: resolveIpAddress(req),
    metadata: { fields: piiFields },
  });
}
```

#### Deployment Routes (`/api/deployments/[id]`)

**GET** - Deployment Read:
```typescript
log.audit({
  userId: user.id,
  action: 'deployment.read',
  resourceId: deploymentId,
  resourceType: 'deployment',
  ipAddress: resolveIpAddress(req),
  metadata: { fields: ['customization_config'] },
});
```

**DELETE** - Deployment Delete:
```typescript
log.audit({
  userId: user.id,
  action: 'deployment.delete',
  resourceId: deploymentId,
  resourceType: 'deployment',
  ipAddress: resolveIpAddress(req),
  metadata: {
    repository_url: deployment.repository_url,
    vercel_project_id: deployment.vercel_project_id,
  },
});
```

## Testing

Comprehensive tests are located in `tests/audit/pii-audit-trail.test.ts`:

- ✅ Audit log emission with required fields
- ✅ PII value exclusion (only field names logged)
- ✅ IP address resolution from headers
- ✅ Profile read/write operations
- ✅ Deployment read/delete operations
- ✅ Non-PII operations do not emit audit logs
- ✅ SOC2 CC7 compliance (all required fields present)
- ✅ Chronological ordering
- ✅ Valid JSON format

Run tests:
```bash
npm test -- tests/audit/pii-audit-trail.test.ts
```

## Log Aggregation

Audit logs are written to stdout as JSON and can be:

1. **Captured by Vercel Log Drains** - Automatically forwarded to log aggregation services
2. **Filtered by level** - Use `level: "audit"` to separate audit logs from application logs
3. **Retained per policy** - SOC2 requires 365-day retention for audit trails

### Example Log Drain Configuration

```json
{
  "name": "audit-logs",
  "type": "json",
  "filter": {
    "level": "audit"
  },
  "destination": "https://logs.example.com/audit"
}
```

## Monitoring and Alerting

Consider setting up alerts for:

- High volume of PII access from a single user
- PII access from unusual IP addresses
- Failed authentication attempts before PII access
- PII access outside business hours

## Future Enhancements

1. **Separate Audit Log Sink** - Write audit logs to a dedicated database table or service
2. **Audit Log Encryption** - Encrypt audit logs at rest
3. **Audit Log Integrity** - Implement cryptographic signatures to prevent tampering
4. **Real-time Alerting** - Trigger alerts on suspicious PII access patterns
5. **Audit Log Viewer** - Build an admin UI for searching and analyzing audit logs

## References

- [GDPR Article 30 - Records of processing activities](https://gdpr-info.eu/art-30-gdpr/)
- [SOC2 Trust Service Criteria - CC7](https://www.aicpa.org/resources/landing/trust-services-criteria)
- [NIST SP 800-92 - Guide to Computer Security Log Management](https://csrc.nist.gov/publications/detail/sp/800-92/final)

## Related Files

- `apps/backend/src/lib/api/logger.ts` - Logger implementation with audit support
- `apps/backend/src/app/api/auth/profile/route.ts` - Profile routes with audit logging
- `apps/backend/src/app/api/deployments/[id]/route.ts` - Deployment routes with audit logging
- `apps/backend/tests/audit/pii-audit-trail.test.ts` - Audit trail tests
- `apps/backend/tests/compliance/verification.test.ts` - Compliance verification tests
