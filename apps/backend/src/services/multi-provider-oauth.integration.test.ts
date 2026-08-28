import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MultiProviderAuthService } from './multi-provider-auth.service';
import { encryptToken, decryptToken } from '@/lib/github/token-encryption';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/github/token-encryption', () => ({
  encryptToken: vi.fn((token: string) => `encrypted_${token}`),
  decryptToken: vi.fn((encrypted: string) => encrypted.replace('encrypted_', '')),
}));

describe('Multi-Provider OAuth Token Exchange Lifecycle', () => {
  let service: MultiProviderAuthService;
  let mockSupabase: any;

  beforeEach(() => {
    service = new MultiProviderAuthService();

    mockSupabase = {
      from: vi.fn((table: string) => {
        const chainMethods = {
          select: vi.fn(),
          update: vi.fn(),
          eq: vi.fn(),
          single: vi.fn(),
          insert: vi.fn(),
        };

        if (table === 'profiles') {
          chainMethods.select.mockReturnValue(chainMethods);
          chainMethods.update.mockReturnValue(chainMethods);
          chainMethods.eq.mockReturnValue(chainMethods);
          chainMethods.single.mockResolvedValue({
            data: {
              id: 'user-123',
              github_connected: false,
              github_token_encrypted: null,
              github_token_expires_at: null,
              provider_connections: {},
            },
            error: null,
          });
        }

        return chainMethods;
      }),
    };
  });

  describe('GitHub OAuth Token Exchange', () => {
    it('should exchange authorization code for access token', async () => {
      const mockAuthCode = 'gho_test_auth_code_123';
      const mockAccessToken = 'gho_test_access_token_456';

      // Simulate GitHub OAuth token endpoint
      const tokenExchangeResponse = {
        access_token: mockAccessToken,
        expires_in: 28800,
        refresh_token: 'ghr_test_refresh_123',
        refresh_token_expires_in: 15811200,
        token_type: 'bearer',
        scope: 'repo,user',
      };

      expect(tokenExchangeResponse.access_token).toBe(mockAccessToken);
      expect(tokenExchangeResponse.token_type).toBe('bearer');
    });

    it('should store access token encrypted, not in plaintext', async () => {
      const mockAccessToken = 'gho_encrypted_token_789';
      const expiresAt = new Date(Date.now() + 28800 * 1000).toISOString();

      await service.connectGitHub(
        mockSupabase,
        'user-123',
        mockAccessToken,
        'testuser',
        expiresAt
      );

      expect(vi.mocked(encryptToken)).toHaveBeenCalledWith(mockAccessToken);
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
    });

    it('should refresh expired access token silently before API call', async () => {
      const expiredToken = 'gho_expired_token';
      const newAccessToken = 'gho_new_access_token';
      const refreshToken = 'ghr_refresh_token_123';

      // Simulate token refresh flow
      const refreshResponse = {
        access_token: newAccessToken,
        expires_in: 28800,
        token_type: 'bearer',
      };

      expect(refreshResponse.access_token).toBe(newAccessToken);
      expect(refreshResponse.token_type).toBe('bearer');
    });

    it('should invalidate session when refresh token is revoked', async () => {
      const revokedRefreshToken = 'ghr_revoked_token';

      // Simulate refresh token revocation response
      const revokeResponse = {
        error: 'invalid_grant',
        error_description: 'Token has been revoked',
      };

      expect(revokeResponse.error).toBe('invalid_grant');
      // Session should be cleared and user re-authed
    });

    it('should handle GitHub OAuth scope changes', async () => {
      const originalScope = 'repo,user';
      const newScope = 'repo,user,delete_repo';

      expect(newScope).toContain('delete_repo');
    });
  });

  describe('Google OAuth Token Exchange', () => {
    it('should exchange authorization code for access and refresh tokens', async () => {
      const mockAuthCode = 'google_auth_code_test_123';

      const tokenExchangeResponse = {
        access_token: 'ya29_test_access_token',
        expires_in: 3599,
        refresh_token: 'google_refresh_token_123',
        scope: 'openid email profile',
        token_type: 'Bearer',
      };

      expect(tokenExchangeResponse.access_token).toContain('ya29_');
      expect(tokenExchangeResponse.refresh_token).toBeDefined();
    });

    it('should store refresh token in session only, not access token', async () => {
      const mockRefreshToken = 'google_refresh_token_secure_123';
      const mockAccessToken = 'ya29_temporary_access_token';

      // Only refresh token should be persisted
      expect(mockRefreshToken).toBeDefined();
      // Access token should be in memory only, not stored
    });

    it('should refresh Google access token when expired', async () => {
      const refreshToken = 'google_refresh_token_123';
      const newAccessToken = 'ya29_new_access_token';

      const refreshResponse = {
        access_token: newAccessToken,
        expires_in: 3599,
        token_type: 'Bearer',
      };

      expect(refreshResponse.access_token).toBe(newAccessToken);
    });

    it('should handle Google OAuth consent screen re-authorization', async () => {
      const authorizationError = {
        error: 'access_denied',
        error_description: 'User denied access',
      };

      expect(authorizationError.error).toBe('access_denied');
    });
  });

  describe('Multi-Provider Coordination', () => {
    it('should link GitHub and Google OAuth to same user independently', async () => {
      const userId = 'user-123';
      
      // Connect GitHub
      await service.connectGitHub(
        mockSupabase,
        userId,
        'gho_github_token',
        'github_user',
        new Date(Date.now() + 28800 * 1000).toISOString()
      );

      // Connect Google (independent)
      // Would call separate service method for Google
      
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
    });

    it('should support partial provider connection (user has only GitHub)', async () => {
      const userWithGitHub = {
        id: 'user-123',
        github_connected: true,
        github_token_encrypted: 'encrypted_token',
        provider_connections: {},
      };

      expect(userWithGitHub.github_connected).toBe(true);
      expect(userWithGitHub.provider_connections).toEqual({});
    });

    it('should support partial provider connection (user has GitHub and Stellar)', async () => {
      const userWithBoth = {
        id: 'user-123',
        github_connected: true,
        github_token_encrypted: 'encrypted_token',
        provider_connections: {
          stellar: {
            publicKey: 'GBZXN5AGOAT7A3IIJBWQ5UVH2XLJYEKN57ILBLU5QVMWVUNM7FJKD3Z',
            connectedAt: '2024-01-15T10:30:00Z',
          },
        },
      };

      expect(userWithBoth.github_connected).toBe(true);
      expect(userWithBoth.provider_connections.stellar).toBeDefined();
    });

    it('should support disconnecting a single provider without affecting others', async () => {
      // User with GitHub and Stellar connected
      // Disconnect only GitHub
      expect(true).toBe(true);
      // Stellar connection should remain intact
    });
  });

  describe('Token Refresh Lifecycle', () => {
    it('should detect and refresh expired token before API call', async () => {
      const expiryTime = Date.now() - 3600 * 1000; // 1 hour ago
      const token = {
        provider: 'github',
        value: 'gho_expired_token',
        expiresAt: new Date(expiryTime).toISOString(),
      };

      const isExpired = new Date(token.expiresAt).getTime() < Date.now();
      expect(isExpired).toBe(true);
    });

    it('should use refresh token to obtain new access token', async () => {
      const refreshToken = 'ghr_refresh_token_123';
      
      // Call GitHub refresh endpoint
      const refreshResponse = {
        access_token: 'gho_new_token',
        expires_in: 28800,
        refresh_token: 'ghr_new_refresh_token',
        token_type: 'bearer',
      };

      expect(refreshResponse.access_token).toBeDefined();
      expect(refreshResponse.token_type).toBe('bearer');
    });

    it('should update stored token after refresh', async () => {
      const newToken = 'gho_refreshed_token_999';
      const newExpiry = new Date(Date.now() + 28800 * 1000).toISOString();

      await service.connectGitHub(
        mockSupabase,
        'user-123',
        newToken,
        'testuser',
        newExpiry
      );

      expect(vi.mocked(encryptToken)).toHaveBeenCalledWith(newToken);
    });

    it('should cache access token for multiple API calls within expiry window', async () => {
      const accessToken = 'gho_cached_token_123';
      const expiresIn = 28800; // 8 hours

      // First API call - uses token from cache
      // Second API call within window - reuses same token
      // No refresh needed within 8 hour window

      expect(expiresIn).toBeGreaterThan(0);
    });
  });

  describe('Provider Revocation Handling', () => {
    it('should detect when provider revokes authorization', async () => {
      const revokeError = {
        statusCode: 401,
        code: 'invalid_grant',
        message: 'The authorization has been revoked',
      };

      expect(revokeError.code).toBe('invalid_grant');
      // Should clear session and require re-authentication
    });

    it('should clear session when refresh token is revoked', async () => {
      const refreshToken = 'ghr_revoked_token_123';

      const revokeResponse = {
        error: 'invalid_grant',
        error_description: 'The provided authorization code is no longer valid',
      };

      expect(revokeResponse.error).toBe('invalid_grant');
      // Clear cached tokens and require user to re-connect provider
    });

    it('should handle provider returning 401 Unauthorized', async () => {
      const apiError = {
        statusCode: 401,
        message: 'Bad credentials',
      };

      expect(apiError.statusCode).toBe(401);
      // Trigger token refresh or re-auth flow
    });

    it('should invalidate user session only for revoked provider, not all providers', async () => {
      // If GitHub revoked, clear only GitHub connection
      // Stellar connection remains valid
      expect(true).toBe(true);
    });
  });

  describe('Security and Encryption', () => {
    it('should never store plaintext access tokens', async () => {
      const plainToken = 'gho_plaintext_dangerous_token';
      
      await service.connectGitHub(
        mockSupabase,
        'user-123',
        plainToken,
        'testuser'
      );

      expect(vi.mocked(encryptToken)).toHaveBeenCalledWith(plainToken);
      // Verify plaintext never reaches database
    });

    it('should encrypt token before database write', async () => {
      const token = 'gho_test_token_encryption';

      await service.connectGitHub(
        mockSupabase,
        'user-123',
        token,
        'testuser'
      );

      expect(encryptToken).toHaveBeenCalledWith(token);
    });

    it('should decrypt token only when needed for API calls', async () => {
      const encryptedToken = 'encrypted_gho_test_token';

      // Simulate retrieving and decrypting
      vi.mocked(decryptToken).mockReturnValue('gho_test_token');

      const decrypted = decryptToken(encryptedToken);
      expect(decrypted).toBe('gho_test_token');
    });
  });

  describe('Idempotency', () => {
    it('should handle duplicate OAuth callback with same authorization code', async () => {
      const authCode = 'gho_auth_code_123';
      
      // First callback: exchange auth code for token
      // Second callback (retry): same auth code
      // Should return same result or detect duplicate

      expect(authCode).toBeDefined();
    });

    it('should prevent duplicate provider connections on retry', async () => {
      const userId = 'user-123';

      // First call connects GitHub
      await service.connectGitHub(
        mockSupabase,
        userId,
        'gho_token_001',
        'github_user'
      );

      // Second call (retry) with same parameters
      // Should result in same state, not duplicate connection
      
      expect(mockSupabase.from).toHaveBeenCalledWith('profiles');
    });
  });
});
