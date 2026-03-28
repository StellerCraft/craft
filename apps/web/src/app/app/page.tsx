'use client';

import { AppShell } from '@/components/app';
import { User, NavItem } from '@/types/navigation';

// Mock data for demonstration
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
  {
    id: 'billing',
    label: 'Billing',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
    path: '/app/billing',
  },
];

export default function AppDashboard() {
  return (
    <AppShell
      user={mockUser}
      navItems={navItems}
      breadcrumbs={[{ label: 'Home' }]}
      status="operational"
      onStatusClick={() => window.open('https://status.craft.com', '_blank')}
    >
      <div className="p-6 lg:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold font-headline text-on-surface mb-2">
              Dashboard
            </h1>
            <p className="text-on-surface-variant">
              Welcome back! Here&apos;s an overview of your projects.
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[
              { label: 'Templates', value: '12', change: '+2 this week' },
              { label: 'Deployments', value: '8', change: '3 active' },
              { label: 'Total Users', value: '1.2k', change: '+15% this month' },
              { label: 'Uptime', value: '99.9%', change: 'Last 30 days' },
            ].map((stat, index) => (
              <div
                key={index}
                className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/10 hover:shadow-md transition-shadow"
              >
                <div className="text-sm text-on-surface-variant mb-1">
                  {stat.label}
                </div>
                <div className="text-3xl font-bold font-headline text-on-surface mb-1">
                  {stat.value}
                </div>
                <div className="text-xs text-on-surface-variant">
                  {stat.change}
                </div>
              </div>
            ))}
          </div>

          {/* Recent Activity */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/10 p-6">
            <h2 className="text-xl font-bold font-headline text-on-surface mb-4">
              Recent Activity
            </h2>
            <div className="space-y-4">
              {[
                { action: 'Deployed', item: 'Stellar DEX Template', time: '2 hours ago' },
                { action: 'Created', item: 'Payment Gateway', time: '5 hours ago' },
                { action: 'Updated', item: 'Trading Bot Config', time: '1 day ago' },
              ].map((activity, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-3 border-b border-outline-variant/10 last:border-0"
                >
                  <div>
                    <span className="font-medium text-on-surface">
                      {activity.action}
                    </span>{' '}
                    <span className="text-on-surface-variant">
                      {activity.item}
                    </span>
                  </div>
                  <div className="text-sm text-on-surface-variant">
                    {activity.time}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
