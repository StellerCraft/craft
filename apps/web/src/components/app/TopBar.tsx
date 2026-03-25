'use client';

import React from 'react';
import { Breadcrumbs } from './Breadcrumbs';
import { StatusBadge } from './StatusBadge';
import { UserMenu } from './UserMenu';
import { User, Breadcrumb, StatusType } from '@/types/navigation';

interface TopBarProps {
  breadcrumbs?: Breadcrumb[];
  user: User;
  status?: StatusType;
  onStatusClick?: () => void;
  onMobileMenuClick?: () => void;
  showMobileMenu?: boolean;
}

export function TopBar({
  breadcrumbs = [],
  user,
  status = 'operational',
  onStatusClick,
  onMobileMenuClick,
  showMobileMenu = true,
}: TopBarProps) {
  return (
    <header className="h-16 bg-surface-container-lowest border-b border-outline-variant/10 sticky top-0 z-40">
      <div className="h-full flex items-center justify-between px-6 gap-4">
        {/* Left Section */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Mobile Menu Button */}
          {showMobileMenu && (
            <button
              onClick={onMobileMenuClick}
              className="md:hidden p-2 -ml-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          )}

          {/* Breadcrumbs */}
          <div className="flex-1 min-w-0">
            <Breadcrumbs items={breadcrumbs} />
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-4">
          {/* Status Badge */}
          <div className="hidden sm:block">
            <StatusBadge status={status} onClick={onStatusClick} />
          </div>

          {/* User Menu */}
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
