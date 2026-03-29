'use client';

import React from 'react';

interface FontSelectorProps {
    value: string;
    onChange: (value: string) => void;
    error?: string;
}

const FONT_OPTIONS = [
    'Inter',
    'Manrope',
    'Roboto',
    'Open Sans',
    'Lato',
    'Poppins',
    'Montserrat',
    'Source Sans 3',
    'Nunito',
    'Raleway',
];

export function FontSelector({ value, onChange, error }: FontSelectorProps) {
    const hasError = !!error;

    return (
        <div className="flex flex-col gap-1.5">
            <label
                htmlFor="branding-font-family"
                className="text-sm font-medium text-on-surface"
            >
                Font family
            </label>
            <select
                id="branding-font-family"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-invalid={hasError}
                aria-describedby={hasError ? 'font-family-error' : undefined}
                className={`w-full rounded-lg border px-3 py-2 text-sm text-on-surface bg-surface-container-lowest focus:outline-none focus:ring-2 transition-colors ${
                    hasError
                        ? 'border-error focus:ring-error/40'
                        : 'border-outline-variant/30 focus:ring-primary/40'
                }`}
            >
                <option value="">Select a font…</option>
                {FONT_OPTIONS.map((font) => (
                    <option key={font} value={font}>
                        {font}
                    </option>
                ))}
            </select>
            {hasError && (
                <p id="font-family-error" role="alert" className="text-xs text-error">
                    {error}
                </p>
            )}
            {value && (
                <p
                    className="text-sm text-on-surface-variant"
                    style={{ fontFamily: value }}
                >
                    The quick brown fox jumps over the lazy dog
                </p>
            )}
        </div>
    );
}

export { FONT_OPTIONS };
