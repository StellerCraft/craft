import { describe, expect, it, vi } from 'vitest';
import { GitHubAppAuthService } from './github-app-auth.service';

const mockGetInstallationAuthContext = vi.fn();
const mockRequestWithInstallationAuth = vi.fn();
const mockInvalidateCachedToken = vi.fn();

describe('GitHubAppAuthService', () => {
    it('delegates getAuthContext to the underlying auth client', async () => {
        mockGetInstallationAuthContext.mockResolvedValue({
            token: 'token-1',
            expiresAt: new Date('2030-01-01T00:00:00.000Z'),
            authorizationHeader: 'Bearer token-1',
            installationId: 42,
        });

        const service = new GitHubAppAuthService({
            getInstallationAuthContext: mockGetInstallationAuthContext,
            requestWithInstallationAuth: mockRequestWithInstallationAuth,
            invalidateCachedToken: mockInvalidateCachedToken,
        } as any);

        const result = await service.getAuthContext();

        expect(result.token).toBe('token-1');
        expect(mockGetInstallationAuthContext).toHaveBeenCalledOnce();
    });

    it('delegates requestWithAuth to the underlying auth client', async () => {
        const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
        mockRequestWithInstallationAuth.mockResolvedValue(response);

        const service = new GitHubAppAuthService({
            getInstallationAuthContext: mockGetInstallationAuthContext,
            requestWithInstallationAuth: mockRequestWithInstallationAuth,
            invalidateCachedToken: mockInvalidateCachedToken,
        } as any);

        const result = await service.requestWithAuth('/repos');

        expect(result.status).toBe(200);
        expect(mockRequestWithInstallationAuth).toHaveBeenCalledWith('/repos', {});
    });

    it('invalidates cached token through the underlying auth client', () => {
        const service = new GitHubAppAuthService({
            getInstallationAuthContext: mockGetInstallationAuthContext,
            requestWithInstallationAuth: mockRequestWithInstallationAuth,
            invalidateCachedToken: mockInvalidateCachedToken,
        } as any);

        service.invalidateToken();

        expect(mockInvalidateCachedToken).toHaveBeenCalledOnce();
    });
});
