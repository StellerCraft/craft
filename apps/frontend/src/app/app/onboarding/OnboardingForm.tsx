'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { completeOnboardingAction } from './actions';
import { CONNECTION_STATUSES, type ProfileState } from '../settings/profile/actions';

const initialState: ProfileState = { status: 'idle', message: '' };

// ---------------------------------------------------------------------------
// Submit button
// ---------------------------------------------------------------------------

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="w-full rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-on-primary
                       hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2
                       disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200
                       flex items-center justify-center gap-2"
        >
            {pending && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
            )}
            {pending ? 'Saving…' : 'Complete setup'}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Inline field error
// ---------------------------------------------------------------------------

function FieldError({ id, message }: { id: string; message?: string }) {
    if (!message) return null;
    return (
        <p id={id} role="alert" className="mt-1 text-xs text-error">
            {message}
        </p>
    );
}

// ---------------------------------------------------------------------------
// Completion state
// ---------------------------------------------------------------------------

function CompletionState() {
    return (
        <div
            role="status"
            aria-live="polite"
            className="text-center space-y-6 py-8"
            data-testid="onboarding-complete"
        >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <svg
                    className="h-8 w-8 text-green-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            </div>
            <div>
                <h2 className="text-2xl font-bold font-headline text-on-surface">
                    You&apos;re all set!
                </h2>
                <p className="mt-2 text-on-surface-variant">
                    Your profile has been saved. Welcome to CRAFT.
                </p>
            </div>
            <Link
                href="/app"
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-primary px-6 py-2.5
                           text-sm font-semibold text-on-primary hover:opacity-90
                           focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2
                           transition-all duration-200"
            >
                Go to dashboard
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
            </Link>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Entry state (the form)
// ---------------------------------------------------------------------------

function EntryState({ state, formAction }: { state: ProfileState; formAction: (payload: FormData) => void }) {
    const inputClasses =
        'w-full rounded-lg border border-outline-variant bg-surface-container-lowest ' +
        'px-3 py-2 text-sm text-on-surface shadow-sm placeholder:text-on-surface-variant/50 ' +
        'focus:outline-none focus:ring-2 focus:ring-surface-tint focus:border-surface-tint ' +
        'disabled:opacity-50 transition-colors';

    const labelClasses = 'block text-sm font-medium text-on-surface mb-1';

    return (
        <form action={formAction} noValidate className="space-y-5" data-testid="onboarding-form">
            {state.status === 'error' && !state.fieldErrors && (
                <div role="alert" className="rounded-lg bg-error-container/50 border border-error/20 px-4 py-3">
                    <p className="text-sm text-on-error-container">{state.message}</p>
                </div>
            )}

            {/* Display Name */}
            <div>
                <label htmlFor="displayName" className={labelClasses}>
                    Display name <span aria-hidden="true" className="text-error">*</span>
                </label>
                <input
                    id="displayName"
                    name="displayName"
                    type="text"
                    required
                    aria-required="true"
                    aria-describedby={state.fieldErrors?.displayName ? 'displayName-error' : undefined}
                    aria-invalid={!!state.fieldErrors?.displayName}
                    placeholder="Your display name"
                    className={`${inputClasses} ${state.fieldErrors?.displayName ? 'border-error focus:ring-error' : ''}`}
                />
                <FieldError id="displayName-error" message={state.fieldErrors?.displayName} />
            </div>

            {/* Bio */}
            <div>
                <label htmlFor="bio" className={labelClasses}>
                    Bio <span className="text-xs text-on-surface-variant font-normal">(optional)</span>
                </label>
                <textarea
                    id="bio"
                    name="bio"
                    rows={3}
                    maxLength={160}
                    aria-describedby={state.fieldErrors?.bio ? 'bio-error' : 'bio-hint'}
                    aria-invalid={!!state.fieldErrors?.bio}
                    placeholder="A short bio about yourself (max 160 characters)"
                    className={`${inputClasses} resize-none ${state.fieldErrors?.bio ? 'border-error focus:ring-error' : ''}`}
                />
                {state.fieldErrors?.bio
                    ? <FieldError id="bio-error" message={state.fieldErrors.bio} />
                    : <p id="bio-hint" className="mt-1 text-xs text-on-surface-variant">160 characters max</p>
                }
            </div>

            {/* Website */}
            <div>
                <label htmlFor="website" className={labelClasses}>
                    Website <span className="text-xs text-on-surface-variant font-normal">(optional)</span>
                </label>
                <input
                    id="website"
                    name="website"
                    type="url"
                    aria-describedby={state.fieldErrors?.website ? 'website-error' : undefined}
                    aria-invalid={!!state.fieldErrors?.website}
                    placeholder="https://yourwebsite.com"
                    className={`${inputClasses} ${state.fieldErrors?.website ? 'border-error focus:ring-error' : ''}`}
                />
                <FieldError id="website-error" message={state.fieldErrors?.website} />
            </div>

            {/* Connection Status */}
            <div>
                <label htmlFor="connectionStatus" className={labelClasses}>
                    Connection status
                </label>
                <select
                    id="connectionStatus"
                    name="connectionStatus"
                    defaultValue="online"
                    aria-describedby={state.fieldErrors?.connectionStatus ? 'connectionStatus-error' : undefined}
                    aria-invalid={!!state.fieldErrors?.connectionStatus}
                    className={`${inputClasses} ${state.fieldErrors?.connectionStatus ? 'border-error focus:ring-error' : ''}`}
                >
                    {CONNECTION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                        </option>
                    ))}
                </select>
                <FieldError id="connectionStatus-error" message={state.fieldErrors?.connectionStatus} />
            </div>

            <SubmitButton />
        </form>
    );
}

// ---------------------------------------------------------------------------
// Main component — switches between entry and completion states
// ---------------------------------------------------------------------------

export default function OnboardingForm() {
    const [state, formAction] = useFormState(completeOnboardingAction, initialState);
    const [completed, setCompleted] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        if (state.status === 'success') {
            // Small delay so the success banner is visible before switching
            timerRef.current = setTimeout(() => setCompleted(true), 300);
        }
        return () => clearTimeout(timerRef.current);
    }, [state]);

    if (completed) return <CompletionState />;

    return <EntryState state={state} formAction={formAction} />;
}
