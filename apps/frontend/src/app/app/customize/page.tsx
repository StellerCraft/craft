'use client';

import { useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app';
import { LoadingSkeleton } from '@/components/app/LoadingSkeleton';
import { ErrorState } from '@/components/app/ErrorState';
import { CustomizationStudio } from '@/components/app/CustomizationStudio';
import { useCustomizationStudio } from '@/hooks/useCustomizationStudio';
import type { CustomizationConfig } from '@craft/types';
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
  {
    id: 'customize',
    label: 'Customize',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
      </svg>
    ),
    path: '/app/customize',
  },
];

export default function CustomizePage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // templateId is required — passed from the template detail page
  const templateId = searchParams.get('templateId') ?? '';

  const { config, isDirty, saveState, loadError, loading, setConfig, save } =
    useCustomizationStudio(templateId);

  const handleDeploy = useCallback(() => {
    router.push(`/app/deployments?templateId=${templateId}`);
  }, [router, templateId]);

  // Guard: no templateId in URL
  if (!templateId) {
    return (
      <AppShell
        user={mockUser}
        navItems={navItems}
        breadcrumbs={[{ label: 'Home', path: '/app' }, { label: 'Customize' }]}
        status="operational"
      >
        <div className="p-6 lg:p-8">
          <ErrorState
            title="No template selected"
            message="Please choose a template from the catalog before customizing."
            onRetry={() => router.push('/app/templates')}
          />
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
        { label: 'Templates', path: '/app/templates' },
        { label: 'Customize' },
      ]}
      status="operational"
      onStatusClick={() => window.open('https://status.craft.com', '_blank')}
    >
      {/* Full-height studio — no extra padding so the studio fills the shell */}
      <div className="h-[calc(100vh-4rem)] flex flex-col">
        {loading && (
          <div className="p-6">
            <LoadingSkeleton variant="rect" height={400} />
          </div>
        )}

        {!loading && loadError && (
          <div className="p-6">
            <ErrorState
              title="Failed to load draft"
              message={loadError}
              onRetry={() => window.location.reload()}
            />
          </div>
        )}

        {!loading && !loadError && (
          <CustomizationStudio
            config={config}
            isDirty={isDirty}
            saveState={saveState}
            onChange={setConfig}
            onSave={save}
            onDeploy={handleDeploy}
          />
        )}
      </div>
    </AppShell>
  );
}
