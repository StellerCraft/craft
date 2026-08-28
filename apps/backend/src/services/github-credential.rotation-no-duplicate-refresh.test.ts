/**
 * Unit test for GitHub token rotation retry logic
 *
 * Verifies that if rotateToken succeeds but metadata-update fails,
 * refreshFn is not called again on retry. Only the non-critical
 * metadata write and revocation are retried, not the token refresh.
 *
 * Issue: #894
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GitHubCredentialService } from './github-credential.service';

let refreshFnCallCount = 0;
let rotateTokenCallCount = 0;
let updateCallCount = 0;

const createMockSupabase = (): Partial<SupabaseClient> => {
  let metadataUpdateShouldFail = true;

  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === 'profiles') {
              return {
                data: {
                  github_token_encrypted: 'encrypted-token-old',
                  github_token_expires_at: new Date(
                    Date.now() + 30 * 60 * 1000
                  ).toISOString(),
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: () => ({
        eq: () => {
          updateCallCount++;
          // First update is from rotateToken - always succeeds
          // Subsequent updates are metadata write - fail once then succeed
          if (updateCallCount === 1) {
            return {
              error: null,
              then: async (cb: any) => cb?.({ data: null, error: null }),
            };
          }
          if (metadataUpdateShouldFail) {
            metadataUpdateShouldFail = false;
            return {
              error: { message: 'Transient DB error' },
              then: async () => {
                throw new Error('Transient DB error');
              },
            };
          }
          return {
            error: null,
            then: async (cb: any) => cb?.({ data: null, error: null }),
          };
        },
      }),
    }),
  } as any;
};

const createMockFetch = () => {
  return async () => {
    const response = new Response('{}', { status: 200 });
    return response;
  };
};

vi.mock('@/lib/github/token-encryption', () => ({
  encryptToken: (token: string) => `encrypted-${token}`,
  decryptToken: (encrypted: string) => encrypted.replace('encrypted-', ''),
}));

describe('GitHubCredentialService – token rotation retry logic', () => {
  beforeEach(() => {
    refreshFnCallCount = 0;
    rotateTokenCallCount = 0;
    updateCallCount = 0;
  });

  it('does not call refreshFn again if rotation already succeeded but metadata write fails', async () => {
    const mockSupabase = createMockSupabase();
    const mockFetch = createMockFetch();

    const refreshFn = async () => {
      refreshFnCallCount++;
      return {
        token: `new-token-${refreshFnCallCount}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };
    };

    const service = new GitHubCredentialService(mockSupabase as any, mockFetch);

    // Spy on rotateToken to track calls
    const rotateSpy = vi.spyOn(service as any, 'rotateToken');
    rotateSpy.mockImplementation(
      async (userId: string, token: string, expiresAt?: Date) => {
        rotateTokenCallCount++;
        // Simulate successful token storage
        return token;
      }
    );

    const result = await service.rotateIfExpiringSoon('user-123', refreshFn);

    // Should eventually succeed (metadata write succeeds on retry)
    expect(result).toBe(true);

    // refreshFn should be called exactly once
    expect(refreshFnCallCount).toBe(1);

    // rotateToken should be called exactly once
    expect(rotateTokenCallCount).toBe(1);

    // metadata update should be attempted twice (fail, then succeed)
    expect(updateCallCount).toBeGreaterThan(1);
  });

  it('returns true when rotation succeeds even if metadata write fails all retries', async () => {
    const mockSupabase = createMockSupabase();
    const mockFetch = createMockFetch();

    const refreshFn = async () => {
      refreshFnCallCount++;
      return {
        token: 'new-token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      };
    };

    const service = new GitHubCredentialService(mockSupabase as any, mockFetch);

    const rotateSpy = vi.spyOn(service as any, 'rotateToken');
    rotateSpy.mockImplementation(async () => 'new-token');

    // Mock update to always fail for metadata
    const mockSupabaseAlwaysFail = {
      ...mockSupabase,
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            single: async () => {
              if (table === 'profiles') {
                return {
                  data: {
                    github_token_encrypted: 'encrypted-old',
                    github_token_expires_at: new Date(
                      Date.now() + 30 * 60 * 1000
                    ).toISOString(),
                  },
                  error: null,
                };
              }
              return { data: null, error: null };
            },
          }),
        }),
        update: () => ({
          eq: () => {
            return {
              error: new Error('Persistent DB error'),
              then: async () => {
                throw new Error('Persistent DB error');
              },
            };
          },
        }),
      }),
    } as any;

    const serviceAlwaysFail = new GitHubCredentialService(mockSupabaseAlwaysFail, mockFetch);
    const rotateSpy2 = vi.spyOn(serviceAlwaysFail as any, 'rotateToken');
    rotateSpy2.mockImplementation(async () => 'new-token');

    const result = await serviceAlwaysFail.rotateIfExpiringSoon('user-456', refreshFn);

    // Should still return true because rotation succeeded
    expect(result).toBe(true);
  });
});
