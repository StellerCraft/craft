'use client';

import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileDrawer } from './MobileDrawer';
import { User, NavItem, Breadcrumb, StatusType } from '@/types/navigation';

interface AppShellProps {
  children: React.ReactNode;
  user: User;
  navItems: NavItem[];
  breadcrumbs?: Breadcrumb[];
  status?: StatusType;
  onLogout?: () => void;
  onStatusClick?: () => void;
}

export function AppShell({
  children,
  user,
  navItems,
  breadcrumbs = [],
  status = 'operational',
  onLogout,
  onStatusClick,
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar - Desktop */}
      <Sidebar user={user} navItems={navItems} />

      {/* Mobile Drawer */}
      <MobileDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        user={user}
        navItems={navItems}
      />

      {/* Main Content Area */}
      <div className="md:pl-60">
        {/* Top Bar */}
        <TopBar
          breadcrumbs={breadcrumbs}
          user={user}
          status={status}
          onStatusClick={onStatusClick}
          onMobileMenuClick={() => setMobileMenuOpen(true)}
        />

        {/* Page Content */}
        <main className="min-h-[calc(100vh-4rem)]">
          {children}
        </main>
      </div>
    </div>
  );
}
