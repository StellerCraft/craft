import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseGrantedScopes,
  validateScopes,
  fetchAndValidateScopes,
  clearScopeValidationCache,
  REQUIRED_SCOPES,
  MAX_SCOPE_VALIDATION_CACHE_ENTRIES,
} from './scope-validator';

vi.stubGlobal('fetch', vi.fn());

describe('scope-validator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearScopeValidationCache();
  });

  afterEach(() => {
    clearScopeValidationCache();
  });

  describe('parseGrantedScopes', () => {
    it('parses a comma-separated header value', () => {
      const result = parseGrantedScopes('repo, read:user');
      expect(result).toEqual(['repo', 'read:user']);
    });

    it('handles a single scope', () => {
      const result = parseGrantedScopes('repo');
      expect(result).toEqual(['repo']);
    });

    it('trims whitespace', () => {
      const result = parseGrantedScopes('  repo  ,  read:user  ');
      expect(result).toEqual(['repo', 'read:user']);
    });

    it('returns an empty array for null', () => {
      const result = parseGrantedScopes(null);
      expect(result).toEqual([]);
    });

    it('returns an empty array for empty string', () => {
      const result = parseGrantedScopes('');
      expect(result).toEqual([]);
    });

    it('filters out empty values', () => {
      const result = parseGrantedScopes('repo,,read:user');
      expect(result).toEqual(['repo', 'read:user']);
    });
  });

  describe('validateScopes', () => {
    it('returns valid when all required scopes are present', () => {
      const result = validateScopes(['repo', 'read:user']);
      expect(result.valid).toBe(true);
      expect(result.missingScopes).toEqual([]);
    });

    it('returns invalid with missing scopes', () => {
      const result = validateScopes(['repo']);
      expect(result.valid).toBe(false);
      expect(result.missingScopes).toContain('read:user');
    });

    it('satisfies child scopes with parent scopes', () => {
      // 'repo' satisfies 'repo:status', 'public_repo', etc.
      const result = validateScopes(['repo', 'read:user']);
      expect(result.valid).toBe(true);
    });

    it('returns empty granted scopes array when validation fails', () => {
      const result = validateScopes(['invalid']);
      expect(result.valid).toBe(false);
      expect(result.grantedScopes).toEqual(['invalid']);
    });
  });

  describe('fetchAndValidateScopes', () => {
    const mockFetch = fetch as any;

    it('makes a fetch request with correct headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      await fetchAndValidateScopes('token-123');

      expect(mockFetch).toHaveBeenCalledWith('https://api.github.com/user', {
        headers: {
          Authorization: 'Bearer token-123',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
    });

    it('returns valid result when scopes are present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      const result = await fetchAndValidateScopes('token-123');

      expect(result.valid).toBe(true);
      expect(result.grantedScopes).toEqual(['repo', 'read:user']);
      expect(result.missingScopes).toEqual([]);
    });

    it('returns invalid result with missing scopes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo']]),
      });

      const result = await fetchAndValidateScopes('token-123');

      expect(result.valid).toBe(false);
      expect(result.missingScopes).toContain('read:user');
    });

    it('returns error result on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchAndValidateScopes('token-123');

      expect(result.valid).toBe(false);
      expect(result.fetchError).toBe('Network error');
      expect(result.grantedScopes).toEqual([]);
    });

    it('returns error result on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Map(),
      });

      const result = await fetchAndValidateScopes('token-123');

      expect(result.valid).toBe(false);
      expect(result.fetchError).toContain('401');
    });
  });

  describe('scope validation caching', () => {
    const mockFetch = fetch as any;

    it('caches successful validations', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      const result1 = await fetchAndValidateScopes('token-123');

      // Reset mock to track subsequent calls
      mockFetch.mockClear();

      const result2 = await fetchAndValidateScopes('token-123');

      // Should not have made another fetch call due to cache
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result2).toEqual(result1);
    });

    it('does not cache failed validations', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result1 = await fetchAndValidateScopes('token-123');

      expect(result1.valid).toBe(false);
      expect(result1.fetchError).toBe('Network error');

      // Reset mock and retry
      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      const result2 = await fetchAndValidateScopes('token-123');

      // Should have made a new fetch call since failures aren't cached
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result2.valid).toBe(true);
    });

    it('does not cache API error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Map(),
      });

      const result1 = await fetchAndValidateScopes('token-123');

      expect(result1.valid).toBe(false);

      // Reset mock and retry
      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      const result2 = await fetchAndValidateScopes('token-123');

      // Should have made a new fetch call since API errors aren't cached
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result2.valid).toBe(true);
    });

    it('uses different cache entries for different tokens', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map([['X-OAuth-Scopes', 'repo']]),
        });

      const result1 = await fetchAndValidateScopes('token-123');
      const result2 = await fetchAndValidateScopes('token-456');

      expect(result1.grantedScopes).toContain('read:user');
      expect(result2.grantedScopes).not.toContain('read:user');

      // Both tokens should have caused fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('clears the cache when clearScopeValidationCache is called', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      await fetchAndValidateScopes('token-123');

      clearScopeValidationCache();

      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      await fetchAndValidateScopes('token-123');

      // Should have made a new fetch after clear
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('respects cache TTL', async () => {
      vi.useFakeTimers();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      await fetchAndValidateScopes('token-123');

      mockFetch.mockClear();

      // Advance time past default TTL (5 minutes)
      vi.advanceTimersByTime(6 * 60 * 1000);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      await fetchAndValidateScopes('token-123');

      // Should have made a new fetch after TTL expired
      expect(mockFetch).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });

    it('evicts the oldest entry when the cache reaches its maximum size', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Map([['X-OAuth-Scopes', 'repo, read:user']]),
      });

      for (let index = 0; index < MAX_SCOPE_VALIDATION_CACHE_ENTRIES; index++) {
        await fetchAndValidateScopes(`token-${index}`);
      }

      mockFetch.mockClear();
      await fetchAndValidateScopes(`token-${MAX_SCOPE_VALIDATION_CACHE_ENTRIES}`);
      await fetchAndValidateScopes('token-0');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('buildMissingScopeMessage', () => {
    it('is exported as a utility function', async () => {
      const { buildMissingScopeMessage } = await import('./scope-validator');
      const message = buildMissingScopeMessage(['repo', 'read:user']);
      expect(message).toContain('repo');
      expect(message).toContain('read:user');
    });
  });
});
