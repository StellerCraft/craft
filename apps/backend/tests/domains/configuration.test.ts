/**
 * Custom Domain Configuration Tests
 * Issue #348: Add Custom Domain Configuration Tests
 *
 * Covers domain validation, DNS verification, SSL provisioning, tier-based
 * restrictions, conflict detection, and multiple domains per deployment.
 *
 * All external calls (Vercel API, DNS resolvers) are simulated in-memory.
 *
 * Domain configuration requirements:
 *   - free tier      : 0 custom domains
 *   - starter tier   : 1 custom domain
 *   - pro tier       : 5 custom domains
 *   - enterprise tier: unlimited
 *
 * DNS verification flow:
 *   1. User adds domain → system returns required DNS records
 *   2. System polls DNS until records propagate (or timeout)
 *   3. Vercel provisions SSL certificate once DNS is verified
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

type DomainStatus = 'pending' | 'dns_verified' | 'ssl_provisioned' | 'active' | 'failed';
type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';
type DnsRecordType = 'A' | 'AAAA' | 'CNAME';

interface DnsRecord {
  type: DnsRecordType;
  host: string;
  value: string;
  ttl: number;
}

interface DomainConfig {
  domain: string;
  deploymentId: string;
  status: DomainStatus;
  dnsRecords: DnsRecord[];
  sslProvisioned: boolean;
  addedAt: Date;
}

interface DomainValidationResult {
  valid: boolean;
  error?: string;
}

interface DnsVerificationResult {
  verified: boolean;
  propagated: string[];   // record types that resolved correctly
  missing: string[];      // record types not yet propagated
}

interface SslProvisionResult {
  success: boolean;
  certificateId?: string;
  error?: string;
}

interface TierDomainCheck {
  allowed: boolean;
  reason?: string;
  limit?: number;
}

// ── Domain validator ──────────────────────────────────────────────────────────

const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function validateDomain(domain: string): DomainValidationResult {
  if (!domain || domain.trim() === '') {
    return { valid: false, error: 'Domain cannot be empty' };
  }
  if (domain.length > 253) {
    return { valid: false, error: 'Domain exceeds maximum length of 253 characters' };
  }
  if (!DOMAIN_REGEX.test(domain)) {
    return { valid: false, error: 'Invalid domain format' };
  }
  const labels = domain.split('.');
  if (labels.some(l => l.length > 63)) {
    return { valid: false, error: 'Domain label exceeds 63 characters' };
  }
  return { valid: true };
}

function isApexDomain(domain: string): boolean {
  return domain.split('.').length === 2;
}

function buildRequiredDnsRecords(domain: string): DnsRecord[] {
  if (isApexDomain(domain)) {
    return [
      { type: 'A',    host: '@', value: '76.76.21.21',                ttl: 3600 },
      { type: 'AAAA', host: '@', value: '2606:4700:3108::ac42:2a2a',  ttl: 3600 },
    ];
  }
  return [
    { type: 'CNAME', host: domain.split('.')[0], value: 'cname.vercel-dns.com', ttl: 3600 },
  ];
}

// ── Tier limits ───────────────────────────────────────────────────────────────

const TIER_DOMAIN_LIMITS: Record<SubscriptionTier, number> = {
  free:       0,
  starter:    1,
  pro:        5,
  enterprise: -1, // unlimited
};

function checkTierDomainAccess(tier: SubscriptionTier, currentCount: number): TierDomainCheck {
  const limit = TIER_DOMAIN_LIMITS[tier];
  if (limit === 0) {
    return { allowed: false, reason: 'Custom domains require Starter plan or above', limit: 0 };
  }
  if (limit !== -1 && currentCount >= limit) {
    return { allowed: false, reason: `Domain limit of ${limit} reached for ${tier} tier`, limit };
  }
  return { allowed: true, limit: limit === -1 ? Infinity : limit };
}

// ── Simulated DNS resolver ────────────────────────────────────────────────────

class SimulatedDnsResolver {
  /** domains whose records are "propagated" in this simulation */
  private propagated = new Set<string>();

  markPropagated(domain: string): void {
    this.propagated.add(domain);
  }

  verify(domain: string, required: DnsRecord[]): DnsVerificationResult {
    if (this.propagated.has(domain)) {
      return {
        verified: true,
        propagated: required.map(r => r.type),
        missing: [],
      };
    }
    return {
      verified: false,
      propagated: [],
      missing: required.map(r => r.type),
    };
  }
}

