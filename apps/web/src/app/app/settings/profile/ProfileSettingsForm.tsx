'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { updateProfileAction, type ProfileState } from './actions';

const initialState: ProfileState = { status: 'idle', message: '' };

// ---------------------------------------------------------------------------
// Save button with optimistic feedback via useFormStatus
// ---------------------------------------------------------------------------

function SaveButton({ savedRecently }: { savedRecently: boolean }) {
    const { pending } = useFormStatus();

    let label = 'Save changes';
    if (pending) label = 'Saving…';
    else if (savedRecently) label = 'Saved!';

    return (
        <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold
                transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2
                disabled:opacity-60 disabled:cursor-not-allowed
                ${savedRecently && !pending
                    ? 'bg-green-600 text-white'
                    : 'bg-gradient-primary text-on-primary hover:opacity-90'
                }`}
        >
            {pending && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
            )}
            {label}
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
// Main form
// ---------------------------------------------------------------------------

interface ProfileSettingsFormProps {
    defaultValues?: {
        displayName?: string;
        email?: string;
        bio?: string;
        avatarUrl?: string;
    };
}

export default function ProfileSettingsForm({ defaultValues }: ProfileSettingsFormProps) {
    const [state, formAction] = useFormState(updateProfileAction, initialState);
    const [savedRecently, setSavedRecently] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    // Flash "Saved!" for 2 seconds after a successful save
    useEffect(() => {
        if (state.status === 'success') {
            setSavedRecently(true);
            timerRef.current = setTimeout(() => setSavedRecently(false), 2000);
        }
        return () => clearTimeout(timerRef.current);
    }, [state]);

    const inputClasses =
        'w-full rounded-lg border border-outline-variant bg-surface-container-lowest ' +
        'px-3 py-2 text-sm text-on-surface shadow-sm placeholder:text-on-surface-variant/50 ' +
        'focus:outline-none focus:ring-2 focus:ring-surface-tint focus:border-surface-tint ' +
        'disabled:opacity-50 transition-colors';

    const labelClasses = 'block text-sm font-medium text-on-surface mb-1';

    return (
        <form action={formAction} noValidate className="space-y-6">
            {/* Form-level banner */}
            {state.status === 'error' && !state.fieldErrors && (
                <div role="alert" className="rounded-lg bg-error-container/50 border border-error/20 px-4 py-3">
                    <p className="text-sm text-on-error-container">{state.message}</p>
                </div>
            )}

            {state.status === 'success' && (
                <div role="status" className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                    <p className="text-sm text-green-800">{state.message}</p>
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
                    defaultValue={defaultValues?.displayName ?? ''}
                    placeholder="Your display name"
                    className={`${inputClasses} ${state.fieldErrors?.displayName ? 'border-error focus:ring-error' : ''}`}
                />
                <FieldError id="displayName-error" message={state.fieldErrors?.displayName} />
            </div>

            {/* Email (read-only) */}
            <div>
                <label htmlFor="email" className={labelClasses}>
                    Email address
                </label>
                <input
                    id="email"
                    name="email"
                    type="email"
                    disabled
                    readOnly
                    value={defaultValues?.email ?? ''}
                    className={`${inputClasses} cursor-not-allowed`}
                />
                <p className="mt-1 text-xs text-on-surface-variant">
                    Email cannot be changed here. Contact support if you need to update it.
                </p>
            </div>

            {/* Bio */}
            <div>
                <label htmlFor="bio" className={labelClasses}>
                    Bio
                </label>
                <textarea
                    id="bio"
                    name="bio"
                    rows={3}
                    maxLength={160}
                    aria-describedby={state.fieldErrors?.bio ? 'bio-error' : 'bio-hint'}
                    aria-invalid={!!state.fieldErrors?.bio}
                    defaultValue={defaultValues?.bio ?? ''}
                    placeholder="A short bio about yourself (max 160 characters)"
                    className={`${inputClasses} resize-none ${state.fieldErrors?.bio ? 'border-error focus:ring-error' : ''}`}
                />
                {state.fieldErrors?.bio
                    ? <FieldError id="bio-error" message={state.fieldErrors.bio} />
                    : <p id="bio-hint" className="mt-1 text-xs text-on-surface-variant">160 characters max</p>
                }
            </div>

            {/* Avatar URL */}
            <div>
                <label htmlFor="avatarUrl" className={labelClasses}>
                    Avatar URL
                </label>
                <input
                    id="avatarUrl"
                    name="avatarUrl"
                    type="url"
                    aria-describedby={state.fieldErrors?.avatarUrl ? 'avatarUrl-error' : undefined}
                    aria-invalid={!!state.fieldErrors?.avatarUrl}
                    defaultValue={defaultValues?.avatarUrl ?? ''}
                    placeholder="https://example.com/avatar.jpg"
                    className={`${inputClasses} ${state.fieldErrors?.avatarUrl ? 'border-error focus:ring-error' : ''}`}
                />
                <FieldError id="avatarUrl-error" message={state.fieldErrors?.avatarUrl} />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end pt-2">
                <SaveButton savedRecently={savedRecently} />
            </div>
        </form>
    );
}
