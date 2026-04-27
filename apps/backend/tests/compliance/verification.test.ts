/**
 * Deployment Compliance Verification Tests
 *
 * Verifies deployments meet GDPR, SOC2, and general compliance requirements:
 *   - Data privacy and PII handling (GDPR)
 *   - Audit trail completeness (SOC2 CC7)
 *   - Data retention policies
 *   - Encryption requirements (at-rest and in-transit)
 *   - Access control compliance (SOC2 CC6)
 *
 * Run: vitest run tests/compliance/verification.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────

const RETENTION_DAYS_LOGS = 90;
const RETENTION_DAYS_AUDIT = 365;
const RETENTION_DAYS_PII = 730; // 2 years max under GDPR Art. 5(1)(e)
const MS_PER_DAY = 86_400_000;

// ── Types ─────────────────────────────────────────────────────────────────────

type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';
type EncryptionAlgorithm = 'AES-256-GCM' | 'AES-128-GCM' | 'RSA-2048' | 'none';
type AccessLevel = 'read' | 'write' | 'admin' | 'none';

interface PiiField {
  name: string;
  value: string;
  masked: boolean;
  retentionDays: number;
}

interface AuditEntry {
  id: string;
  timestamp: number;
  actor: string;
  action: string;
  resource: string;
  outcome: 'success' | 'failure';
  ipAddress: string;
  metadata: Record<string, unknown>;
}

interface DataRetentionPolicy {
  resourceType: string;
  retentionDays: number;
  deletionMethod: 'hard_delete' | 'soft_delete' | 'anonymize';
  legalBasis?: string;
}

interface EncryptionConfig {
  atRest: EncryptionAlgorithm;
  inTransit: 'TLS1.2' | 'TLS1.3' | 'none';
  keyRotationDays: number;
  keyStorageLocation: 'hsm' | 'kms' | 'env' | 'plaintext';
}

interface AccessControlPolicy {
  userId: string;
  resource: string;
  level: AccessLevel;
  mfaRequired: boolean;
  ipAllowlist: string[];
}

interface ComplianceReport {
  deploymentId: string;
  gdprCompliant: boolean;
  soc2Compliant: boolean;
  auditTrailComplete: boolean;
  encryptionCompliant: boolean;
  accessControlCompliant: boolean;
  violations: string[];
  generatedAt: number;
}

// ── Compliance Engine ─────────────────────────────────────────────────────────

function maskPii(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${local[0]}***@${domain}`;
  }
  if (/^\+?\d[\d\s\-()]{7,}$/.test(value)) {
    return value.slice(0, -4).replace(/\d/g, '*') + value.slice(-4);
  }
  return value.slice(0, 2) + '*'.repeat(Math.max(0, value.length - 4)) + value.slice(-2);
}

function validatePiiRetention(fields: PiiField[]): string[] {
  const violations: string[] = [];
  for (const field of fields) {
    if (!field.masked) {
      violations.push(`PII field "${field.name}" is not masked`);
    }
    if (field.retentionDays > RETENTION_DAYS_PII) {
      violations.push(
        `PII field "${field.name}" retention (${field.retentionDays}d) exceeds GDPR limit (${RETENTION_DAYS_PII}d)`,
      );
    }
  }
  return violations;
}

function validateAuditTrail(entries: AuditEntry[]): { complete: boolean; gaps: string[] } {
  const gaps: string[] = [];

  if (entries.length === 0) {
    return { complete: false, gaps: ['No audit entries found'] };
  }

  for (const entry of entries) {
    if (!entry.actor || entry.actor.trim() === '') gaps.push(`Entry ${entry.id}: missing actor`);
    if (!entry.action || entry.action.trim() === '') gaps.push(`Entry ${entry.id}: missing action`);
    if (!entry.resource) gaps.push(`Entry ${entry.id}: missing resource`);
    if (!entry.ipAddress) gaps.push(`Entry ${entry.id}: missing IP address`);
    if (!entry.timestamp || entry.timestamp <= 0) gaps.push(`Entry ${entry.id}: invalid timestamp`);
  }

  // Check entries are in chronological order
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].timestamp < entries[i - 1].timestamp) {
      gaps.push(`Audit entries out of chronological order at index ${i}`);
    }
  }

  return { complete: gaps.length === 0, gaps };
}

function validateRetentionPolicies(policies: DataRetentionPolicy[]): string[] {
  const violations: string[] = [];
  const required = ['deployment_logs', 'audit_trail', 'user_data'];

  for (const resourceType of required) {
    if (!policies.find((p) => p.resourceType === resourceType)) {
      violations.push(`Missing retention policy for: ${resourceType}`);
    }
  }

  for (const policy of policies) {
    if (policy.resourceType === 'audit_trail' && policy.retentionDays < RETENTION_DAYS_AUDIT) {
      violations.push(
        `Audit trail retention (${policy.retentionDays}d) below SOC2 minimum (${RETENTION_DAYS_AUDIT}d)`,
      );
    }
    if (policy.resourceType === 'deployment_logs' && policy.retentionDays < RETENTION_DAYS_LOGS) {
      violations.push(
        `Deployment log retention (${policy.retentionDays}d) below minimum (${RETENTION_DAYS_LOGS}d)`,
      );
    }
    if (policy.deletionMethod === 'soft_delete' && policy.resourceType === 'user_data') {
      violations.push('User data must use hard_delete or anonymize, not soft_delete (GDPR Art. 17)');
    }
  }

  return violations;
}

function validateEncryption(config: EncryptionConfig): string[] {
  const violations: string[] = [];

  if (config.atRest === 'none') violations.push('Encryption at rest is disabled');
  if (config.atRest === 'AES-128-GCM') violations.push('AES-128 does not meet SOC2 requirements; use AES-256');
  if (config.inTransit === 'none') violations.push('Encryption in transit is disabled');
  if (config.inTransit === 'TLS1.2') violations.push('TLS 1.2 deprecated; upgrade to TLS 1.3');
  if (config.keyRotationDays > 365) violations.push('Key rotation period exceeds 365-day maximum');
  if (config.keyStorageLocation === 'plaintext') violations.push('Encryption keys stored in plaintext');
  if (config.keyStorageLocation === 'env') violations.push('Encryption keys in environment variables — use KMS or HSM');

  return violations;
}

function validateAccessControl(policies: AccessControlPolicy[]): string[] {
  const violations: string[] = [];

  for (const policy of policies) {
    if ((policy.level === 'write' || policy.level === 'admin') && !policy.mfaRequired) {
      violations.push(`User ${policy.userId} has ${policy.level} access without MFA requirement`);
    }
    if (policy.level === 'admin' && policy.ipAllowlist.length === 0) {
      violations.push(`Admin user ${policy.userId} has no IP allowlist restriction`);
    }
  }

  return violations;
}

function generateComplianceReport(
  deploymentId: string,
  piiFields: PiiField[],
  auditEntries: AuditEntry[],
  retentionPolicies: DataRetentionPolicy[],
  encryptionConfig: EncryptionConfig,
  accessPolicies: AccessControlPolicy[],
): ComplianceReport {
  const piiViolations = validatePiiRetention(piiFields);
  const { complete: auditComplete, gaps } = validateAuditTrail(auditEntries);
  const retentionViolations = validateRetentionPolicies(retentionPolicies);
  const encryptionViolations = validateEncryption(encryptionConfig);
  const accessViolations = validateAccessControl(accessPolicies);

  const allViolations = [...piiViolations, ...gaps, ...retentionViolations, ...encryptionViolations, ...accessViolations];

  return {
    deploymentId,
    gdprCompliant: piiViolations.length === 0 && retentionViolations.filter((v) => v.includes('GDPR')).length === 0,
    soc2Compliant: auditComplete && encryptionViolations.length === 0 && accessViolations.length === 0,
    auditTrailComplete: auditComplete,
    encryptionCompliant: encryptionViolations.length === 0,
    accessControlCompliant: accessViolations.length === 0,
    violations: allViolations,
    generatedAt: Date.now(),
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `audit_${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
    actor: 'user_123',
    action: 'deployment.create',
    resource: 'deployment/dep_abc',
    outcome: 'success',
    ipAddress: '192.168.1.1',
    metadata: { deploymentId: 'dep_abc' },
    ...overrides,
  };
}

function makeCompliantEncryption(): EncryptionConfig {
  return { atRest: 'AES-256-GCM', inTransit: 'TLS1.3', keyRotationDays: 90, keyStorageLocation: 'kms' };
}

function makeCompliantRetentionPolicies(): DataRetentionPolicy[] {
  return [
    { resourceType: 'deployment_logs', retentionDays: 90, deletionMethod: 'hard_delete' },
    { resourceType: 'audit_trail', retentionDays: 365, deletionMethod: 'hard_delete', legalBasis: 'SOC2 CC7' },
    { resourceType: 'user_data', retentionDays: 730, deletionMethod: 'anonymize', legalBasis: 'GDPR Art. 5' },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Compliance Verification — GDPR Data Privacy', () => {
  it('masks email addresses correctly', () => {
    expect(maskPii('user@example.com')).toMatch(/^u\*\*\*@example\.com$/);
  });

  it('masks phone numbers leaving last 4 digits', () => {
    const masked = maskPii('+1234567890');
    expect(masked).toMatch(/\d{4}$/);
    expect(masked).toContain('*');
  });

  it('masks generic PII fields', () => {
    const masked = maskPii('John Doe');
    expect(masked).toContain('*');
    expect(masked).not.toBe('John Doe');
  });

  it('detects unmasked PII fields', () => {
    const fields: PiiField[] = [
      { name: 'email', value: 'user@example.com', masked: false, retentionDays: 365 },
    ];
    const violations = validatePiiRetention(fields);
    expect(violations.some((v) => v.includes('not masked'))).toBe(true);
  });

  it('detects PII retention exceeding GDPR limit', () => {
    const fields: PiiField[] = [
      { name: 'email', value: 'u***@example.com', masked: true, retentionDays: 3000 },
    ];
    const violations = validatePiiRetention(fields);
    expect(violations.some((v) => v.includes('GDPR limit'))).toBe(true);
  });

  it('passes compliant PII configuration', () => {
    const fields: PiiField[] = [
      { name: 'email', value: 'u***@example.com', masked: true, retentionDays: 365 },
      { name: 'phone', value: '****7890', masked: true, retentionDays: 180 },
    ];
    expect(validatePiiRetention(fields)).toHaveLength(0);
  });

  it('rejects soft_delete for user data (GDPR Art. 17 right to erasure)', () => {
    const policies: DataRetentionPolicy[] = [
      ...makeCompliantRetentionPolicies().filter((p) => p.resourceType !== 'user_data'),
      { resourceType: 'user_data', retentionDays: 365, deletionMethod: 'soft_delete' },
    ];
    const violations = validateRetentionPolicies(policies);
    expect(violations.some((v) => v.includes('soft_delete'))).toBe(true);
  });
});

describe('Compliance Verification — Audit Trail (SOC2 CC7)', () => {
  it('validates complete audit entry', () => {
    const entries = [makeAuditEntry()];
    const { complete, gaps } = validateAuditTrail(entries);
    expect(complete).toBe(true);
    expect(gaps).toHaveLength(0);
  });

  it('detects missing actor in audit entry', () => {
    const entries = [makeAuditEntry({ actor: '' })];
    const { complete, gaps } = validateAuditTrail(entries);
    expect(complete).toBe(false);
    expect(gaps.some((g) => g.includes('actor'))).toBe(true);
  });

  it('detects missing IP address', () => {
    const entries = [makeAuditEntry({ ipAddress: '' })];
    const { complete, gaps } = validateAuditTrail(entries);
    expect(gaps.some((g) => g.includes('IP'))).toBe(true);
  });

  it('detects out-of-order audit entries', () => {
    const now = Date.now();
    const entries = [
      makeAuditEntry({ timestamp: now }),
      makeAuditEntry({ timestamp: now - 1000 }), // earlier timestamp second
    ];
    const { complete, gaps } = validateAuditTrail(entries);
    expect(complete).toBe(false);
    expect(gaps.some((g) => g.includes('chronological'))).toBe(true);
  });

  it('flags empty audit trail', () => {
    const { complete, gaps } = validateAuditTrail([]);
    expect(complete).toBe(false);
    expect(gaps[0]).toContain('No audit entries');
  });

  it('validates multiple sequential entries', () => {
    const now = Date.now();
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeAuditEntry({ timestamp: now + i * 1000 }),
    );
    const { complete } = validateAuditTrail(entries);
    expect(complete).toBe(true);
  });
});

describe('Compliance Verification — Data Retention Policies', () => {
  it('passes compliant retention policies', () => {
    const violations = validateRetentionPolicies(makeCompliantRetentionPolicies());
    expect(violations).toHaveLength(0);
  });

  it('detects missing required retention policy', () => {
    const policies = makeCompliantRetentionPolicies().filter((p) => p.resourceType !== 'audit_trail');
    const violations = validateRetentionPolicies(policies);
    expect(violations.some((v) => v.includes('audit_trail'))).toBe(true);
  });

  it('detects audit trail retention below SOC2 minimum (365 days)', () => {
    const policies = [
      ...makeCompliantRetentionPolicies().filter((p) => p.resourceType !== 'audit_trail'),
      { resourceType: 'audit_trail', retentionDays: 180, deletionMethod: 'hard_delete' as const },
    ];
    const violations = validateRetentionPolicies(policies);
    expect(violations.some((v) => v.includes('SOC2 minimum'))).toBe(true);
  });

  it('detects deployment log retention below 90-day minimum', () => {
    const policies = [
      ...makeCompliantRetentionPolicies().filter((p) => p.resourceType !== 'deployment_logs'),
      { resourceType: 'deployment_logs', retentionDays: 30, deletionMethod: 'hard_delete' as const },
    ];
    const violations = validateRetentionPolicies(policies);
    expect(violations.some((v) => v.includes('deployment_logs'))).toBe(true);
  });
});

describe('Compliance Verification — Encryption Requirements', () => {
  it('passes compliant encryption configuration', () => {
    expect(validateEncryption(makeCompliantEncryption())).toHaveLength(0);
  });

  it('rejects disabled at-rest encryption', () => {
    const config = { ...makeCompliantEncryption(), atRest: 'none' as const };
    expect(validateEncryption(config).some((v) => v.includes('at rest'))).toBe(true);
  });

  it('rejects AES-128 (requires AES-256 for SOC2)', () => {
    const config = { ...makeCompliantEncryption(), atRest: 'AES-128-GCM' as const };
    expect(validateEncryption(config).some((v) => v.includes('AES-256'))).toBe(true);
  });

  it('rejects TLS 1.2 (requires TLS 1.3)', () => {
    const config = { ...makeCompliantEncryption(), inTransit: 'TLS1.2' as const };
    expect(validateEncryption(config).some((v) => v.includes('TLS 1.3'))).toBe(true);
  });

  it('rejects plaintext key storage', () => {
    const config = { ...makeCompliantEncryption(), keyStorageLocation: 'plaintext' as const };
    expect(validateEncryption(config).some((v) => v.includes('plaintext'))).toBe(true);
  });

  it('rejects key rotation period over 365 days', () => {
    const config = { ...makeCompliantEncryption(), keyRotationDays: 400 };
    expect(validateEncryption(config).some((v) => v.includes('365-day'))).toBe(true);
  });

  it('warns on environment variable key storage', () => {
    const config = { ...makeCompliantEncryption(), keyStorageLocation: 'env' as const };
    expect(validateEncryption(config).some((v) => v.includes('KMS'))).toBe(true);
  });
});

describe('Compliance Verification — Access Control (SOC2 CC6)', () => {
  it('passes compliant access control policies', () => {
    const policies: AccessControlPolicy[] = [
      { userId: 'user_1', resource: 'deployments', level: 'read', mfaRequired: false, ipAllowlist: [] },
      { userId: 'admin_1', resource: 'deployments', level: 'admin', mfaRequired: true, ipAllowlist: ['10.0.0.0/8'] },
    ];
    expect(validateAccessControl(policies)).toHaveLength(0);
  });

  it('requires MFA for write access', () => {
    const policies: AccessControlPolicy[] = [
      { userId: 'user_1', resource: 'deployments', level: 'write', mfaRequired: false, ipAllowlist: [] },
    ];
    const violations = validateAccessControl(policies);
    expect(violations.some((v) => v.includes('MFA'))).toBe(true);
  });

  it('requires MFA for admin access', () => {
    const policies: AccessControlPolicy[] = [
      { userId: 'admin_1', resource: 'deployments', level: 'admin', mfaRequired: false, ipAllowlist: ['10.0.0.1'] },
    ];
    const violations = validateAccessControl(policies);
    expect(violations.some((v) => v.includes('MFA'))).toBe(true);
  });

  it('requires IP allowlist for admin users', () => {
    const policies: AccessControlPolicy[] = [
      { userId: 'admin_1', resource: 'deployments', level: 'admin', mfaRequired: true, ipAllowlist: [] },
    ];
    const violations = validateAccessControl(policies);
    expect(violations.some((v) => v.includes('IP allowlist'))).toBe(true);
  });

  it('allows read access without MFA', () => {
    const policies: AccessControlPolicy[] = [
      { userId: 'user_1', resource: 'deployments', level: 'read', mfaRequired: false, ipAllowlist: [] },
    ];
    expect(validateAccessControl(policies)).toHaveLength(0);
  });
});

describe('Compliance Verification — Full Report Generation', () => {
  it('generates a fully compliant report', () => {
    const now = Date.now();
    const report = generateComplianceReport(
      'dep_001',
      [{ name: 'email', value: 'u***@example.com', masked: true, retentionDays: 365 }],
      [makeAuditEntry({ timestamp: now }), makeAuditEntry({ timestamp: now + 1000 })],
      makeCompliantRetentionPolicies(),
      makeCompliantEncryption(),
      [{ userId: 'admin_1', resource: 'all', level: 'admin', mfaRequired: true, ipAllowlist: ['10.0.0.0/8'] }],
    );

    expect(report.gdprCompliant).toBe(true);
    expect(report.soc2Compliant).toBe(true);
    expect(report.auditTrailComplete).toBe(true);
    expect(report.encryptionCompliant).toBe(true);
    expect(report.accessControlCompliant).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it('report contains deploymentId and timestamp', () => {
    const report = generateComplianceReport(
      'dep_test',
      [], [], makeCompliantRetentionPolicies(), makeCompliantEncryption(), [],
    );
    expect(report.deploymentId).toBe('dep_test');
    expect(report.generatedAt).toBeGreaterThan(0);
  });

  it('non-compliant report lists all violations', () => {
    const report = generateComplianceReport(
      'dep_bad',
      [{ name: 'email', value: 'raw@email.com', masked: false, retentionDays: 365 }],
      [],
      [],
      { atRest: 'none', inTransit: 'none', keyRotationDays: 400, keyStorageLocation: 'plaintext' },
      [{ userId: 'admin_1', resource: 'all', level: 'admin', mfaRequired: false, ipAllowlist: [] }],
    );

    expect(report.violations.length).toBeGreaterThan(0);
    expect(report.gdprCompliant).toBe(false);
    expect(report.soc2Compliant).toBe(false);
  });
});
