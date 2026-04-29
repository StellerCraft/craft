'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app';
import {
  DeploymentDetailActions,
  DeploymentHistorySection,
  DeploymentLogViewerShell,
  DeploymentProgressIndicator,
  type DeploymentHistoryItem,
} from '@/components/deployments';
import type {
  DeploymentDetail,
  DeploymentLogEntry,
  DeploymentStatusSnapshot,
} from '@/types/deployment';
import type { NavItem, User } from '@/types/navigation';
import {
  deleteDeployment,
  DeploymentApiError,
  fetchDeploymentDetail,
  fetchDeploymentLogs,
  fetchDeploymentStatus,
  fetchDeploymentUpdateContext,
  redeployDeployment,
} from '@/services/deployment-detail-api';
import { isDeploymentDetailStatusActive } from '@/components/deployments/deployment-detail-status';

const mockUser: User = {
  id: '1',
  name: 'John Doe',
  email: 'john@example.com',
  role: 'user',
};

const navItems: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    path: '/app',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
  },
  {
    id: 'deployments',
    label: 'Deployments',
    path: '/app/deployments',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/app/settings/profile',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface DeploymentDetailPageProps {
  params: { id: string };
}

function formatDateTime(value: string | null): string {
  if (!value) return 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function buildHistoryItems(
  detail: DeploymentDetail | null,
  status: DeploymentStatusSnapshot | null,
  updateContext: unknown,
): DeploymentHistoryItem[] {
  const items: DeploymentHistoryItem[] = [];

  if (detail) {
    items.push({
      id: `${detail.id}-created`,
      title: 'Deployment created',
      summary: `Initial deployment record for ${detail.name}.`,
      timestamp: detail.timestamps.created,
      status: 'success',
    });
  }

  if (status?.timestamps.deployed) {
    items.push({
      id: `${status.id}-deployed`,
      title: 'Deployment completed',
      summary: 'Deployment reached a terminal completed state.',
      timestamp: status.timestamps.deployed,
      status: 'success',
    });
  }

  if (status?.status === 'failed') {
    items.push({
      id: `${status.id}-failed-${status.timestamps.updated}`,
      title: 'Deployment failed',
      summary: status.error ?? 'Deployment failed without an error message.',
      timestamp: status.timestamps.updated,
      status: 'failed',
    });
  }

  if (updateContext && typeof updateContext === 'object') {
    const context = updateContext as { id?: unknown; updatedAt?: unknown };
    if (typeof context.updatedAt === 'string') {
      items.push({
        id: typeof context.id === 'string' ? context.id : 'update-context',
        title: 'Update context found',
        summary: 'Update API integration point returned draft metadata.',
        timestamp: context.updatedAt,
        status: 'pending',
      });
    }
  }

  return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export default function DeploymentDetailPage({ params }: DeploymentDetailPageProps) {
  const router = useRouter();
  const deploymentId = params.id;

  const [detail, setDetail] = useState<DeploymentDetail | null>(null);
  const [status, setStatus] = useState<DeploymentStatusSnapshot | null>(null);
  const [logs, setLogs] = useState<DeploymentLogEntry[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [historyItems, setHistoryItems] = useState<DeploymentHistoryItem[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadLogs = useCallback(
    async (page = 1, append = false) => {
      setLogsLoading(true);
      setLogsError(null);
      try {
        const response = await fetchDeploymentLogs(deploymentId, {
          page,
          limit: 50,
          order: 'desc',
        });

        setLogs((prev) => (append ? [...prev, ...response.data] : response.data));
        setHasMoreLogs(response.pagination.hasNextPage);
        setLogsPage(page);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load deployment logs';
        setLogsError(message);
      } finally {
        setLogsLoading(false);
      }
    },
    [deploymentId],
  );

  const loadHistory = useCallback(
    async (currentDetail: DeploymentDetail | null, currentStatus: DeploymentStatusSnapshot | null) => {
      setHistoryLoading(true);
      setHistoryError(null);

      try {
        const updateContext = await fetchDeploymentUpdateContext(deploymentId);
        setHistoryItems(buildHistoryItems(currentDetail, currentStatus, updateContext));
      } catch (error) {
        if (error instanceof DeploymentApiError && error.status === 404) {
          setHistoryItems(buildHistoryItems(currentDetail, currentStatus, null));
        } else {
          const message = error instanceof Error ? error.message : 'Failed to load deployment history';
          setHistoryError(message);
          setHistoryItems(buildHistoryItems(currentDetail, currentStatus, null));
        }
      } finally {
        setHistoryLoading(false);
      }
    },
    [deploymentId],
  );

  const loadDetailView = useCallback(async () => {
    setIsLoading(true);
    setPageError(null);

    try {
      const [detailResponse, statusResponse] = await Promise.all([
        fetchDeploymentDetail(deploymentId),
        fetchDeploymentStatus(deploymentId),
      ]);

      setDetail(detailResponse);
      setStatus(statusResponse);
      await Promise.all([
        loadLogs(1, false),
        loadHistory(detailResponse, statusResponse),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load deployment detail';
      setPageError(message);
    } finally {
      setIsLoading(false);
    }
  }, [deploymentId, loadHistory, loadLogs]);

  const refreshStatus = useCallback(async () => {
    try {
      const snapshot = await fetchDeploymentStatus(deploymentId);
      setStatus(snapshot);
      setDetail((prev) => {
        if (!prev) return prev;

        return {
          ...prev,
          status: snapshot.status,
          deploymentUrl: snapshot.deploymentUrl ?? prev.deploymentUrl,
          timestamps: {
            ...prev.timestamps,
            updated: snapshot.timestamps.updated,
            deployed: snapshot.timestamps.deployed,
          },
          errorMessage: snapshot.error,
        };
      });
    } catch {
      // Polling should be resilient to transient errors.
    }
  }, [deploymentId]);

  useEffect(() => {
    void loadDetailView();
  }, [loadDetailView]);

  const shouldPollStatus = useMemo(
    () => (status ? isDeploymentDetailStatusActive(status.status) : false),
    [status],
  );

  useEffect(() => {
    if (!shouldPollStatus) return;

    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshStatus, shouldPollStatus]);

  const handleRedeploy = useCallback(async (id: string) => {
    try {
      await redeployDeployment(id);
      await Promise.all([refreshStatus(), loadLogs(1, false)]);
    } catch (error) {
      if (error instanceof DeploymentApiError && error.status === 404) {
        throw new Error('Redeploy endpoint is not available yet in this environment.');
      }

      throw error;
    }
  }, [loadLogs, refreshStatus]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteDeployment(id);
    router.push('/app/deployments');
  }, [router]);

  const effectiveStatus = status?.status ?? detail?.status ?? 'pending';
  const effectiveProgress = status?.progress.percentage;
  const effectiveDescription = status?.progress.description;

  if (isLoading) {
    return (
      <AppShell
        user={mockUser}
        navItems={navItems}
        breadcrumbs={[{ label: 'Home', path: '/app' }, { label: 'Deployments', path: '/app/deployments' }, { label: deploymentId }]}
        status="operational"
      >
        <div className="mx-auto max-w-6xl space-y-4 p-6 lg:p-8" aria-label="Loading deployment detail">
          <div className="h-8 animate-pulse rounded-lg bg-surface-container" />
          <div className="h-32 animate-pulse rounded-xl bg-surface-container" />
          <div className="h-64 animate-pulse rounded-xl bg-surface-container" />
        </div>
      </AppShell>
    );
  }

  if (pageError || !detail) {
    return (
      <AppShell
        user={mockUser}
        navItems={navItems}
        breadcrumbs={[{ label: 'Home', path: '/app' }, { label: 'Deployments', path: '/app/deployments' }, { label: deploymentId }]}
        status="operational"
      >
        <div className="mx-auto max-w-2xl p-6 lg:p-8">
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-5 text-sm text-red-800">
            <p className="font-semibold">Failed to load deployment detail</p>
            <p className="mt-1">{pageError ?? 'Deployment detail is unavailable.'}</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => void loadDetailView()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => router.push('/app/deployments')}
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                Back to deployments
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[
        { label: 'Home', path: '/app' },
        { label: 'Deployments', path: '/app/deployments' },
        { label: detail.name },
      ]}
      status="operational"
    >
      <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold font-headline text-on-surface">{detail.name}</h1>
            <p className="mt-1 text-sm text-on-surface-variant">Deployment ID: {detail.id}</p>
          </div>

          <button
            type="button"
            onClick={() => router.push('/app/deployments')}
            className="rounded-lg border border-outline-variant px-3 py-1.5 text-sm text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Back to list
          </button>
        </header>

        <DeploymentProgressIndicator
          status={effectiveStatus}
          percentage={effectiveProgress}
          description={effectiveDescription}
          updatedAt={status?.timestamps.updated ?? detail.timestamps.updated}
        />

        {detail.errorMessage && (
          <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {detail.errorMessage}
          </div>
        )}

        <section aria-label="Deployment metadata" className="grid gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Template ID</p>
            <p className="mt-1 text-sm font-medium text-on-surface">{detail.templateId ?? 'Not available'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Vercel Project</p>
            <p className="mt-1 text-sm font-medium text-on-surface">{detail.vercelProjectId ?? 'Not linked'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Created</p>
            <p className="mt-1 text-sm font-medium text-on-surface">{formatDateTime(detail.timestamps.created)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-on-surface-variant">Last Updated</p>
            <p className="mt-1 text-sm font-medium text-on-surface">{formatDateTime(detail.timestamps.updated)}</p>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <DeploymentDetailActions
            deploymentId={detail.id}
            deploymentName={detail.name}
            deploymentUrl={detail.deploymentUrl}
            repositoryUrl={detail.repositoryUrl}
            canRedeploy={detail.status === 'completed' || detail.status === 'failed'}
            onViewLogs={() => {
              const element = document.getElementById('deployment-logs-section');
              element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            onRedeploy={handleRedeploy}
            onDelete={handleDelete}
          />

          <DeploymentHistorySection
            items={historyItems}
            isLoading={historyLoading}
            error={historyError}
            onRefresh={() => void loadHistory(detail, status)}
          />
        </div>

        <div id="deployment-logs-section">
          <DeploymentLogViewerShell
            logs={logs}
            isLoading={logsLoading}
            error={logsError}
            hasMore={hasMoreLogs}
            onRefresh={() => void loadLogs(1, false)}
            onLoadMore={hasMoreLogs ? () => void loadLogs(logsPage + 1, true) : undefined}
          />
        </div>
      </div>
    </AppShell>
  );
}