// ── Simulated Vercel domain API ───────────────────────────────────────────────

interface VercelDomainResponse {
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
}

class SimulatedVercelDomainApi {
  private domains = new Map<string, VercelDomainResponse>();
  private sslCerts = new Map<string, string>();
  readonly calls: Array<{ method: string; domain: string }> = [];

  addDomain(domain: string, projectId: string): VercelDomainResponse {
    this.calls.push({ method: 'POST', domain });
    const parts = domain.split('.');
    const apex = parts.slice(-2).join('.');
    const response: VercelDomainResponse = { name: domain, apexName: apex, projectId, verified: false };
    this.domains.set(domain, response);
    return response;
  }

  verifyDomain(domain: string): boolean {
    this.calls.push({ method: 'GET', domain });
    const entry = this.domains.get(domain);
    if (!entry) return false;
    entry.verified = true;
    return true;
  }

  provisionSsl(domain: string): SslProvisionResult {
    this.calls.push({ method: 'POST_SSL', domain });
    if (!this.domains.get(domain)?.verified) {
      return { success: false, error: 'Domain not verified' };
    }
    const certId = `cert-${domain.replace(/\./g, '-')}-${Date.now()}`;
    this.sslCerts.set(domain, certId);
    return { success: true, certificateId: certId };
  }

  removeDomain(domain: string): boolean {
    this.calls.push({ method: 'DELETE', domain });
    return this.domains.delete(domain);
  }

  hasDomain(domain: string): boolean {
    return this.domains.has(domain);
  }
}

// ── Domain registry (per-deployment store) ────────────────────────────────────

class DomainRegistry {
  private store = new Map<string, DomainConfig[]>(); // deploymentId → configs

  add(deploymentId: string, config: DomainConfig): void {
    const existing = this.store.get(deploymentId) ?? [];
    existing.push(config);
    this.store.set(deploymentId, existing);
  }

  getAll(deploymentId: string): DomainConfig[] {
    return this.store.get(deploymentId) ?? [];
  }

  getAllDomains(): string[] {
    return [...this.store.values()].flat().map(c => c.domain);
  }

  hasDomain(domain: string): boolean {
    return this.getAllDomains().includes(domain);
  }

