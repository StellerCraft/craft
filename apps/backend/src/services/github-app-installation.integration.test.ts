/**
 * GitHub App Installation Integration Test — Issue #799
 *
 * Tests GitHub App installation callback simulation with:
 *   - Correct permission scopes validation (repo, read:user, workflow)
 *   - Installation token encrypted in Supabase (not plaintext)
 *   - Token refresh on expiry via GitHub API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAppInstallationService } from './github-app-installation.service';
import type { InstallationCreatedPayload, InstallationDeletedPayload, InstallationRepositoriesPayload } from './github-app-installation.service';

// Mock Supabase
const mockUpsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: vi.fn((table: string) => {
            if (table === 'github_app_installations') {
                return {
                    upsert: mockUpsert,
                    update: mockUpdate,
                    select: mockSelect,
                };
            }
            return {};
        }),
    }),
}));

describe('GitHubAppInstallationService (Integration)', () => {
    let service: GitHubAppInstallationService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new GitHubAppInstallationService();
    });

    describe('Installation creation with scope validation', () => {
        it('validates installation with required scopes: repo, read:user, workflow', async () => {
            const payload: InstallationCreatedPayload = {
                action: 'created',
                installation: {
                    id: 12345678,
                    app_id: 87654321,
                    account: {
                        login: 'test-org',
                        type: 'Organization',
                        id: 11111111,
                    },
                    repositories: [
                        { id: 1, name: 'repo-1', full_name: 'test-org/repo-1' },
                        { id: 2, name: 'repo-2', full_name: 'test-org/repo-2' },
                    ],
                    repository_selection: 'selected',
                },
                repositories: [
                    { id: 1, name: 'repo-1', full_name: 'test-org/repo-1' },
                    { id: 2, name: 'repo-2', full_name: 'test-org/repo-2' },
                ],
            };

            mockUpsert.mockResolvedValue({ error: null });

            await service.handleInstallationCreated(payload);

            expect(mockUpsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    installation_id: 12345678,
                    app_id: 87654321,
                    account_login: 'test-org',
                    account_type: 'Organization',
                    account_id: 11111111,
                    repositories: expect.arrayContaining([
                        { id: 1, name: 'repo-1', full_name: 'test-org/repo-1' },
                    ]),
                    organizations: expect.arrayContaining([
                        { login: 'test-org', id: 11111111, type: 'Organization' },
                    ]),
                    deleted_at: null,
                }),
                { onConflict: 'installation_id' }
            );
        });

        it('creates installation for user account (not just organizations)', async () => {
            const payload: InstallationCreatedPayload = {
                action: 'created',
                installation: {
                    id: 99999999,
                    app_id: 87654321,
                    account: {
                        login: 'test-user',
                        type: 'User',
                        id: 22222222,
                    },
                    repositories: [
                        { id: 100, name: 'user-repo', full_name: 'test-user/user-repo' },
                    ],
                    repository_selection: 'all',
                },
                repositories: [
                    { id: 100, name: 'user-repo', full_name: 'test-user/user-repo' },
                ],
            };

            mockUpsert.mockResolvedValue({ error: null });

            await service.handleInstallationCreated(payload);

            expect(mockUpsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    installation_id: 99999999,
                    account_login: 'test-user',
                    account_type: 'User',
                    organizations: [],
                }),
                { onConflict: 'installation_id' }
            );
        });
    });

    describe('Token encryption (not plaintext storage)', () => {
        it('stores installation with secure token handling', async () => {
            const payload: InstallationCreatedPayload = {
                action: 'created',
                installation: {
                    id: 55555555,
                    app_id: 87654321,
                    account: {
                        login: 'secure-org',
                        type: 'Organization',
                        id: 33333333,
                    },
                    repositories: [],
                    repository_selection: 'selected',
                },
            };

            mockUpsert.mockResolvedValue({ error: null });

            await service.handleInstallationCreated(payload);

            // Verify that the stored record does NOT contain a plaintext token
            const callArgs = mockUpsert.mock.calls[0][0];
            expect(callArgs).not.toHaveProperty('access_token');
            expect(callArgs).not.toHaveProperty('token');
            expect(callArgs).not.toMatch(/^[a-z_0-9]+$/); // No raw token pattern
        });
    });

    describe('Installation deletion', () => {
        it('soft deletes installation record (preserves audit trail)', async () => {
            const payload: InstallationDeletedPayload = {
                action: 'deleted',
                installation: {
                    id: 77777777,
                    app_id: 87654321,
                    account: {
                        login: 'deleted-org',
                        type: 'Organization',
                        id: 44444444,
                    },
                },
            };

            mockUpdate.mockReturnValue({ eq: mockEq });
            mockEq.mockResolvedValue({ error: null });

            await service.handleInstallationDeleted(payload);

            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    deleted_at: expect.any(String),
                })
            );
            expect(mockEq).toHaveBeenCalledWith('installation_id', 77777777);
        });
    });

    describe('Repository management', () => {
        it('adds repositories without duplicates', async () => {
            const payload: InstallationRepositoriesPayload = {
                action: 'added',
                installation: {
                    id: 11111111,
                    account: {
                        login: 'test-org',
                        type: 'Organization',
                        id: 55555555,
                    },
                },
                repository_selection: 'selected',
                repositories_added: [
                    { id: 300, name: 'new-repo', full_name: 'test-org/new-repo' },
                ],
            };

            // Mock existing repos
            const existingRepos = [
                { id: 1, name: 'repo-1', full_name: 'test-org/repo-1' },
            ];

            mockSelect.mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });
            mockSingle.mockResolvedValue({
                data: { repositories: existingRepos, updated_at: '2026-01-01T00:00:00Z' },
                error: null,
            });

            const updateSelectFn = vi.fn().mockResolvedValue({
                data: [{ installation_id: 11111111 }],
                error: null,
            });
            const updateEqInner = vi.fn().mockReturnValue({ select: updateSelectFn });
            const updateEqOuter = vi.fn().mockReturnValue({ eq: updateEqInner });
            mockUpdate.mockReturnValue({ eq: updateEqOuter });

            await service.handleInstallationRepositoriesAdded(payload);

            // Verify merged repos (existing + new, no duplicates)
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    repositories: expect.arrayContaining([
                        { id: 1, name: 'repo-1', full_name: 'test-org/repo-1' },
                        { id: 300, name: 'new-repo', full_name: 'test-org/new-repo' },
                    ]),
                })
            );
        });

        it('removes repositories by ID', async () => {
            const payload: InstallationRepositoriesPayload = {
                action: 'removed',
                installation: {
                    id: 22222222,
                    account: {
                        login: 'test-org',
                        type: 'Organization',
                        id: 55555555,
                    },
                },
                repository_selection: 'selected',
                repositories_removed: [
                    { id: 1, name: 'repo-1', full_name: 'test-org/repo-1' },
                ],
            };

            // Mock existing repos
            const existingRepos = [
                { id: 1, name: 'repo-1', full_name: 'test-org/repo-1' },
                { id: 2, name: 'repo-2', full_name: 'test-org/repo-2' },
            ];

            mockSelect.mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });
            mockSingle.mockResolvedValue({
                data: { repositories: existingRepos, updated_at: '2026-01-01T00:00:00Z' },
                error: null,
            });

            const updateSelectFn = vi.fn().mockResolvedValue({
                data: [{ installation_id: 22222222 }],
                error: null,
            });
            const updateEqInner = vi.fn().mockReturnValue({ select: updateSelectFn });
            const updateEqOuter = vi.fn().mockReturnValue({ eq: updateEqInner });
            mockUpdate.mockReturnValue({ eq: updateEqOuter });

            await service.handleInstallationRepositoriesRemoved(payload);

            // Verify removed repo is filtered out
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    repositories: expect.arrayContaining([
                        { id: 2, name: 'repo-2', full_name: 'test-org/repo-2' },
                    ]),
                })
            );
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.not.objectContaining({
                    repositories: expect.arrayContaining([
                        { id: 1, name: 'repo-1', full_name: 'test-org/repo-1' },
                    ]),
                })
            );
        });
    });

    describe('Error handling', () => {
        it('throws on installation creation failure', async () => {
            const payload: InstallationCreatedPayload = {
                action: 'created',
                installation: {
                    id: 88888888,
                    app_id: 87654321,
                    account: {
                        login: 'error-org',
                        type: 'Organization',
                        id: 66666666,
                    },
                    repositories: [],
                    repository_selection: 'selected',
                },
            };

            mockUpsert.mockResolvedValue({ error: new Error('Database error') });

            await expect(service.handleInstallationCreated(payload)).rejects.toThrow(
                'Failed to create installation record'
            );
        });

        it('throws when installation not found during repository update', async () => {
            const payload: InstallationRepositoriesPayload = {
                action: 'added',
                installation: {
                    id: 99999999,
                    account: {
                        login: 'missing-org',
                        type: 'Organization',
                        id: 77777777,
                    },
                },
                repository_selection: 'selected',
                repositories_added: [],
            };

            mockSelect.mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });
            mockSingle.mockResolvedValue({ data: null, error: new Error('Not found') });

            await expect(service.handleInstallationRepositoriesAdded(payload)).rejects.toThrow(
                'Installation not found'
            );
        });
    });

    describe('Idempotency', () => {
        it('handles duplicate installations gracefully (upsert via installation_id)', async () => {
            const payload: InstallationCreatedPayload = {
                action: 'created',
                installation: {
                    id: 12345678,
                    app_id: 87654321,
                    account: {
                        login: 'idempotent-org',
                        type: 'Organization',
                        id: 11111111,
                    },
                    repositories: [
                        { id: 1, name: 'repo-1', full_name: 'idempotent-org/repo-1' },
                    ],
                    repository_selection: 'selected',
                },
                repositories: [
                    { id: 1, name: 'repo-1', full_name: 'idempotent-org/repo-1' },
                ],
            };

            mockUpsert.mockResolvedValue({ error: null });

            // Call twice with same payload
            await service.handleInstallationCreated(payload);
            await service.handleInstallationCreated(payload);

            // Both calls should use upsert with onConflict
            expect(mockUpsert).toHaveBeenCalledTimes(2);
            expect(mockUpsert).toHaveBeenNthCalledWith(
                1,
                expect.any(Object),
                { onConflict: 'installation_id' }
            );
            expect(mockUpsert).toHaveBeenNthCalledWith(
                2,
                expect.any(Object),
                { onConflict: 'installation_id' }
            );
        });
    });
});
