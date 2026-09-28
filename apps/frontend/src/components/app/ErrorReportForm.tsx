'use client';

import React, { useState } from 'react';
import type { ErrorContext } from '@craft/types';

interface ErrorReportFormProps {
    errorContext: ErrorContext;
    correlationId?: string;
    onClose: () => void;
    /** Injected for testability; defaults to the real API call. */
    onSubmit?: (payload: {
        correlationId?: string;
        description: string;
        errorContext: ErrorContext;
    }) => Promise<void>;
}

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

/**
 * Maximum description length accepted by POST /api/error-reports.
 * Must stay in sync with the backend's zod schema (`description.max(2000)`).
 */
export const MAX_DESCRIPTION_LENGTH = 2000;

async function defaultSubmit(payload: {
    correlationId?: string;
    description: string;
    errorContext: ErrorContext;
}): Promise<void> {
    const res = await fetch('/api/error-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to submit report');
    }
}

/**
 * Modal form for submitting an error report to the support team.
 * Captures a user description and attaches the error context automatically.
 */
export function ErrorReportForm({
    errorContext,
    correlationId,
    onClose,
    onSubmit = defaultSubmit,
}: ErrorReportFormProps) {
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<FormStatus>('idle');
    const [submitError, setSubmitError] = useState<string | null>(null);

    const length = description.length;
    const remaining = MAX_DESCRIPTION_LENGTH - length;
    const isOverLimit = length > MAX_DESCRIPTION_LENGTH;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!description.trim() || isOverLimit) return;

        setStatus('submitting');
        setSubmitError(null);

        try {
            await onSubmit({ correlationId, description: description.trim(), errorContext });
            setStatus('success');
        } catch (err: any) {
            setSubmitError(err.message ?? 'Something went wrong. Please try again.');
            setStatus('error');
        }
    }

    return (
        /* Backdrop */
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="error-report-title"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-surface w-full max-w-md rounded-2xl shadow-xl p-6 flex flex-col gap-4">
                {status === 'success' ? (
                    <div className="flex flex-col items-center text-center gap-3 py-4">
                        <div className="text-4xl">✅</div>
                        <h2 className="text-xl font-bold font-headline text-on-surface">
                            Report submitted
                        </h2>
                        <p className="text-on-surface-variant text-sm">
                            Thanks for letting us know. Our support team will look into it.
                        </p>
                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-2 primary-gradient text-on-primary px-6 py-2.5 rounded-lg font-semibold shadow-md hover:shadow-lg transition-all active:scale-95"
                        >
                            Done
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="flex items-start justify-between gap-2">
                            <h2
                                id="error-report-title"
                                className="text-xl font-bold font-headline text-on-surface"
                            >
                                Report this error
                            </h2>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close"
                                className="text-on-surface-variant hover:text-on-surface transition-colors p-1 rounded"
                            >
                                ✕
                            </button>
                        </div>

                        <p className="text-sm text-on-surface-variant">
                            Describe what you were doing when this happened. We'll include the
                            error details automatically.
                        </p>

                        {correlationId && (
                            <p className="text-xs text-on-surface-variant/60 font-mono bg-surface-container-low px-3 py-1.5 rounded">
                                Ref: {correlationId}
                            </p>
                        )}

                        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label
                                    htmlFor="error-description"
                                    className="text-sm font-medium text-on-surface"
                                >
                                    What were you doing?
                                </label>
                                <textarea
                                    id="error-description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="e.g. I clicked Deploy after filling in the branding form…"
                                    rows={4}
                                    required
                                    aria-invalid={isOverLimit}
                                    aria-describedby={`error-description-counter${isOverLimit ? ' error-description-limit' : ''}`}
                                    className="w-full rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                                />
                                <p
                                    id="error-description-counter"
                                    data-testid="error-description-counter"
                                    aria-live="polite"
                                    className={`text-xs text-right ${remaining < 100 ? 'text-error' : 'text-on-surface-variant/50'}`}
                                >
                                    {length} / {MAX_DESCRIPTION_LENGTH}
                                </p>
                                {isOverLimit && (
                                    <p
                                        id="error-description-limit"
                                        data-testid="error-description-limit"
                                        className="text-xs text-error"
                                    >
                                        Description is {length - MAX_DESCRIPTION_LENGTH} characters over the{' '}
                                        {MAX_DESCRIPTION_LENGTH}-character limit. Please shorten it to submit.
                                    </p>
                                )}
                            </div>

                            {submitError && (
                                <p role="alert" className="text-sm text-error">
                                    {submitError}
                                </p>
                            )}

                            <div className="flex gap-3 justify-end">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2.5 rounded-lg text-sm font-semibold text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low transition-all"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={status === 'submitting' || !description.trim() || isOverLimit}
                                    className="primary-gradient text-on-primary px-5 py-2.5 rounded-lg text-sm font-semibold shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
                                >
                                    {status === 'submitting' ? 'Submitting…' : 'Submit report'}
                                </button>
                            </div>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}
