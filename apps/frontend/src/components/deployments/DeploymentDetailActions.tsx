'use client';

import React, { useState } from 'react';

interface DeploymentDetailActionsProps {
  deploymentId: string;
  deploymentName: string;
  deploymentUrl: string | null;
  repositoryUrl: string | null;
  canRedeploy?: boolean;
  canDelete?: boolean;
  onViewLogs?: () => void;
  onRedeploy: (deploymentId: string) => Promise<void> | void;
  onDelete: (deploymentId: string) => Promise<void> | void;
}

export function DeploymentDetailActions({
  deploymentId,
  deploymentName,
  deploymentUrl,
  repositoryUrl,
  canRedeploy = true,
  canDelete = true,
  onViewLogs,
  onRedeploy,
  onDelete,
}: DeploymentDetailActionsProps) {
  const [isRedeploying, setIsRedeploying] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const canConfirmDelete = deleteConfirmationInput.trim() === deploymentName;

  async function handleRedeploy() {
    if (!canRedeploy) return;

    setActionError(null);
    setIsRedeploying(true);
    try {
      await onRedeploy(deploymentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to redeploy deployment';
      setActionError(message);
    } finally {
      setIsRedeploying(false);
    }
  }

  async function handleDelete() {
    if (!canDelete || !canConfirmDelete) return;

    setActionError(null);
    setIsDeleting(true);
    try {
      await onDelete(deploymentId);
      setDeleteDialogOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete deployment';
      setActionError(message);
    } finally {
      setIsDeleting(false);
    }
  }

  function openDeleteDialog() {
    setDeleteConfirmationInput('');
    setDeleteDialogOpen(true);
    setActionError(null);
  }

  return (
    <section
      aria-label="Deployment actions"
      className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4"
    >
      <h2 className="text-lg font-bold font-headline text-on-surface">Actions</h2>

      <p className="mt-1 text-sm text-on-surface-variant">
        Trigger a redeploy, open runtime links, or safely remove this deployment.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          data-testid="deployment-redeploy-btn"
          onClick={handleRedeploy}
          disabled={!canRedeploy || isRedeploying || isDeleting}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isRedeploying ? 'Redeploying...' : 'Redeploy Now'}
        </button>

        <button
          type="button"
          data-testid="deployment-view-logs-btn"
          onClick={onViewLogs}
          className="inline-flex items-center justify-center rounded-lg border border-outline-variant px-4 py-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          View Logs
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {deploymentUrl && (
          <a
            href={deploymentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-outline-variant px-3 py-1.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            Open Live URL
          </a>
        )}

        {repositoryUrl && (
          <a
            href={repositoryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-outline-variant px-3 py-1.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            Open Repository
          </a>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-sm font-medium text-red-800">Danger zone</p>
        <p className="mt-1 text-xs text-red-700">
          Deleting removes deployment metadata and linked provider resources.
        </p>

        <button
          type="button"
          data-testid="deployment-delete-btn"
          onClick={openDeleteDialog}
          disabled={!canDelete || isDeleting || isRedeploying}
          className="mt-3 inline-flex items-center rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Delete Deployment
        </button>
      </div>

      {actionError && (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {actionError}
        </p>
      )}

      {deleteDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deployment-delete-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          data-testid="deployment-delete-confirm-dialog"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 id="deployment-delete-confirm-title" className="text-lg font-semibold text-gray-900">
              Delete deployment?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              This action cannot be undone. Type <strong>{deploymentName}</strong> to confirm.
            </p>

            <label htmlFor="deployment-delete-confirm-input" className="mt-4 block text-xs font-medium uppercase tracking-wide text-gray-500">
              Confirm deployment name
            </label>
            <input
              id="deployment-delete-confirm-input"
              type="text"
              value={deleteConfirmationInput}
              onChange={(event) => setDeleteConfirmationInput(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200"
              placeholder={deploymentName}
              autoFocus
            />

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                data-testid="deployment-confirm-delete-btn"
                onClick={handleDelete}
                disabled={!canConfirmDelete || isDeleting}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete permanently'}
              </button>
              <button
                type="button"
                data-testid="deployment-cancel-delete-btn"
                onClick={() => setDeleteDialogOpen(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
