import React from 'react';

interface ErrorStateProps {
  title?: string;
  message: string;
  errorCode?: string;
  onRetry?: () => void;
  onSupport?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  errorCode,
  onRetry,
  onSupport,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-6xl mb-6">
        ⚠️
      </div>
      
      <h3 className="text-2xl font-bold font-headline text-on-surface mb-3">
        {title}
      </h3>
      
      <p className="text-on-surface-variant max-w-md mb-2 leading-relaxed">
        {message}
      </p>
      
      {errorCode && (
        <p className="text-xs text-on-surface-variant/60 mb-8 font-mono">
          {errorCode}
        </p>
      )}
      
      <div className="flex flex-col sm:flex-row gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="primary-gradient text-on-primary px-6 py-3 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all active:scale-95"
          >
            Try Again
          </button>
        )}
        
        {onSupport && (
          <button
            onClick={onSupport}
            className="bg-surface-container-lowest text-primary px-6 py-3 rounded-lg font-semibold border border-outline-variant/20 hover:bg-surface-container-low transition-all active:scale-95"
          >
            Contact Support
          </button>
        )}
      </div>
    </div>
  );
}
