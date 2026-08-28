import { type ErrorCode } from './errors';
import { type GitHubErrorCode } from './deployment';
import { type GitHubAppAuthErrorCode } from './github';

/**
 * Maps a domain-specific GitHub error code to the canonical ErrorCode.
 * Supports both GitHubErrorCode (from deployment) and GitHubAppAuthErrorCode (from auth).
 */
export function toApiErrorCode(code: GitHubErrorCode | GitHubAppAuthErrorCode): ErrorCode {
  // Map GitHubErrorCode (from deployment.ts)
  if (code === 'COLLISION') return 'GITHUB_COLLISION';
  if (code === 'AUTH_FAILED') return 'GITHUB_AUTH_FAILED';
  if (code === 'RATE_LIMITED') return 'GITHUB_RATE_LIMITED';
  if (code === 'NETWORK_ERROR') return 'GITHUB_NETWORK_ERROR';
  if (code === 'UNKNOWN') return 'GITHUB_UNKNOWN';

  // Map GitHubAppAuthErrorCode (from github.ts)
  if (code === 'CONFIGURATION_ERROR') return 'GITHUB_CONFIGURATION_ERROR';
  if (code === 'AUTHENTICATION_ERROR') return 'GITHUB_AUTH_FAILED';
  if (code === 'UPSTREAM_ERROR') return 'GITHUB_UPSTREAM_ERROR';
  if (code === 'REQUEST_ERROR') return 'GITHUB_REQUEST_ERROR';
  if (code === 'INVALID_RESPONSE') return 'GITHUB_INVALID_RESPONSE';

  // Fallback for unmapped codes
  return 'INTERNAL_SERVER_ERROR';
}
