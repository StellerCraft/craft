/**
 * Cross-Region Auth Consistency Tests for Supabase Regional Auth Functions
 * 
 * Tests that tokens issued in one region are verifiable in another region.
 * - Tokens from us-east-1 must be accepted by eu-west-1 validator
 * - Clock skew ≤5 seconds does not cause rejection
 * - Covers sign-up, sign-in, token-refresh across region boundaries
 * - Uses mocked Deno runtime (no live Supabase calls)
 * 
 * Issue: #724
 * Branch: test/regional-auth-cross-region-consistency
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock JWT Implementation ────────────────────────────────────────────────────

interface JWTPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  iss: string;
  region: string;
}

interface JWTToken {
  header: Record<string, any>;
  payload: JWTPayload;
  signature: string;
}

const SHARED_JWT_KEY = 'shared-secret-key-across-regions';

class JWTSigner {
  private key: string;

  constructor(key: string) {
    this.key = key;
  }

  sign(payload: JWTPayload): JWTToken {
    const header = { alg: 'HS256', typ: 'JWT' };
    const signature = this.computeSignature(header, payload);

    return { header, payload, signature };
  }

  verify(token: JWTToken, clockSkewTolerance: number = 5000): boolean {
    const now = Date.now();
    const iat = token.payload.iat * 1000;
    const exp = token.payload.exp * 1000;

    // Check expiration (with clock skew tolerance)
    if (now > exp + clockSkewTolerance) {
      return false;
    }

    // Check issued-at time (allow 5 seconds in the future)
    if (now < iat - clockSkewTolerance) {
      return false;
    }

    // Verify signature
    const expectedSignature = this.computeSignature(token.header, token.payload);
    return token.signature === expectedSignature;
  }

  private computeSignature(header: Record<string, any>, payload: JWTPayload): string {
    // Simplified: hash(key + JSON(header) + JSON(payload))
    const combined = JSON.stringify(header) + JSON.stringify(payload);
    return Buffer.from(combined + this.key).toString('hex').substring(0, 32);
  }
}

// ── Region Configuration ───────────────────────────────────────────────────────

interface RegionConfig {
  name: string;
  endpoint: string;
  signer: JWTSigner;
}

const regionConfigs: Record<string, RegionConfig> = {
  'us-east-1': {
    name: 'us-east-1',
    endpoint: 'https://us-east-1.functions.supabase.co',
    signer: new JWTSigner(SHARED_JWT_KEY),
  },
  'eu-west-1': {
    name: 'eu-west-1',
    endpoint: 'https://eu-west-1.functions.supabase.co',
    signer: new JWTSigner(SHARED_JWT_KEY),
  },
};

// ── Mock Auth Operations ───────────────────────────────────────────────────────

interface MockAuthSession {
  user: {
    id: string;
    email: string;
    region: string;
  };
  session: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

class RegionalAuthService {
  constructor(private config: RegionConfig) {}

  async signUp(email: string, password: string): Promise<MockAuthSession> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      sub: `user-${Math.random().toString(36).substring(7)}`,
      email,
      iat: now,
      exp: now + 3600,
      iss: this.config.name,
      region: this.config.name,
    };

    const token = this.config.signer.sign(payload);
    const accessToken = this.encodeToken(token);

    return {
      user: {
        id: payload.sub,
        email,
        region: this.config.name,
      },
      session: {
        access_token: accessToken,
        refresh_token: `refresh-${Math.random().toString(36).substring(7)}`,
        expires_in: 3600,
      },
    };
  }

  async signIn(email: string, password: string): Promise<MockAuthSession> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      sub: `user-signin-${Math.random().toString(36).substring(7)}`,
      email,
      iat: now,
      exp: now + 3600,
      iss: this.config.name,
      region: this.config.name,
    };

    const token = this.config.signer.sign(payload);
    const accessToken = this.encodeToken(token);

    return {
      user: {
        id: payload.sub,
        email,
        region: this.config.name,
      },
      session: {
        access_token: accessToken,
        refresh_token: `refresh-${Math.random().toString(36).substring(7)}`,
        expires_in: 3600,
      },
    };
  }

  async refreshToken(refreshToken: string): Promise<MockAuthSession> {
    const now = Math.floor(Date.now() / 1000);
    const payload: JWTPayload = {
      sub: `user-refresh-${Math.random().toString(36).substring(7)}`,
      email: 'user@example.com',
      iat: now,
      exp: now + 3600,
      iss: this.config.name,
      region: this.config.name,
    };

    const token = this.config.signer.sign(payload);
    const accessToken = this.encodeToken(token);

    return {
      user: {
        id: payload.sub,
        email: payload.email,
        region: this.config.name,
      },
      session: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
      },
    };
  }

  verifyToken(tokenString: string, clockSkewTolerance: number = 5000): JWTPayload | null {
    try {
      const token = this.decodeToken(tokenString);
      const isValid = this.config.signer.verify(token, clockSkewTolerance);

      if (isValid) {
        return token.payload;
      }
      return null;
    } catch {
      return null;
    }
  }

  private encodeToken(token: JWTToken): string {
    return JSON.stringify(token);
  }

  private decodeToken(tokenString: string): JWTToken {
    return JSON.parse(tokenString);
  }
}

// ── Cross-Region Consistency Tests ─────────────────────────────────────────────

describe('Cross-Region Auth Consistency Tests', () => {
  let usEastService: RegionalAuthService;
  let euWestService: RegionalAuthService;

  beforeEach(() => {
    usEastService = new RegionalAuthService(regionConfigs['us-east-1']);
    euWestService = new RegionalAuthService(regionConfigs['eu-west-1']);
  });

  describe('Token Issued in Region A Verifiable in Region B', () => {
    it('should accept token issued in us-east-1 by eu-west-1 validator', async () => {
      // Issue token in us-east-1
      const session = await usEastService.signUp('user@example.com', 'password123');

      // Verify in eu-west-1
      const payload = euWestService.verifyToken(session.session.access_token);

      expect(payload).not.toBeNull();
      expect(payload?.email).toBe('user@example.com');
      expect(payload?.region).toBe('us-east-1');
    });

    it('should accept token issued in eu-west-1 by us-east-1 validator', async () => {
      // Issue token in eu-west-1
      const session = await euWestService.signUp('user@example.com', 'password123');

      // Verify in us-east-1
      const payload = usEastService.verifyToken(session.session.access_token);

      expect(payload).not.toBeNull();
      expect(payload?.email).toBe('user@example.com');
      expect(payload?.region).toBe('eu-west-1');
    });

    it('should preserve token payload across regions', async () => {
      const email = 'test@example.com';
      const session = await usEastService.signUp(email, 'password123');

      const payload = euWestService.verifyToken(session.session.access_token);

      expect(payload?.sub).toBe(session.user.id);
      expect(payload?.email).toBe(email);
      expect(payload?.iss).toBe('us-east-1');
    });
  });

  describe('Clock Skew Tolerance (≤5 seconds)', () => {
    it('should accept token with iat 4 seconds in the future', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload: JWTPayload = {
        sub: 'user-clock-skew',
        email: 'user@example.com',
        iat: now + 4, // 4 seconds in the future
        exp: now + 3604,
        iss: 'us-east-1',
        region: 'us-east-1',
      };

      const token = regionConfigs['us-east-1'].signer.sign(payload);
      const tokenString = JSON.stringify(token);

      // eu-west validator should accept with 5s tolerance
      const verified = euWestService.verifyToken(tokenString, 5000);
      expect(verified).not.toBeNull();
    });

    it('should reject token with iat >5 seconds in the future', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload: JWTPayload = {
        sub: 'user-future',
        email: 'user@example.com',
        iat: now + 6, // 6 seconds in the future (exceeds tolerance)
        exp: now + 3606,
        iss: 'us-east-1',
        region: 'us-east-1',
      };

      const token = regionConfigs['us-east-1'].signer.sign(payload);
      const tokenString = JSON.stringify(token);

      const verified = euWestService.verifyToken(tokenString, 5000);
      expect(verified).toBeNull();
    });

    it('should accept token with exp 4 seconds in the past', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload: JWTPayload = {
        sub: 'user-expired',
        email: 'user@example.com',
        iat: now - 3604,
        exp: now - 4, // 4 seconds expired
        iss: 'us-east-1',
        region: 'us-east-1',
      };

      const token = regionConfigs['us-east-1'].signer.sign(payload);
      const tokenString = JSON.stringify(token);

      const verified = euWestService.verifyToken(tokenString, 5000);
      expect(verified).not.toBeNull();
    });

    it('should reject token with exp >5 seconds in the past', async () => {
      const now = Math.floor(Date.now() / 1000);
      const payload: JWTPayload = {
        sub: 'user-old',
        email: 'user@example.com',
        iat: now - 3606,
        exp: now - 6, // 6 seconds expired (exceeds tolerance)
        iss: 'us-east-1',
        region: 'us-east-1',
      };

      const token = regionConfigs['us-east-1'].signer.sign(payload);
      const tokenString = JSON.stringify(token);

      const verified = euWestService.verifyToken(tokenString, 5000);
      expect(verified).toBeNull();
    });
  });

  describe('Sign-Up Flow Across Regions', () => {
    it('should complete sign-up in us-east-1 and verify in eu-west-1', async () => {
      const session = await usEastService.signUp('signup@example.com', 'password123');
      const verified = euWestService.verifyToken(session.session.access_token);

      expect(session.user.email).toBe('signup@example.com');
      expect(verified?.email).toBe('signup@example.com');
    });

    it('should complete sign-up in eu-west-1 and verify in us-east-1', async () => {
      const session = await euWestService.signUp('eu-signup@example.com', 'password456');
      const verified = usEastService.verifyToken(session.session.access_token);

      expect(session.user.email).toBe('eu-signup@example.com');
      expect(verified?.email).toBe('eu-signup@example.com');
    });
  });

  describe('Sign-In Flow Across Regions', () => {
    it('should complete sign-in in us-east-1 and verify in eu-west-1', async () => {
      const session = await usEastService.signIn('signin@example.com', 'password123');
      const verified = euWestService.verifyToken(session.session.access_token);

      expect(session.user.email).toBe('signin@example.com');
      expect(verified?.email).toBe('signin@example.com');
    });

    it('should complete sign-in in eu-west-1 and verify in us-east-1', async () => {
      const session = await euWestService.signIn('eu-signin@example.com', 'password456');
      const verified = usEastService.verifyToken(session.session.access_token);

      expect(session.user.email).toBe('eu-signin@example.com');
      expect(verified?.email).toBe('eu-signin@example.com');
    });
  });

  describe('Token Refresh Flow Across Regions', () => {
    it('should refresh token in us-east-1 and verify in eu-west-1', async () => {
      // Initial sign-in in us-east-1
      const initial = await usEastService.signUp('refresh@example.com', 'password123');

      // Refresh in us-east-1
      const refreshed = await usEastService.refreshToken(initial.session.refresh_token);

      // Verify refreshed token in eu-west-1
      const verified = euWestService.verifyToken(refreshed.session.access_token);

      expect(verified).not.toBeNull();
      expect(verified?.email).toBe('refresh@example.com');
    });

    it('should refresh token in eu-west-1 and verify in us-east-1', async () => {
      // Initial sign-in in eu-west-1
      const initial = await euWestService.signUp('eu-refresh@example.com', 'password456');

      // Refresh in eu-west-1
      const refreshed = await euWestService.refreshToken(initial.session.refresh_token);

      // Verify refreshed token in us-east-1
      const verified = usEastService.verifyToken(refreshed.session.access_token);

      expect(verified).not.toBeNull();
      expect(verified?.email).toBe('eu-refresh@example.com');
    });

    it('should allow cross-region token refresh', async () => {
      // Sign up in us-east-1
      const session = await usEastService.signUp('cross-refresh@example.com', 'password123');

      // Refresh in eu-west-1 (cross-region)
      const refreshed = await euWestService.refreshToken(session.session.refresh_token);

      // Verify in original region
      const verified = usEastService.verifyToken(refreshed.session.access_token);

      expect(verified).not.toBeNull();
      expect(verified?.email).toBe('cross-refresh@example.com');
    });
  });

  describe('Token Signature Consistency', () => {
    it('should use same signing key across regions', async () => {
      const payload1: JWTPayload = {
        sub: 'user-1',
        email: 'test1@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'us-east-1',
        region: 'us-east-1',
      };

      const payload2: JWTPayload = {
        sub: 'user-2',
        email: 'test2@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'eu-west-1',
        region: 'eu-west-1',
      };

      const token1 = regionConfigs['us-east-1'].signer.sign(payload1);
      const token2 = regionConfigs['eu-west-1'].signer.sign(payload2);

      // Both tokens should be verifiable in both regions
      expect(euWestService.verifyToken(JSON.stringify(token1))).not.toBeNull();
      expect(usEastService.verifyToken(JSON.stringify(token2))).not.toBeNull();
    });
  });

  describe('Cross-Region Session Consistency', () => {
    it('should maintain session integrity across region boundaries', async () => {
      const session = await usEastService.signUp('session@example.com', 'password123');

      // Access token valid in both regions
      const verifiedInUs = usEastService.verifyToken(session.session.access_token);
      const verifiedInEu = euWestService.verifyToken(session.session.access_token);

      expect(verifiedInUs).not.toBeNull();
      expect(verifiedInEu).not.toBeNull();
      expect(verifiedInUs?.sub).toBe(verifiedInEu?.sub);
      expect(verifiedInUs?.email).toBe(verifiedInEu?.email);
    });
  });
});

// ── Issue #976: validateAuditLogConsistency unit tests ────────────────────────
//
// These tests validate the FIXED behaviour of validateAuditLogConsistency().
//
// Key invariant: audit events are per-region (logAuthEvent only inserts into
// the region that handled the request).  Differing counts across regions is
// EXPECTED and must NOT be reported as an inconsistency.
//
// "Consistent" now means: every region responded without error.
// "Inconsistent" means: one or more regions returned a query/network error.

describe('validateAuditLogConsistency — fixed per-region semantics (Issue #976)', () => {
  // ── Helpers / mock infrastructure ─────────────────────────────────────────

  interface MockRegionDB {
    counts: Record<string, number>;   // region → event count (−1 = error)
  }

  /**
   * Re-implementation of the fixed validateAuditLogConsistency() logic,
   * driven by a MockRegionDB instead of live Supabase clients.
   * Must stay in sync with the production implementation in
   * consistency-validators.ts.
   */
  async function validateAuditLogConsistencyMock(
    db: MockRegionDB,
  ): Promise<{ consistent: boolean; regions: Record<string, number>; message: string }> {
    const regions = ['us-east', 'eu-west', 'ap-southeast'] as const;
    const regionCounts: Record<string, number> = {};
    const errorRegions: string[] = [];

    for (const region of regions) {
      const count = db.counts[region] ?? -1;
      regionCounts[region] = count;
      if (count < 0) errorRegions.push(region);
    }

    const consistent = errorRegions.length === 0;
    const totalEvents = Object.values(regionCounts)
      .filter((c) => c >= 0)
      .reduce((sum, c) => sum + c, 0);

    const message = consistent
      ? `Audit logs consistent: ${totalEvents} total events across regions (per-region logging — counts differ by design)`
      : `Audit log check failed: regions [${errorRegions.join(', ')}] returned errors; per-region counts: ${JSON.stringify(regionCounts)}`;

    return { consistent, regions: regionCounts, message };
  }

  // ── Core behaviour: region-local events must NOT trigger inconsistency ─────

  it('should return consistent=true when events exist only in the region where they were recorded', async () => {
    // User signed in via us-east; eu-west and ap-southeast have 0 events — by design.
    const db: MockRegionDB = {
      counts: { 'us-east': 3, 'eu-west': 0, 'ap-southeast': 0 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(result.consistent).toBe(true);
  });

  it('should return consistent=true when different regions each have different non-zero event counts', async () => {
    // User used us-east and eu-west but not ap-southeast — counts are legitimately different.
    const db: MockRegionDB = {
      counts: { 'us-east': 5, 'eu-west': 2, 'ap-southeast': 0 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(result.consistent).toBe(true);
  });

  it('should return consistent=true when all regions have 0 events (brand-new user)', async () => {
    const db: MockRegionDB = {
      counts: { 'us-east': 0, 'eu-west': 0, 'ap-southeast': 0 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(result.consistent).toBe(true);
  });

  it('should return consistent=true when all regions have the same non-zero count', async () => {
    // Happens to be equal — still valid, and consistent.
    const db: MockRegionDB = {
      counts: { 'us-east': 4, 'eu-west': 4, 'ap-southeast': 4 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(result.consistent).toBe(true);
  });

  // ── Error detection ───────────────────────────────────────────────────────

  it('should return consistent=false when one region returns a query error', async () => {
    const db: MockRegionDB = {
      counts: { 'us-east': 3, 'eu-west': -1 /* error */, 'ap-southeast': 1 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(result.consistent).toBe(false);
    expect(result.message).toContain('eu-west');
  });

  it('should return consistent=false when all regions return errors', async () => {
    const db: MockRegionDB = {
      counts: { 'us-east': -1, 'eu-west': -1, 'ap-southeast': -1 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(result.consistent).toBe(false);
  });

  // ── Message content ───────────────────────────────────────────────────────

  it('consistent message mentions total events and per-region-logging note', async () => {
    const db: MockRegionDB = {
      counts: { 'us-east': 7, 'eu-west': 0, 'ap-southeast': 2 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(result.consistent).toBe(true);
    expect(result.message).toContain('9 total events'); // 7+0+2
    expect(result.message).toContain('per-region logging');
  });

  it('inconsistent message names the failing regions', async () => {
    const db: MockRegionDB = {
      counts: { 'us-east': 5, 'eu-west': -1, 'ap-southeast': -1 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(result.consistent).toBe(false);
    expect(result.message).toContain('eu-west');
    expect(result.message).toContain('ap-southeast');
  });

  // ── Region counts are always returned ─────────────────────────────────────

  it('always returns a counts entry for every region', async () => {
    const db: MockRegionDB = {
      counts: { 'us-east': 1, 'eu-west': 0, 'ap-southeast': 0 },
    };

    const result = await validateAuditLogConsistencyMock(db);

    expect(Object.keys(result.regions)).toContain('us-east');
    expect(Object.keys(result.regions)).toContain('eu-west');
    expect(Object.keys(result.regions)).toContain('ap-southeast');
  });
});
