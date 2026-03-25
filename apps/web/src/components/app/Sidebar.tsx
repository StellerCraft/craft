'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavItem } from './NavItem';
import { User, NavItem as NavItemType } from '@/types/navigation';

interface SidebarProps {
  user: User;
  navItems: NavItemType[];
  onNavigate?: (path: string) => void;
}

export function Sidebar({ user, navItems, onNavigate }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (itemPath: string): boolean => {
    if (itemPath === '/app') {
      return pathname === '/app';
    }
    return pathname.startsWith(itemPath);
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <aside className="hidden md:flex flex-col w-60 bg-surface-container-low border-r border-outline-variant/10 h-screen fixed left-0 top-0 z-50">
      {/* Header */}
      <div className="h-16 flex items-center px-6 border-b border-outline-variant/10">
        <Link 
          href="/app" 
          className="text-xl font-bold tracking-tighter text-primary font-headline"
        >
          CRAFT
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-6 px-3">
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavItem
              key={item.id}
              {...item}
              active={isActive(item.path)}
              onClick={() => onNavigate?.(item.path)}
            />
          ))}
        </div>
      </nav>

      {/* Footer - User Card */}
      <div className="p-4 border-t border-outline-variant/10">
        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-container transition-colors cursor-pointer">
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name}
              className="w-10 h-10 rounded-full"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center text-sm font-bold">
              {getInitials(user.name)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-on-surface text-sm truncate">
              {user.name}
            </div>
            <div className="text-xs text-on-surface-variant truncate">
              {user.email}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
