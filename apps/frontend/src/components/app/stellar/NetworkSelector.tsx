'use client';

import React from 'react';

type Network = 'mainnet' | 'testnet';

interface NetworkSelectorProps {
    value: Network;
    onChange: (value: Network) => void;
    error?: string;
}

const NETWORKS: { value: Network; label: string; description: string }[] = [
    {
        value: 'testnet',
        label: 'Testnet',
        description: 'Stellar test network — safe for development',
    },
    {
        value: 'mainnet',
        label: 'Mainnet',
        description: 'Stellar public network — real assets',
    },
];

export function NetworkSelector({ value, onChange, error }: NetworkSelectorProps) {
    const hasError = !!error;

    return (
        <div className="flex flex-col gap-1.5">
            <fieldset>
                <legend className="text-sm font-medium text-on-surface mb-2">
                    Network
                </legend>
                <div
                    className="flex gap-3"
                    role="radiogroup"
                    aria-label="Stellar network"
                    aria-invalid={hasError}
                    aria-describedby={hasError ? 'network-error' : undefined}
                >
                    {NETWORKS.map((net) => {
                        const checked = value === net.value;
                        return (
                            <label
                                key={net.value}
                                className={`flex-1 flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                                    checked
                                        ? 'border-primary bg-primary/5'
                                        : 'border-outline-variant/30 hover:bg-surface-container-low'
                                } ${hasError ? 'border-error' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="stellar-network"
                                    value={net.value}
                                    checked={checked}
                                    onChange={() => onChange(net.value)}
                                    className="mt-0.5 accent-primary"
                                    aria-label={net.label}
                                />
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-semibold text-on-surface">
                                        {net.label}
                                    </span>
                                    <span className="text-xs text-on-surface-variant">
                                        {net.description}
                                    </span>
                                </div>
                            </label>
                        );
                    })}
                </div>
            </fieldset>
            {hasError && (
                <p id="network-error" role="alert" className="text-xs text-error">
                    {error}
                </p>
            )}
        </div>
    );
}
