/**
 * GitHub app authentication error codes.
 * Maps to ErrorCode as follows:
 * - CONFIGURATION_ERROR → GITHUB_CONFIGURATION_ERROR
 * - AUTHENTICATION_ERROR → GITHUB_AUTH_FAILED
 * - RATE_LIMITED → GITHUB_RATE_LIMITED
 * - NETWORK_ERROR → GITHUB_NETWORK_ERROR
 * - UPSTREAM_ERROR → GITHUB_UPSTREAM_ERROR
 * - REQUEST_ERROR → GITHUB_REQUEST_ERROR
 * - INVALID_RESPONSE → GITHUB_INVALID_RESPONSE
 */
export type GitHubAppAuthErrorCode =
    | 'CONFIGURATION_ERROR'
    | 'AUTHENTICATION_ERROR'
    | 'RATE_LIMITED'
    | 'NETWORK_ERROR'
    | 'UPSTREAM_ERROR'
    | 'REQUEST_ERROR'
    | 'INVALID_RESPONSE';

export interface GitHubInstallationAuthContext {
    token: string;
    expiresAt: Date;
    authorizationHeader: string;
    installationId: number;
}

export interface GitHubAppAuthErrorShape {
    code: GitHubAppAuthErrorCode;
    message: string;
    status?: number;
    retryable: boolean;
}
