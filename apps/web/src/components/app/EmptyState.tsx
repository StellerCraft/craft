import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-6xl mb-6 opacity-50">
        {icon}
      </div>
      
      <h3 className="text-2xl font-bold font-headline text-on-surface mb-3">
        {title}
      </h3>
      
      <p className="text-on-surface-variant max-w-md mb-8 leading-relaxed">
        {description}
      </p>
      
      <div className="flex flex-col sm:flex-row gap-3">
        {primaryAction && (
          <button
            onClick={primaryAction.onClick}
            className="primary-gradient text-on-primary px-6 py-3 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all active:scale-95"
          >
            {primaryAction.label}
          </button>
        )}
        
        {secondaryAction && (
          <button
            onClick={secondaryAction.onClick}
            className="bg-surface-container-lowest text-primary px-6 py-3 rounded-lg font-semibold border border-outline-variant/20 hover:bg-surface-container-low transition-all active:scale-95"
          >
            {secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}
