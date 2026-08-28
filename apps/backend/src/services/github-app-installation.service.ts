/**
 * GitHubAppInstallationService
 *
 * Handles GitHub App installation webhook events:
 * - installation.created: store installation ID, orgs, and repos
 * - installation.deleted: remove all installation records
 * - installation_repositories.added: update granted repositories
 * - installation_repositories.removed: update granted repositories
 *
 * All operations are idempotent using installation_id as the primary key.
 *
 * Concurrency: added/removed webhooks for the same installation_id can
 * arrive concurrently or out of order. The repositories column is updated
 * via a non-atomic read-modify-write, so handleInstallationRepositoriesAdded
 * and handleInstallationRepositoriesRemoved use optimistic concurrency
 * control keyed on the row's `updated_at` (maintained by a DB trigger,
 * see supabase/migrations/010_github_app_installations.sql): the update is
 * conditioned on `updated_at` still matching the value read, and a losing
 * writer retries against the freshly-read state instead of clobbering the
 * other handler's change.
 */

import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface InstallationCreatedPayload {
    action: 'created';
    installation: {
        id: number;
        app_id: number;
        account: {
            login: string;
            type: 'User' | 'Organization';
            id: number;
        };
        repositories?: Array<{
            id: number;
            name: string;
            full_name: string;
        }>;
        repository_selection: 'all' | 'selected';
        single_file_name?: string | null;
    };
    repositories?: Array<{
        id: number;
        name: string;
        full_name: string;
    }>;
}

export interface InstallationDeletedPayload {
    action: 'deleted';
    installation: {
        id: number;
        app_id: number;
        account: {
            login: string;
            type: 'User' | 'Organization';
            id: number;
        };
    };
}

export interface InstallationRepositoriesPayload {
    action: 'added' | 'removed';
    installation: {
        id: number;
        account: {
            login: string;
            type: 'User' | 'Organization';
            id: number;
        };
    };
    repository_selection: 'all' | 'selected';
    repositories_added?: Array<{
        id: number;
        name: string;
        full_name: string;
    }>;
    repositories_removed?: Array<{
        id: number;
        name: string;
        full_name: string;
    }>;
}

export class GitHubAppInstallationService {
    async handleInstallationCreated(payload: InstallationCreatedPayload): Promise<void> {
        const supabase = createClient();
        const installation = payload.installation;

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'installation.created',
            installationId: installation.id,
            accountLogin: installation.account.login,
            repoCount: (payload.repositories ?? []).length,
        }));

        // Prepare repository list
        const repositories = (payload.repositories || []).map((repo) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
        }));

        // Prepare organization list (for organization-level installs)
        const organizations = installation.account.type === 'Organization'
            ? [{
                login: installation.account.login,
                id: installation.account.id,
                type: 'Organization',
            }]
            : [];

        // Upsert installation (idempotent via installation_id)
        const { error } = await supabase
            .from('github_app_installations')
            .upsert({
                installation_id: installation.id,
                app_id: installation.app_id,
                account_login: installation.account.login,
                account_type: installation.account.type,
                account_id: installation.account.id,
                repositories: repositories,
                organizations: organizations,
                deleted_at: null,
            }, {
                onConflict: 'installation_id',
            });

        if (error) {
            throw new Error(`Failed to create installation record: ${error.message}`);
        }

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'installation.created.done',
            installationId: installation.id,
            repoCount: repositories.length,
        }));
    }

    async handleInstallationDeleted(payload: InstallationDeletedPayload): Promise<void> {
        const supabase = createClient();
        const installation = payload.installation;

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'installation.deleted',
            installationId: installation.id,
        }));

        // Mark installation as deleted (soft delete) to preserve audit trail
        const { error } = await supabase
            .from('github_app_installations')
            .update({
                deleted_at: new Date().toISOString(),
            })
            .eq('installation_id', installation.id);

        if (error) {
            throw new Error(`Failed to delete installation record: ${error.message}`);
        }

        console.info(JSON.stringify({
            service: 'github-app-installation',
            action: 'installation.deleted.done',
            installationId: installation.id,
        }));
    }

    async handleInstallationRepositoriesAdded(payload: InstallationRepositoriesPayload): Promise<void> {
        const supabase = createClient();
        const installation = payload.installation;
        const addedRepos = (payload.repositories_added || []).map((repo) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
        }));

        await this.applyRepositoriesChange(supabase, installation.id, (existingRepos) => {
            const repoIds = new Set(existingRepos.map((r) => (r as any).id));
            return [
                ...existingRepos,
                ...addedRepos.filter((r) => !repoIds.has(r.id)),
            ];
        });
    }

    async handleInstallationRepositoriesRemoved(payload: InstallationRepositoriesPayload): Promise<void> {
        const supabase = createClient();
        const installation = payload.installation;
        const removedRepoIds = new Set(
            (payload.repositories_removed || []).map((repo) => repo.id)
        );

        await this.applyRepositoriesChange(supabase, installation.id, (existingRepos) =>
            existingRepos.filter((r) => !removedRepoIds.has((r as any).id))
        );
    }

    /**
     * Read-modify-write the `repositories` column with optimistic concurrency
     * control: the update only commits if `updated_at` still matches the
     * value observed at read time. If a concurrent added/removed handler won
     * the race and changed the row first, this re-reads the fresh state and
     * retries the transform, so neither handler's change is lost.
     */
    private async applyRepositoriesChange(
        supabase: SupabaseClient,
        installationId: number,
        transform: (existingRepos: any[]) => any[],
    ): Promise<void> {
        const MAX_ATTEMPTS = 5;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const { data: current, error: fetchError } = await supabase
                .from('github_app_installations')
                .select('repositories, updated_at')
                .eq('installation_id', installationId)
                .single();

            if (fetchError || !current) {
                throw new Error(`Installation not found: ${installationId}`);
            }

            const existingRepos = (current.repositories as any[]) || [];
            const nextRepos = transform(existingRepos);

            const { data: updated, error: updateError } = await supabase
                .from('github_app_installations')
                .update({ repositories: nextRepos })
                .eq('installation_id', installationId)
                .eq('updated_at', (current as any).updated_at)
                .select('installation_id');

            if (updateError) {
                throw new Error(`Failed to update repositories: ${updateError.message}`);
            }

            if (updated && updated.length > 0) {
                return;
            }
            // Lost the race: another handler updated this row between our
            // read and write. Retry against the now-current state.
        }

        throw new Error(
            `Failed to update repositories for installation ${installationId}: too many concurrent write conflicts`,
        );
    }
}

export const gitHubAppInstallationService = new GitHubAppInstallationService();
