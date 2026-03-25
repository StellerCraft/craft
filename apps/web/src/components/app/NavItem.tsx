'use client';

import React from 'react';
import Link from 'next/link';

interface NavItemProps {
  label: string;
  icon: React.ReactNode;
  path: string;
  active?: boolean;
  badge?: number;
  disabled?: boolean;
  onClick?: () => void;
}

export function NavItem({
  label,
  icon,
  path,
  active = false,
  badge,
  disabled = false,
  onClick,
}: NavItemProps) {
  const baseClasses = 'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-150 text-sm font-medium';
  
  const stateClasses = disabled
    ? 'opacity-40 cursor-not-allowed'
    : active
    ? 'bg-secondary-container text-on-secondary-container font-semibold border-l-3 border-surface-tint'
    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface';

  const content = (
    <>
      <span className="w-5 h-5 flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="px-2 py-0.5 text-xs font-bold bg-tertiary-fixed-dim text-tertiary-container rounded-full">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </>
  );

  if (disabled) {
    return (
      <div className={`${baseClasses} ${stateClasses}`}>
        {content}
      </div>
    );
  }

  return (
    <Link
      href={path}
      className={`${baseClasses} ${stateClasses}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      {content}
    </Link>
  );
}
