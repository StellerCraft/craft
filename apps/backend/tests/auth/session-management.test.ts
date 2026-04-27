/**
 * User Session Management Tests (#377)
 *
 * Tests for user session lifecycle:
 * - Session creation and validation
 * - Session timeout behavior
 * - Session renewal
 * - Concurrent session handling
 * - Session revocation
 *
 * Run: vitest run tests/auth/session-management.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  userId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  revoked: boolean;
  metadata?: Record<string, unknown>;
}

interface SessionConfig {
  /** Session TTL in milliseconds */
  ttlMs: number;
  /** Max concurrent sessions per user */
  maxConcurrentSessions: number;
  /** Inactivity timeout in milliseconds (0 = disabled) */
  inactivityTimeoutMs: number;
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

class SessionManager {
  private sessions = new Map<string, Session>();
  private idCounter = 0;

  constructor(private readonly config: SessionConfig) {}

  private nextId(): string {
    return `sess_${++this.idCounter}`;
  }

  private token(): string {
    return `tok_${Math.random().toString(36).slice(2)}_${this.idCounter}`;
  }

  create(userId: string, metadata?: Record<string, unknown>, now: Date = new Date()): Session {
    if (!userId) throw new Error('userId is required');

    // Enforce concurrent session limit
    const active = this.getActiveSessions(userId, now);
    if (active.length >= this.config.maxConcurrentSessions) {
      // Evict the oldest session
      const oldest = active.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      this.revoke(oldest.id);
    }

    const session: Session = {
      id: this.nextId(),
      userId,
      token: this.token(),
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.ttlMs),
      lastActivityAt: now,
      revoked: false,
      metadata,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  validate(sessionId: string, now: Date = new Date()): { valid: boolean; reason?: string } {
    const session = this.sessions.get(sessionId);
    if (!session) return { valid: false, reason: 'Session not found' };
    if (session.revoked) return { valid: false, reason: 'Session revoked' };
    if (now >= session.expiresAt) return { valid: false, reason: 'Session expired' };

    if (this.config.inactivityTimeoutMs > 0) {
      const inactiveSince = now.getTime() - session.lastActivityAt.getTime();
      if (inactiveSince >= this.config.inactivityTimeoutMs) {
        return { valid: false, reason: 'Session inactive timeout' };
      }
    }

    return { valid: true };
  }

  touch(sessionId: string, now: Date = new Date()): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.revoked) return false;
    session.lastActivityAt = now;
    return true;
  }

  renew(sessionId: string, now: Date = new Date()): Session | null {
    const check = this.validate(sessionId, now);
    if (!check.valid) return null;

    const session = this.sessions.get(sessionId)!;
    session.expiresAt = new Date(now.getTime() + this.config.ttlMs);
    session.lastActivityAt = now;
    return session;
  }

  revoke(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.revoked = true;
    return true;
  }

  revokeAll(userId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revoked) {
        session.revoked = true;
        count++;
      }
    }
    return count;
  }

  getActiveSessions(userId: string, now: Date = new Date()): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.userId === userId && !s.revoked && now < s.expiresAt
    );
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msFromNow(ms: number, base: Date = new Date()): Date {
  return new Date(base.getTime() + ms);
}

