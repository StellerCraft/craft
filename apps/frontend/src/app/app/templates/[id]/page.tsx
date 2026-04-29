'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/app';
import { TemplateDetailView } from '@/components/app/templates';
import { LoadingSkeleton } from '@/components/app/LoadingSkeleton';
import { ErrorState } from '@/components/app/ErrorState';
import type { Template, TemplateMetadata } from '@craft/types';
import type { User, NavItem } from '@/types/navigation';

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
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    path: '/app',
  },
  {
    id: 'templates',
    label: 'Templates',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    path: '/app/templates',
    badge: 3,
  },
  {
    id: 'deployments',
    label: 'Deployments',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    path: '/app/deployments',
  },
];

interface TemplateDetailPageProps {
  params: { id: string };
}

export default function TemplateDetailPage({ params }: TemplateDetailPageProps) {
  const router = useRouter();
  const { id } = params;

  const [template, setTemplate] = useState<Template | null>(null);
  const [metadata, setMetadata] = useState<TemplateMetadata | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const [tplRes, metaRes] = await Promise.all([
          fetch(`/api/templates/${id}`),
          fetch(`/api/templates/${id}/metadata`),
        ]);

        if (!tplRes.ok) {
          const status = tplRes.status;
          throw new Error(
            status === 404
              ? 'Template not found.'
              : `Failed to load template (${status})`,
          );
        }

        const tpl: Template = await tplRes.json();
        const meta: TemplateMetadata | undefined = metaRes.ok
          ? await metaRes.json()
          : undefined;

        if (!cancelled) {
          setTemplate(tpl);
          setMetadata(meta);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'An unexpected error occurred.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  const handleCustomize = useCallback(
    (tpl: Template) => {
      router.push(`/app/customize?templateId=${tpl.id}`);
    },
    [router],
  );

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    // Re-trigger the effect by toggling a key would require state; instead
    // we reload via a simple page-level mechanism.
    window.location.reload();
  }, []);

  const templateName = template?.name ?? 'Template';

  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[
        { label: 'Home', path: '/app' },
        { label: 'Templates', path: '/app/templates' },
        { label: templateName },
      ]}
      status="operational"
      onStatusClick={() => window.open('https://status.craft.com', '_blank')}
    >
      <div className="p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          {loading && <LoadingSkeleton />}

          {!loading && error && (
            <ErrorState
              title="Failed to load template"
              message={error}
              onRetry={handleRetry}
            />
          )}

          {!loading && !error && template && (
            <TemplateDetailView
              template={template}
              metadata={metadata}
              onCustomize={handleCustomize}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
