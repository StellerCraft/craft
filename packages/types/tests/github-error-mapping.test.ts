import { describe, it, expect } from 'vitest';
import { toApiErrorCode } from '../src/github-error-mapping';
import { ERROR_CODE_META } from '../src/errors';

describe('toApiErrorCode', () => {
  describe('GitHubErrorCode mappings', () => {
    it('maps COLLISION to GITHUB_COLLISION', () => {
      expect(toApiErrorCode('COLLISION')).toBe('GITHUB_COLLISION');
    });

    it('maps AUTH_FAILED to GITHUB_AUTH_FAILED', () => {
      expect(toApiErrorCode('AUTH_FAILED')).toBe('GITHUB_AUTH_FAILED');
    });

    it('maps RATE_LIMITED to GITHUB_RATE_LIMITED', () => {
      expect(toApiErrorCode('RATE_LIMITED')).toBe('GITHUB_RATE_LIMITED');
    });

    it('maps NETWORK_ERROR to GITHUB_NETWORK_ERROR', () => {
      expect(toApiErrorCode('NETWORK_ERROR')).toBe('GITHUB_NETWORK_ERROR');
    });

    it('maps UNKNOWN to GITHUB_UNKNOWN', () => {
      expect(toApiErrorCode('UNKNOWN')).toBe('GITHUB_UNKNOWN');
    });
  });

  describe('GitHubAppAuthErrorCode mappings', () => {
    it('maps CONFIGURATION_ERROR to GITHUB_CONFIGURATION_ERROR', () => {
      expect(toApiErrorCode('CONFIGURATION_ERROR')).toBe('GITHUB_CONFIGURATION_ERROR');
    });

    it('maps AUTHENTICATION_ERROR to GITHUB_AUTH_FAILED', () => {
      expect(toApiErrorCode('AUTHENTICATION_ERROR')).toBe('GITHUB_AUTH_FAILED');
    });

    it('maps UPSTREAM_ERROR to GITHUB_UPSTREAM_ERROR', () => {
      expect(toApiErrorCode('UPSTREAM_ERROR')).toBe('GITHUB_UPSTREAM_ERROR');
    });

    it('maps REQUEST_ERROR to GITHUB_REQUEST_ERROR', () => {
      expect(toApiErrorCode('REQUEST_ERROR')).toBe('GITHUB_REQUEST_ERROR');
    });

    it('maps INVALID_RESPONSE to GITHUB_INVALID_RESPONSE', () => {
      expect(toApiErrorCode('INVALID_RESPONSE')).toBe('GITHUB_INVALID_RESPONSE');
    });
  });

  describe('ERROR_CODE_META coverage', () => {
    it('all mapped GitHub codes have ERROR_CODE_META entries', () => {
      const codes = [
        'GITHUB_COLLISION',
        'GITHUB_AUTH_FAILED',
        'GITHUB_RATE_LIMITED',
        'GITHUB_NETWORK_ERROR',
        'GITHUB_UNKNOWN',
        'GITHUB_CONFIGURATION_ERROR',
        'GITHUB_UPSTREAM_ERROR',
        'GITHUB_REQUEST_ERROR',
        'GITHUB_INVALID_RESPONSE',
      ];
      codes.forEach(code => {
        expect(ERROR_CODE_META).toHaveProperty(code);
      });
    });
  });
});
