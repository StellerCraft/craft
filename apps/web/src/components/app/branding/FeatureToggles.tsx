'use client';

import React from 'react';
import type { FeatureConfig } from '@craft/types';

interface FeatureTogglesProps {
    value: FeatureConfig;
    onChange: (value: FeatureConfig) => void;
}

interface ToggleItem {
    key: keyof FeatureConfig;
    label: string;
    description: string;
}

const TOGGLES: ToggleItem[] = [
    {
        key: 'enableCharts',
        label: 'Charts',
        description: 'Display interactive price and volume charts',
    },
    {
        key: 'enableTransactionHistory',
        label: 'Transaction history',
        description: 'Show a history of past transactions',
    },
    {
        key: 'enableAnalytics',
        label: 'Analytics',
        description: 'Include analytics and performance dashboards',
    },
    {
        key: 'enableNotifications',
        label: 'Notifications',
        description: 'Enable in-app notification system',
    },
];

export function FeatureToggles({ value, onChange }: FeatureTogglesProps) {
    function handleToggle(key: keyof FeatureConfig) {
        onChange({ ...value, [key]: !value[key] });
    }

    return (
        <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-on-surface mb-3">
                Feature toggles
            </legend>
            <div className="flex flex-col divide-y divide-outline-variant/20">
                {TOGGLES.map(({ key, label, description }) => (
                    <label
                        key={key}
                        htmlFor={`toggle-${key}`}
                        className="flex items-center justify-between gap-4 py-3 cursor-pointer"
                    >
                        <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium text-on-surface">
                                {label}
                            </span>
                            <span className="text-xs text-on-surface-variant">
                                {description}
                            </span>
                        </div>
                        <button
                            id={`toggle-${key}`}
                            type="button"
                            role="switch"
                            aria-checked={value[key]}
                            onClick={() => handleToggle(key)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 ${
                                value[key]
                                    ? 'bg-primary'
                                    : 'bg-outline-variant/40'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                                    value[key] ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
