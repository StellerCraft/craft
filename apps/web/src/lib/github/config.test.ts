import { describe, expect, it } from 'vitest';
import { getGitHubAppConfig, normalizePrivateKey } from './config';

const baseEnv: Record<string, string | undefined> = {
    GITHUB_APP_ID: '12345',
    GITHUB_APP_INSTALLATION_ID: '67890',
    GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----',
};

function toProcessEnv(env: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return env as unknown as NodeJS.ProcessEnv;
}

describe('getGitHubAppConfig', () => {
    it('returns normalized config for valid environment variables', () => {
        const config = getGitHubAppConfig(toProcessEnv(baseEnv));

        expect(config.appId).toBe(12345);
        expect(config.installationId).toBe(67890);
        expect(config.privateKey).toContain('\n');
        expect(config.apiBaseUrl).toBe('https://api.github.com');
    });

    it('throws when required values are missing', () => {
        expect(() => getGitHubAppConfig(toProcessEnv({ ...baseEnv, GITHUB_APP_ID: '' }))).toThrow(
            'Missing required environment variable: GITHUB_APP_ID'
        );
    });

    it('throws when numeric values are invalid', () => {
        expect(() => getGitHubAppConfig(toProcessEnv({ ...baseEnv, GITHUB_APP_INSTALLATION_ID: 'abc' }))).toThrow(
            'Invalid GITHUB_APP_INSTALLATION_ID: expected a positive integer'
        );
    });

    it('throws when api base url is not absolute', () => {
        expect(() => getGitHubAppConfig(toProcessEnv({ ...baseEnv, GITHUB_API_BASE_URL: '/relative' }))).toThrow(
            'Invalid GITHUB_API_BASE_URL: expected an absolute http(s) URL'
        );
    });

    it('trims trailing slashes from api base url', () => {
        const config = getGitHubAppConfig(toProcessEnv({
            ...baseEnv,
            GITHUB_API_BASE_URL: 'https://api.github.com/',
        }));

        expect(config.apiBaseUrl).toBe('https://api.github.com');
    });
});

describe('normalizePrivateKey', () => {
    it('converts escaped newlines to real newlines', () => {
        const normalized = normalizePrivateKey(
            '-----BEGIN PRIVATE KEY-----\\nline-one\\nline-two\\n-----END PRIVATE KEY-----'
        );

        expect(normalized).toContain('\nline-one\n');
    });

    it('throws for non-PEM values', () => {
        expect(() => normalizePrivateKey('not-a-key')).toThrow(
            'Invalid GITHUB_APP_PRIVATE_KEY: expected a PEM encoded private key'
        );
    });
});