const DEFAULT_CONFIG: SessionConfig = {
  ttlMs: 60 * 60 * 1000, // 1 hour
  maxConcurrentSessions: 3,
  inactivityTimeoutMs: 15 * 60 * 1000, // 15 minutes
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('User Session Management', () => {
  let manager: SessionManager;
  const userId = 'user_abc123';

  beforeEach(() => {
    manager = new SessionManager(DEFAULT_CONFIG);
  });

  // -------------------------------------------------------------------------
  describe('Session Creation', () => {
    it('creates a session with required fields', () => {
      const session = manager.create(userId);

      expect(session.id).toMatch(/^sess_/);
      expect(session.userId).toBe(userId);
      expect(session.token).toMatch(/^tok_/);
      expect(session.revoked).toBe(false);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
    });

    it('sets expiresAt based on TTL', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const session = manager.create(userId, undefined, now);

      const expectedExpiry = new Date(now.getTime() + DEFAULT_CONFIG.ttlMs);
      expect(session.expiresAt.getTime()).toBe(expectedExpiry.getTime());
    });

    it('throws when userId is missing', () => {
      expect(() => manager.create('')).toThrow('userId is required');
    });

    it('stores optional metadata', () => {
      const meta = { ip: '127.0.0.1', userAgent: 'Mozilla/5.0' };
      const session = manager.create(userId, meta);
      expect(session.metadata).toEqual(meta);
    });

    it('generates unique tokens per session', () => {
      const s1 = manager.create(userId);
      const s2 = manager.create(userId);
      expect(s1.token).not.toBe(s2.token);
    });
  });

  // -------------------------------------------------------------------------
  describe('Session Validation', () => {
    it('validates an active session', () => {
      const session = manager.create(userId);
      const result = manager.validate(session.id);
      expect(result.valid).toBe(true);
    });

    it('rejects a non-existent session', () => {
      const result = manager.validate('sess_nonexistent');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('rejects an expired session', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const session = manager.create(userId, undefined, now);

      const future = msFromNow(DEFAULT_CONFIG.ttlMs + 1, now);
      const result = manager.validate(session.id, future);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('rejects a revoked session', () => {
      const session = manager.create(userId);
      manager.revoke(session.id);

      const result = manager.validate(session.id);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('revoked');
    });

    it('rejects a session that exceeded inactivity timeout', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const session = manager.create(userId, undefined, now);

      const inactive = msFromNow(DEFAULT_CONFIG.inactivityTimeoutMs + 1, now);
      const result = manager.validate(session.id, inactive);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('inactive');
    });

    it('accepts a session that was recently touched', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const session = manager.create(userId, undefined, now);

      // Touch just before inactivity timeout
      const touchTime = msFromNow(DEFAULT_CONFIG.inactivityTimeoutMs - 1000, now);
      manager.touch(session.id, touchTime);

      // Validate just after original inactivity window (but within touched window)
      const checkTime = msFromNow(DEFAULT_CONFIG.inactivityTimeoutMs + 500, now);
      const result = manager.validate(session.id, checkTime);

      expect(result.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('Session Timeout', () => {
    it('expires after TTL elapses', () => {
      const now = new Date();
      const session = manager.create(userId, undefined, now);

      const afterExpiry = msFromNow(DEFAULT_CONFIG.ttlMs + 1, now);
      expect(manager.validate(session.id, afterExpiry).valid).toBe(false);
    });

    it('is still valid just before TTL', () => {
      const now = new Date();
      const session = manager.create(userId, undefined, now);

      // Keep touching to prevent inactivity timeout; check 1ms before TTL expires
      const justBefore = msFromNow(DEFAULT_CONFIG.ttlMs - 1, now);
      manager.touch(session.id, justBefore);
      expect(manager.validate(session.id, justBefore).valid).toBe(true);
    });

    it('inactivity timeout is independent of TTL', () => {
      const mgr = new SessionManager({ ...DEFAULT_CONFIG, inactivityTimeoutMs: 5 * 60 * 1000 });
      const now = new Date();
      const session = mgr.create(userId, undefined, now);

      // 6 minutes of inactivity — within TTL but past inactivity timeout
      const check = msFromNow(6 * 60 * 1000, now);
      expect(mgr.validate(session.id, check).valid).toBe(false);
    });

    it('no inactivity timeout when inactivityTimeoutMs is 0', () => {
      const mgr = new SessionManager({ ...DEFAULT_CONFIG, inactivityTimeoutMs: 0 });
      const now = new Date();
      const session = mgr.create(userId, undefined, now);

      // Long inactivity but still within TTL
      const check = msFromNow(DEFAULT_CONFIG.ttlMs - 1, now);
      expect(mgr.validate(session.id, check).valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('Session Renewal', () => {
    it('extends expiresAt on renewal', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const session = manager.create(userId, undefined, now);
      const originalExpiry = session.expiresAt.getTime();

      // Touch at 14 min to stay within inactivity window, then renew at 14 min
      const renewTime = msFromNow(14 * 60 * 1000, now);
      manager.touch(session.id, renewTime);
      const renewed = manager.renew(session.id, renewTime);

      expect(renewed).not.toBeNull();
      expect(renewed!.expiresAt.getTime()).toBeGreaterThan(originalExpiry);
      expect(renewed!.expiresAt.getTime()).toBe(renewTime.getTime() + DEFAULT_CONFIG.ttlMs);
    });

    it('returns null when renewing an expired session', () => {
      const now = new Date();
      const session = manager.create(userId, undefined, now);

      const afterExpiry = msFromNow(DEFAULT_CONFIG.ttlMs + 1, now);
      const result = manager.renew(session.id, afterExpiry);

      expect(result).toBeNull();
    });

    it('returns null when renewing a revoked session', () => {
      const session = manager.create(userId);
      manager.revoke(session.id);

      expect(manager.renew(session.id)).toBeNull();
    });

    it('updates lastActivityAt on renewal', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const session = manager.create(userId, undefined, now);

      const renewTime = msFromNow(10 * 60 * 1000, now);
      manager.renew(session.id, renewTime);

      expect(manager.getSession(session.id)!.lastActivityAt.getTime()).toBe(renewTime.getTime());
    });
  });

  // -------------------------------------------------------------------------
  describe('Concurrent Session Handling', () => {
    it('allows up to maxConcurrentSessions', () => {
      for (let i = 0; i < DEFAULT_CONFIG.maxConcurrentSessions; i++) {
        manager.create(userId);
      }
      expect(manager.getActiveSessions(userId)).toHaveLength(DEFAULT_CONFIG.maxConcurrentSessions);
    });

    it('evicts the oldest session when limit is exceeded', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const s1 = manager.create(userId, undefined, now);
      manager.create(userId, undefined, msFromNow(1000, now));
      manager.create(userId, undefined, msFromNow(2000, now));

      // Creating a 4th session should evict s1
      const t4 = msFromNow(3000, now);
      manager.create(userId, undefined, t4);

      expect(manager.getSession(s1.id)!.revoked).toBe(true);
      expect(manager.getActiveSessions(userId, t4)).toHaveLength(DEFAULT_CONFIG.maxConcurrentSessions);
    });

    it('counts only active (non-expired, non-revoked) sessions', () => {
      const now = new Date('2024-01-15T10:00:00Z');
      const s1 = manager.create(userId, undefined, now);
      manager.revoke(s1.id);
      manager.create(userId, undefined, now);

      expect(manager.getActiveSessions(userId, now)).toHaveLength(1);
    });

    it('supports independent sessions for different users', () => {
      const user2 = 'user_xyz789';
      for (let i = 0; i < DEFAULT_CONFIG.maxConcurrentSessions; i++) {
        manager.create(userId);
        manager.create(user2);
      }

      expect(manager.getActiveSessions(userId)).toHaveLength(DEFAULT_CONFIG.maxConcurrentSessions);
      expect(manager.getActiveSessions(user2)).toHaveLength(DEFAULT_CONFIG.maxConcurrentSessions);
    });
  });

  // -------------------------------------------------------------------------
  describe('Session Revocation', () => {
    it('revokes a single session', () => {
      const session = manager.create(userId);
      const result = manager.revoke(session.id);

      expect(result).toBe(true);
      expect(manager.getSession(session.id)!.revoked).toBe(true);
    });

    it('returns false when revoking a non-existent session', () => {
      expect(manager.revoke('sess_nonexistent')).toBe(false);
    });

    it('revokes all sessions for a user', () => {
      manager.create(userId);
      manager.create(userId);
      manager.create(userId);

      const count = manager.revokeAll(userId);
      expect(count).toBe(3);
      expect(manager.getActiveSessions(userId)).toHaveLength(0);
    });

    it('revokeAll does not affect other users', () => {
      const user2 = 'user_other';
      manager.create(userId);
      manager.create(user2);

      manager.revokeAll(userId);

      expect(manager.getActiveSessions(user2)).toHaveLength(1);
    });

    it('revokeAll returns 0 when user has no active sessions', () => {
      expect(manager.revokeAll('user_no_sessions')).toBe(0);
    });
  });
});
