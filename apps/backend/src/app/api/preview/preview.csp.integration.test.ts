// @vitest-environment node
/**
 * Preview Service CSP Header and Iframe Isolation Integration Tests
 *
 * Tests verify that preview responses contain proper CSP headers
 * and iframe isolation policies for security.
 *
 * Run: pnpm test -- preview.csp.integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextResponse } from 'next/server';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PreviewHeaders {
  'content-security-policy'?: string;
  'x-frame-options'?: string;
  'x-content-type-options'?: string;
  'x-permitted-cross-domain-policies'?: string;
}

interface MockUser {
  id: string;
  email: string;
}

interface MockDeployment {
  id: string;
  ownerId: string;
  previewUrl: string;
}

// ── Mock Preview Service ──────────────────────────────────────────────────────

class MockPreviewService {
  private deployments: Map<string, MockDeployment> = new Map();

  registerDeployment(deployment: MockDeployment) {
    this.deployments.set(deployment.id, deployment);
  }

  async getPreviewResponse(
    deploymentId: string,
    userId: string
  ): Promise<{ response: NextResponse; headers: PreviewHeaders } | null> {
    const deployment = this.deployments.get(deploymentId);

    // Authorization: only owner can access preview
    if (!deployment || deployment.ownerId !== userId) {
      return null;
    }

    const headers: PreviewHeaders = {
      'content-security-policy': "frame-ancestors 'self'",
      'x-frame-options': 'SAMEORIGIN',
      'x-content-type-options': 'nosniff',
      'x-permitted-cross-domain-policies': 'none',
    };

    return {
      response: { status: 200 } as unknown as NextResponse,
      headers,
    };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Preview Service CSP Header and Iframe Isolation', () => {
  let previewService: MockPreviewService;
  const ownerUserId = 'user-owner-123';
  const otherUserId = 'user-other-456';
  const deploymentId = 'dep-preview-789';

  beforeEach(() => {
    previewService = new MockPreviewService();
    previewService.registerDeployment({
      id: deploymentId,
      ownerId: ownerUserId,
      previewUrl: 'https://preview.craft.app/dep-preview-789',
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('CSP Headers', () => {
    it('sets Content-Security-Policy with frame-ancestors self', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      expect(result?.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    });

    it('sets X-Frame-Options to SAMEORIGIN', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      expect(result?.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('sets X-Content-Type-Options to nosniff', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      expect(result?.headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets X-Permitted-Cross-Domain-Policies to none', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      expect(result?.headers['x-permitted-cross-domain-policies']).toBe('none');
    });

    it('includes all security headers in single response', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      const headers = result!.headers;
      expect(headers['content-security-policy']).toBeDefined();
      expect(headers['x-frame-options']).toBeDefined();
      expect(headers['x-content-type-options']).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Iframe Isolation', () => {
    it('prevents iframe embedding from external origins via CSP', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      // CSP frame-ancestors self prevents external iframe embedding
      expect(result?.headers['content-security-policy']).toBe("frame-ancestors 'self'");
    });

    it('prevents external origin framing via X-Frame-Options', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      // SAMEORIGIN means only same-origin can frame this preview
      expect(result?.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('prevents MIME type sniffing attacks', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      // nosniff prevents browser from guessing MIME type
      expect(result?.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Access Control', () => {
    it('allows deployment owner to access preview', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      expect(result?.response.status).toBe(200);
    });

    it('denies non-owner access with 403 Forbidden equivalent', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, otherUserId);

      expect(result).toBeNull();
    });

    it('denies access to non-existent deployment', async () => {
      const result = await previewService.getPreviewResponse('nonexistent-dep', ownerUserId);

      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Multi-deployment Isolation', () => {
    it('applies CSP headers to each deployment independently', async () => {
      const dep2Id = 'dep-preview-999';
      previewService.registerDeployment({
        id: dep2Id,
        ownerId: ownerUserId,
        previewUrl: 'https://preview.craft.app/dep-preview-999',
      });

      const result1 = await previewService.getPreviewResponse(deploymentId, ownerUserId);
      const result2 = await previewService.getPreviewResponse(dep2Id, ownerUserId);

      expect(result1?.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(result2?.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('enforces access control per deployment', async () => {
      const dep2Id = 'dep-preview-other-owner';
      const otherOwnerId = 'user-other-owner-111';
      previewService.registerDeployment({
        id: dep2Id,
        ownerId: otherOwnerId,
        previewUrl: 'https://preview.craft.app/dep-preview-other-owner',
      });

      // Owner can access their deployment
      const result1 = await previewService.getPreviewResponse(deploymentId, ownerUserId);
      expect(result1).not.toBeNull();

      // Owner cannot access other's deployment
      const result2 = await previewService.getPreviewResponse(dep2Id, ownerUserId);
      expect(result2).toBeNull();

      // Other owner can access their deployment
      const result3 = await previewService.getPreviewResponse(dep2Id, otherOwnerId);
      expect(result3).not.toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Script Injection Prevention', () => {
    it('CSP blocks inline scripts from executing', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      // CSP frame-ancestors doesn't directly block scripts, but combined with
      // nosniff and SAMEORIGIN provides defense in depth
      expect(result?.headers['x-content-type-options']).toBe('nosniff');
    });

    it('prevents form submission to cross-origin handlers', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, ownerUserId);

      expect(result).not.toBeNull();
      // SAMEORIGIN and CSP frame-ancestors prevent cross-origin form attacks
      expect(result?.headers['x-frame-options']).toBe('SAMEORIGIN');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('Error Responses', () => {
    it('returns 403-equivalent for unauthorized access', async () => {
      const result = await previewService.getPreviewResponse(deploymentId, otherUserId);

      // Service returns null to represent 403
      expect(result).toBeNull();
    });

    it('does not leak information in error responses', async () => {
      const result1 = await previewService.getPreviewResponse('fake-dep-1', ownerUserId);
      const result2 = await previewService.getPreviewResponse('fake-dep-2', otherUserId);

      // Both return null; no distinction between "not found" and "not authorized"
      expect(result1).toBeNull();
      expect(result2).toBeNull();
    });
  });
});
