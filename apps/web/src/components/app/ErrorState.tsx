import React from 'react';
import { RetryButton } from './RetryButton';
import { isRetryableError, getRetryHint, type AppError } from '@/lib/api/retryable-error';

interface ErrorStateProps {
  title?: string;
  message: string;
  errorCode?: string;
  /**
   * When provided, the retry button is only shown if the error is retryable
   * (network failures, 429, 5xx). Pass the raw AppError so the component can
   * make that determination. If omitted, the retry button is always shown when
   * onRetry is provided (backwards-compatible).
   */
  error?: AppError;
  onRetry?: () => Promise<void> | void;
  onSupport?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  errorCode,
  error,
  onRetry,
  onSupport,
}: ErrorStateProps) {
  // If an error object is provided, gate the retry button on retryability.
  // If no error object is provided, fall back to showing retry whenever onRetry exists.
  const showRetry = onRetry !== undefined && (error === undefined || isRetryableError(error));
  const retryHint = error ? getRetryHint(error) : undefined;

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

      {retryHint && (
        <p className="text-sm text-on-surface-variant/70 max-w-md mb-2 leading-relaxed">
          {retryHint}
        </p>
      )}

      {errorCode && (
        <p className="text-xs text-on-surface-variant/60 mb-8 font-mono">
          {errorCode}
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        {showRetry && <RetryButton onRetry={onRetry} />}

        {onSupport && (
          <button
            type="button"
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
