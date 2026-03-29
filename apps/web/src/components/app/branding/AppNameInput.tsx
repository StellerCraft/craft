'use client';

import React from 'react';

interface AppNameInputProps {
    value: string;
    onChange: (value: string) => void;
    error?: string;
    maxLength?: number;
}

const MAX_APP_NAME = 60;

export function AppNameInput({
    value,
    onChange,
    error,
    maxLength = MAX_APP_NAME,
}: AppNameInputProps) {
    const remaining = maxLength - value.length;
    const hasError = !!error;

    return (
        <div className="flex flex-col gap-1.5">
            <label
                htmlFor="branding-app-name"
                className="text-sm font-medium text-on-surface"
            >
                App name
            </label>
            <input
                id="branding-app-name"
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
                placeholder="My DeFi App"
                aria-invalid={hasError}
                aria-describedby={hasError ? 'app-name-error' : undefined}
                className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface bg-surface-container-lowest placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 transition-colors ${
                    hasError
                        ? 'border-error focus:ring-error/40'
                        : 'border-outline-variant/30 focus:ring-primary/40'
                }`}
            />
            <div className="flex justify-between">
                {hasError ? (
                    <p id="app-name-error" role="alert" className="text-xs text-error">
                        {error}
                    </p>
                ) : (
                    <span />
                )}
                <p
                    className={`text-xs ${
                        remaining < 10 ? 'text-error' : 'text-on-surface-variant/50'
                    }`}
                >
                    {remaining} remaining
                </p>
            </div>
        </div>
    );
}
