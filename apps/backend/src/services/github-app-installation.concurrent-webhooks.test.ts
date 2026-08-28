/**
 * Concurrency tests for GitHubAppInstallationService — installation_repositories
 * added/removed webhooks racing on the same installation_id.
 *
 * handleInstallationRepositoriesAdded/Removed perform a non-atomic
 * read-modify-write on the `repositories` JSONB column. GitHub can deliver
 * added/removed webhooks for the same installation concurrently or out of
 * order; without a conflict guard, whichever handler writes last silently
 * clobbers the other's change (a lost "removed" update would incorrectly
 * leave a repository listed as still granted to the installation).
 *
 * This suite simulates that race against an in-memory fake table with
 * realistic read/write interleaving (both handlers' reads are forced to
 * observe the same pre-write snapshot via a synchronization gate, so a
 * genuine conflict on the `updated_at` optimistic-concurrency check is
 * guaranteed rather than left to chance). No live network/DB calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GitHubAppInstallationService } from './github-app-installation.service';
import type { InstallationRepositoriesPayload } from './github-app-installation.service';

// ── In-memory fake `github_app_installations` table ───────────────────────────

interface FakeRow {
    installation_id: number;
    repositories: Array<{ id: number; name: string; full_name: string }>;
    updated_at: string;
}

function createFakeInstallationsTable(initialRow: FakeRow) {
    let row: FakeRow = { ...initialRow, repositories: [...initialRow.repositories] };
    let writeVersion = 0;

    // Synchronization gate: the Nth-and-beyond read all block until at least
    // `expectedReaders` reads have started, guaranteeing every reader
    // observes the same pre-write snapshot instead of racing incidentally.
    let readsStarted = 0;
    let releaseReads: () => void = () => {};
    const readGate = new Promise<void>((resolve) => {
        releaseReads = resolve;
    });
    // Default to 1 (no blocking) so sequential, non-racing calls never wait
    // on a second reader that will never arrive. Concurrency tests raise
    // this to force both handlers' reads to observe the same snapshot.
    let expectedReaders = 1;

    function configureExpectedReaders(n: number) {
        expectedReaders = n;
    }

    function query() {
        let mode: 'select' | 'update' | null = null;
        let pendingUpdate: Record<string, unknown> | null = null;
        const conditions: Array<(r: FakeRow) => boolean> = [];

        const builder: any = {
            select(_cols?: string) {
                if (mode === 'update') {
                    // Terminal call for the update chain: apply the
                    // conditional write and resolve immediately.
                    return (async () => {
                        const matches = conditions.every((c) => c(row));
                        if (!matches) {
                            return { data: [], error: null };
                        }
                        row = {
                            ...row,
                            ...(pendingUpdate as Partial<FakeRow>),
                            updated_at: `t${++writeVersion}`,
                        };
                        return { data: [{ installation_id: row.installation_id }], error: null };
                    })();
                }
                mode = 'select';
                return builder;
            },
            update(data: Record<string, unknown>) {
                mode = 'update';
                pendingUpdate = data;
                return builder;
            },
            eq(col: string, val: unknown) {
                conditions.push((r: any) => r[col] === val);
                return builder;
            },
            async single() {
                readsStarted++;
                if (readsStarted >= expectedReaders) releaseReads();
                await readGate;

                const matches = conditions.every((c) => c(row));
                if (!matches) return { data: null, error: { message: 'not found' } };
                return { data: { ...row }, error: null };
            },
        };
        return builder;
    }

    return {
        query,
        configureExpectedReaders,
        getRow: () => row,
    };
}

// ── Supabase mock ─────────────────────────────────────────────────────────────

let fakeTable: ReturnType<typeof createFakeInstallationsTable>;

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({
        from: (_table: string) => fakeTable.query(),
    }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GitHubAppInstallationService — concurrent added/removed webhooks', () => {
    let service: GitHubAppInstallationService;
    const INSTALLATION_ID = 555000111;

    beforeEach(() => {
        service = new GitHubAppInstallationService();
        fakeTable = createFakeInstallationsTable({
            installation_id: INSTALLATION_ID,
            repositories: [{ id: 1, name: 'repo-1', full_name: 'acme/repo-1' }],
            updated_at: 't0',
        });
    });

    it('does not lose either update when added and removed race for the same installation', async () => {
        fakeTable.configureExpectedReaders(2);

        const addedPayload: InstallationRepositoriesPayload = {
            action: 'added',
            installation: { id: INSTALLATION_ID, account: { login: 'acme', type: 'Organization', id: 1 } },
            repository_selection: 'selected',
            repositories_added: [{ id: 2, name: 'repo-2', full_name: 'acme/repo-2' }],
        };
        const removedPayload: InstallationRepositoriesPayload = {
            action: 'removed',
            installation: { id: INSTALLATION_ID, account: { login: 'acme', type: 'Organization', id: 1 } },
            repository_selection: 'selected',
            repositories_removed: [{ id: 1, name: 'repo-1', full_name: 'acme/repo-1' }],
        };

        await Promise.all([
            service.handleInstallationRepositoriesAdded(addedPayload),
            service.handleInstallationRepositoriesRemoved(removedPayload),
        ]);

        const finalRepos = fakeTable.getRow().repositories;
        const ids = finalRepos.map((r) => r.id).sort();

        // The add is not lost: repo-2 is present.
        expect(ids).toContain(2);
        // The remove is not lost: repo-1 is gone (a lost "removed" update
        // would incorrectly leave it listed as still granted).
        expect(ids).not.toContain(1);
        expect(ids).toEqual([2]);
    });

    it('retries the losing writer instead of throwing, and both changes land', async () => {
        fakeTable.configureExpectedReaders(2);

        const addedPayload: InstallationRepositoriesPayload = {
            action: 'added',
            installation: { id: INSTALLATION_ID, account: { login: 'acme', type: 'Organization', id: 1 } },
            repository_selection: 'selected',
            repositories_added: [
                { id: 2, name: 'repo-2', full_name: 'acme/repo-2' },
                { id: 3, name: 'repo-3', full_name: 'acme/repo-3' },
            ],
        };
        const removedPayload: InstallationRepositoriesPayload = {
            action: 'removed',
            installation: { id: INSTALLATION_ID, account: { login: 'acme', type: 'Organization', id: 1 } },
            repository_selection: 'selected',
            repositories_removed: [{ id: 1, name: 'repo-1', full_name: 'acme/repo-1' }],
        };

        await expect(
            Promise.all([
                service.handleInstallationRepositoriesAdded(addedPayload),
                service.handleInstallationRepositoriesRemoved(removedPayload),
            ]),
        ).resolves.toBeDefined();

        const finalRepos = fakeTable.getRow().repositories.map((r) => r.id).sort();
        expect(finalRepos).toEqual([2, 3]);
    });

    it('sequential (non-concurrent) added then removed still both apply', async () => {
        await service.handleInstallationRepositoriesAdded({
            action: 'added',
            installation: { id: INSTALLATION_ID, account: { login: 'acme', type: 'Organization', id: 1 } },
            repository_selection: 'selected',
            repositories_added: [{ id: 2, name: 'repo-2', full_name: 'acme/repo-2' }],
        });

        await service.handleInstallationRepositoriesRemoved({
            action: 'removed',
            installation: { id: INSTALLATION_ID, account: { login: 'acme', type: 'Organization', id: 1 } },
            repository_selection: 'selected',
            repositories_removed: [{ id: 1, name: 'repo-1', full_name: 'acme/repo-1' }],
        });

        const finalRepos = fakeTable.getRow().repositories.map((r) => r.id).sort();
        expect(finalRepos).toEqual([2]);
    });
});
