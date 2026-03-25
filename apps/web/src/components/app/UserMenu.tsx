'use client';

import React, { useState, useRef, useEffect } from 'react';
import { User } from '@/types/navigation';

interface UserMenuProps {
  user: User;
  onProfileClick?: () => void;
  onSettingsClick?: () => void;
  onBillingClick?: () => void;
  onLogoutClick?: () => void;
}

export function UserMenu({
  user,
  onProfileClick,
  onSettingsClick,
  onBillingClick,
  onLogoutClick,
}: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const menuItems = [
    { label: 'Profile', onClick: onProfileClick, icon: '👤' },
    { label: 'Settings', onClick: onSettingsClick, icon: '⚙️' },
    { label: 'Billing', onClick: onBillingClick, icon: '💳' },
    { label: 'Documentation', href: '/docs', icon: '📚', external: true },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1 rounded-lg hover:bg-surface-container transition-colors"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {user.avatar ? (
          <img
            src={user.avatar}
            alt={user.name}
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-sm font-bold">
            {getInitials(user.name)}
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-surface-container-lowest rounded-lg shadow-xl border border-outline-variant/10 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* User Info Header */}
          <div className="px-4 py-3 border-b border-outline-variant/10">
            <div className="flex items-center gap-3">
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
                <div className="font-semibold text-on-surface truncate">
                  {user.name}
                </div>
                <div className="text-xs text-on-surface-variant truncate">
                  {user.email}
                </div>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            {menuItems.map((item, index) => (
              <button
                key={index}
                onClick={() => {
                  item.onClick?.();
                  setIsOpen(false);
                }}
                className="w-full px-4 py-2 text-left text-sm text-on-surface hover:bg-surface-container transition-colors flex items-center gap-3"
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {item.external && (
                  <svg className="w-3 h-3 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Logout */}
          <div className="border-t border-outline-variant/10 pt-2">
            <button
              onClick={() => {
                onLogoutClick?.();
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-left text-sm text-error hover:bg-error-container/20 transition-colors flex items-center gap-3"
            >
              <span>🚪</span>
              <span>Log Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
