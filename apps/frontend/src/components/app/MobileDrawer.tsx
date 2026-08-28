'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavItem } from './NavItem';
import { User, NavItem as NavItemType } from '@/types/navigation';
import { getInitials } from '@/lib/format/initials';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  user: User;
  navItems: NavItemType[];
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function MobileDrawer({ open, onClose, user, navItems }: MobileDrawerProps) {
  const pathname = usePathname();
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Close drawer on route change
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Move focus into the drawer when it opens; restore it to the trigger on close
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      closeButtonRef.current?.focus();
    } else {
      triggerRef.current?.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // Handle escape key and trap Tab/Shift+Tab within the drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = getFocusableElements(drawerRef.current);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !drawerRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !drawerRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const isActive = (itemPath: string): boolean => {
    if (itemPath === '/app') {
      return pathname === '/app';
    }
    return pathname.startsWith(itemPath);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-50 md:hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal={open}
        className={`fixed top-0 left-0 h-full w-72 bg-surface-container-low z-50 md:hidden transform transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Mobile navigation"
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-outline-variant/10">
          <Link 
            href="/app" 
            className="text-xl font-bold tracking-tighter text-primary font-headline"
          >
            CRAFT
          </Link>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 -mr-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors"
            aria-label="Close menu"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-6 px-3">
          <div className="space-y-1">
            {navItems.map((item) => (
              <NavItem
                key={item.id}
                {...item}
                active={isActive(item.path)}
              />
            ))}
          </div>
        </nav>

        {/* Footer - User Section */}
        <div className="p-4 border-t border-outline-variant/10">
          <div className="flex items-center gap-3 p-2 mb-3 rounded-lg bg-surface-container">
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

          {/* Quick Actions */}
          <div className="space-y-1">
            <Link
              href="/app/profile"
              className="block px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors"
            >
              Profile
            </Link>
            <Link
              href="/app/settings"
              className="block px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors"
            >
              Settings
            </Link>
            <button
              className="w-full text-left px-3 py-2 text-sm text-error hover:bg-error-container/20 rounded-lg transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
