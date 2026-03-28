export interface GitHubAppConfig {
    appId: number;
    installationId: number;
    privateKey: string;
    apiBaseUrl: string;
}

const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';

function readRequiredEnv(name: string, env: NodeJS.ProcessEnv): string {
    const value = env[name]?.trim();
    if (!value) {
        throw new GitHubAppConfigError(
            `Missing required environment variable: ${name}`,
            'CONFIGURATION_ERROR'
        );
    }
    return value;
}

function parsePositiveInteger(name: string, value: string): number {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new GitHubAppConfigError(
            `Invalid ${name}: expected a positive integer`,
            'CONFIGURATION_ERROR'
        );
    }

    return parsed;
}

export function normalizePrivateKey(rawKey: string): string {
    const normalized = rawKey.replace(/\\n/g, '\n').trim();

    if (!normalized.includes('BEGIN') || !normalized.includes('PRIVATE KEY')) {
        throw new GitHubAppConfigError(
            'Invalid GITHUB_APP_PRIVATE_KEY: expected a PEM encoded private key',
            'CONFIGURATION_ERROR'
        );
    }

    return normalized;
}

export function getGitHubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfig {
    const appId = parsePositiveInteger('GITHUB_APP_ID', readRequiredEnv('GITHUB_APP_ID', env));
    const installationId = parsePositiveInteger(
        'GITHUB_APP_INSTALLATION_ID',
        readRequiredEnv('GITHUB_APP_INSTALLATION_ID', env)
    );

    const privateKey = normalizePrivateKey(readRequiredEnv('GITHUB_APP_PRIVATE_KEY', env));
    const apiBaseUrl = (env.GITHUB_API_BASE_URL || DEFAULT_GITHUB_API_BASE_URL).trim();

    if (!apiBaseUrl.startsWith('http://') && !apiBaseUrl.startsWith('https://')) {
        throw new GitHubAppConfigError(
            'Invalid GITHUB_API_BASE_URL: expected an absolute http(s) URL',
            'CONFIGURATION_ERROR'
        );
    }

    return {
        appId,
        installationId,
        privateKey,
        apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    };
}

export class GitHubAppConfigError extends Error {
    readonly code: 'CONFIGURATION_ERROR';

    constructor(message: string, code: 'CONFIGURATION_ERROR') {
        super(message);
        this.name = 'GitHubAppConfigError';
        this.code = code;
    }
}
