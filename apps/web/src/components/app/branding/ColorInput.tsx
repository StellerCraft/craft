'use client';

import React from 'react';

interface ColorInputProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string;
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function ColorInput({ id, label, value, onChange, error }: ColorInputProps) {
    const hasError = !!error;
    const isValidHex = HEX_COLOR.test(value);

    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-sm font-medium text-on-surface">
                {label}
            </label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    value={isValidHex ? (value.length === 4 ? expandShortHex(value) : value) : '#000000'}
                    onChange={(e) => onChange(e.target.value)}
                    aria-label={`${label} picker`}
                    className="h-9 w-9 shrink-0 cursor-pointer rounded border border-outline-variant/30 bg-transparent p-0.5"
                />
                <input
                    id={id}
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="#000000"
                    aria-invalid={hasError}
                    aria-describedby={hasError ? `${id}-error` : undefined}
                    className={`w-full rounded-lg border px-3 py-2 text-sm font-mono text-on-surface bg-surface-container-lowest placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 transition-colors ${
                        hasError
                            ? 'border-error focus:ring-error/40'
                            : 'border-outline-variant/30 focus:ring-primary/40'
                    }`}
                />
            </div>
            {hasError && (
                <p id={`${id}-error`} role="alert" className="text-xs text-error">
                    {error}
                </p>
            )}
        </div>
    );
}

function expandShortHex(hex: string): string {
    const [, r, g, b] = hex.split('');
    return `#${r}${r}${g}${g}${b}${b}`;
}