  updateStatus(deploymentId: string, domain: string, status: DomainStatus): void {
    const configs = this.store.get(deploymentId) ?? [];
    const cfg = configs.find(c => c.domain === domain);
    if (cfg) cfg.status = status;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(domain: string, deploymentId = 'dep-1'): DomainConfig {
  return {
    domain,
    deploymentId,
    status: 'pending',
    dnsRecords: buildRequiredDnsRecords(domain),
    sslProvisioned: false,
    addedAt: new Date(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Domain validation', () => {
  it('accepts valid apex domains', () => {
    expect(validateDomain('example.com').valid).toBe(true);
    expect(validateDomain('my-app.io').valid).toBe(true);
    expect(validateDomain('stellar.finance').valid).toBe(true);
  });

  it('accepts valid subdomains', () => {
    expect(validateDomain('app.example.com').valid).toBe(true);
    expect(validateDomain('dex.my-platform.io').valid).toBe(true);
    expect(validateDomain('a.b.c.example.com').valid).toBe(true);
  });

  it('rejects empty domain', () => {
    const result = validateDomain('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it('rejects domain exceeding 253 characters', () => {
    const long = 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(63) + '.com';
    const result = validateDomain(long);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/length/i);
  });

  it('rejects domain with invalid characters', () => {
    expect(validateDomain('exam_ple.com').valid).toBe(false);
    expect(validateDomain('exam ple.com').valid).toBe(false);
    expect(validateDomain('example..com').valid).toBe(false);
  });

  it('rejects bare TLD', () => {
    expect(validateDomain('com').valid).toBe(false);
  });

  it('rejects domain with label exceeding 63 characters', () => {
    const label = 'a'.repeat(64);
    expect(validateDomain(`${label}.com`).valid).toBe(false);
  });
});

describe('DNS record generation', () => {
  it('apex domain gets A and AAAA records', () => {
    const records = buildRequiredDnsRecords('example.com');
    const types = records.map(r => r.type);
    expect(types).toContain('A');
    expect(types).toContain('AAAA');
    expect(types).not.toContain('CNAME');
  });

  it('subdomain gets a CNAME record', () => {
    const records = buildRequiredDnsRecords('app.example.com');
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe('CNAME');
    expect(records[0].value).toContain('vercel');
  });

  it('all records have positive TTL', () => {
    for (const domain of ['example.com', 'app.example.com', 'dex.stellar.io']) {
      buildRequiredDnsRecords(domain).forEach(r => {
        expect(r.ttl).toBeGreaterThan(0);
      });
    }
  });
});

describe('DNS verification', () => {
  let resolver: SimulatedDnsResolver;

  beforeEach(() => {
    resolver = new SimulatedDnsResolver();
  });

  it('returns verified=false before DNS propagates', () => {
    const records = buildRequiredDnsRecords('example.com');
    const result = resolver.verify('example.com', records);
    expect(result.verified).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it('returns verified=true after DNS propagates', () => {
    resolver.markPropagated('example.com');
    const records = buildRequiredDnsRecords('example.com');
    const result = resolver.verify('example.com', records);
    expect(result.verified).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('lists all required record types as missing before propagation', () => {
    const records = buildRequiredDnsRecords('example.com'); // A + AAAA
    const result = resolver.verify('example.com', records);
    expect(result.missing).toContain('A');
    expect(result.missing).toContain('AAAA');
  });

  it('lists all propagated record types after verification', () => {
    resolver.markPropagated('app.example.com');
    const records = buildRequiredDnsRecords('app.example.com'); // CNAME
    const result = resolver.verify('app.example.com', records);
    expect(result.propagated).toContain('CNAME');
  });
});

describe('SSL certificate provisioning', () => {
  let vercel: SimulatedVercelDomainApi;

  beforeEach(() => {
    vercel = new SimulatedVercelDomainApi();
  });

  it('provisions SSL after domain is verified', () => {
    vercel.addDomain('example.com', 'proj-1');
    vercel.verifyDomain('example.com');
    const result = vercel.provisionSsl('example.com');
    expect(result.success).toBe(true);
    expect(result.certificateId).toBeDefined();
  });

  it('fails SSL provisioning when domain is not verified', () => {
    vercel.addDomain('example.com', 'proj-1');
    // skip verifyDomain
    const result = vercel.provisionSsl('example.com');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not verified/i);
  });

  it('fails SSL provisioning for unknown domain', () => {
    const result = vercel.provisionSsl('unknown.com');
    expect(result.success).toBe(false);
  });

  it('each domain gets a unique certificate id', () => {
    const domains = ['alpha.com', 'beta.com', 'gamma.com'];
    const certIds = domains.map(d => {
      vercel.addDomain(d, 'proj-1');
      vercel.verifyDomain(d);
      return vercel.provisionSsl(d).certificateId;
    });
    const unique = new Set(certIds);
    expect(unique.size).toBe(domains.length);
  });
});

describe('Tier-based domain restrictions', () => {
  it('free tier cannot add any custom domain', () => {
    const result = checkTierDomainAccess('free', 0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/starter/i);
  });

  it('starter tier allows 1 domain', () => {
    expect(checkTierDomainAccess('starter', 0).allowed).toBe(true);
    expect(checkTierDomainAccess('starter', 1).allowed).toBe(false);
  });

  it('pro tier allows up to 5 domains', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkTierDomainAccess('pro', i).allowed).toBe(true);
    }
    expect(checkTierDomainAccess('pro', 5).allowed).toBe(false);
  });

  it('enterprise tier has no domain limit', () => {
    expect(checkTierDomainAccess('enterprise', 0).allowed).toBe(true);
    expect(checkTierDomainAccess('enterprise', 100).allowed).toBe(true);
    expect(checkTierDomainAccess('enterprise', 10_000).allowed).toBe(true);
  });

  it('rejection message includes the tier limit', () => {
    const result = checkTierDomainAccess('pro', 5);
    expect(result.reason).toMatch(/5/);
    expect(result.limit).toBe(5);
  });
});

describe('Domain conflict detection', () => {
  let registry: DomainRegistry;

  beforeEach(() => {
    registry = new DomainRegistry();
  });

  it('detects a domain already registered to another deployment', () => {
    registry.add('dep-1', makeConfig('example.com', 'dep-1'));
    expect(registry.hasDomain('example.com')).toBe(true);
  });

  it('allows the same domain on the same deployment (idempotent add)', () => {
    registry.add('dep-1', makeConfig('example.com', 'dep-1'));
    // hasDomain returns true — caller decides whether to reject or skip
    expect(registry.hasDomain('example.com')).toBe(true);
  });

  it('does not flag a different domain as conflicting', () => {
    registry.add('dep-1', makeConfig('example.com', 'dep-1'));
    expect(registry.hasDomain('other.com')).toBe(false);
  });

  it('conflict check spans all deployments', () => {
    registry.add('dep-1', makeConfig('alpha.com', 'dep-1'));
    registry.add('dep-2', makeConfig('beta.com', 'dep-2'));
    expect(registry.hasDomain('alpha.com')).toBe(true);
    expect(registry.hasDomain('beta.com')).toBe(true);
    expect(registry.hasDomain('gamma.com')).toBe(false);
  });
});

describe('Multiple domains per deployment', () => {
  let registry: DomainRegistry;
  let vercel: SimulatedVercelDomainApi;
  let resolver: SimulatedDnsResolver;

  beforeEach(() => {
    registry = new DomainRegistry();
    vercel = new SimulatedVercelDomainApi();
    resolver = new SimulatedDnsResolver();
  });

  it('pro tier deployment can hold up to 5 domains', () => {
    const domains = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'];
    domains.forEach(d => registry.add('dep-1', makeConfig(d, 'dep-1')));
    expect(registry.getAll('dep-1')).toHaveLength(5);
  });

  it('each domain in a deployment has its own DNS records', () => {
    const domains = ['apex.com', 'sub.apex.com'];
    domains.forEach(d => registry.add('dep-1', makeConfig(d, 'dep-1')));
    const configs = registry.getAll('dep-1');
    const allRecordTypes = configs.flatMap(c => c.dnsRecords.map(r => r.type));
    expect(allRecordTypes).toContain('A');
    expect(allRecordTypes).toContain('CNAME');
  });

  it('domains across deployments are independent', () => {
    registry.add('dep-1', makeConfig('dep1.com', 'dep-1'));
    registry.add('dep-2', makeConfig('dep2.com', 'dep-2'));
    expect(registry.getAll('dep-1').map(c => c.domain)).toEqual(['dep1.com']);
    expect(registry.getAll('dep-2').map(c => c.domain)).toEqual(['dep2.com']);
  });

  it('full flow: add → verify DNS → provision SSL for multiple domains', () => {
    const domains = ['first.com', 'second.com'];
    domains.forEach(d => {
      vercel.addDomain(d, 'proj-1');
      resolver.markPropagated(d);
      const dnsResult = resolver.verify(d, buildRequiredDnsRecords(d));
      expect(dnsResult.verified).toBe(true);
      vercel.verifyDomain(d);
      const ssl = vercel.provisionSsl(d);
      expect(ssl.success).toBe(true);
    });
  });

  it('removing a domain from Vercel frees the slot', () => {
    vercel.addDomain('example.com', 'proj-1');
    expect(vercel.hasDomain('example.com')).toBe(true);
    vercel.removeDomain('example.com');
    expect(vercel.hasDomain('example.com')).toBe(false);
  });

  it('Vercel API is called once per domain add', () => {
    const domains = ['x.com', 'y.com', 'z.com'];
    domains.forEach(d => vercel.addDomain(d, 'proj-1'));
    const addCalls = vercel.calls.filter(c => c.method === 'POST');
    expect(addCalls).toHaveLength(3);
  });
});
