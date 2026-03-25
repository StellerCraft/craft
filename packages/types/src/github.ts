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
