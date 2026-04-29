'use client';

import React from 'react';
import type { ConnectivityStatus } from './useStellarConfigForm';
import type { ConnectivityCheckResult } from '@/lib/stellar/endpoint-connectivity';

interface SorobanRpcInputProps {
    value: string;
    onChange: (value: string) => void;
    onCheckConnectivity: () => void;
    connectivityStatus: ConnectivityStatus;
    connectivityResult: ConnectivityCheckResult | null;
    error?: string;
}

const STATUS_ICONS: Record<ConnectivityStatus, string> = {
    idle: '',
    checking: '⏳',
    ok: '✓',
    error: '✗',
};

const STATUS_CLASSES: Record<ConnectivityStatus, string> = {
    idle: 'text-on-surface-variant',
    checking: 'text-on-surface-variant',
    ok: 'text-success',
    error: 'text-error',
};

export function SorobanRpcInput({
    value,
    onChange,
    onCheckConnectivity,
    connectivityStatus,
    connectivityResult,
    error,
}: SorobanRpcInputProps) {
    const hasError = !!error;
    const statusDescId = 'soroban-rpc-status';
    const errorId = 'soroban-rpc-error';

    const statusMessage = (() => {
        if (connectivityStatus === 'checking') return 'Checking connectivity…';
        if (connectivityStatus === 'ok') {
            const ms = connectivityResult?.responseTime;
            return ms !== undefined ? `Reachable (${Math.round(ms)}ms)` : 'Reachable';
        }
        if (connectivityStatus === 'error') {
            return connectivityResult?.error ?? 'Endpoint unreachable';
        }
        return null;
    })();

    return (
        <div className="flex flex-col gap-1.5">
            <label htmlFor="soroban-rpc-url" className="text-sm font-medium text-on-surface">
                Soroban RPC URL
                <span className="ml-1.5 text-xs font-normal text-on-surface-variant">(optional)</span>
            </label>
            <div className="flex gap-2">
                <input
                    id="soroban-rpc-url"
                    type="url"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="https://soroban-testnet.stellar.org"
                    aria-invalid={hasError}
                    aria-describedby={
                        [hasError ? errorId : '', statusMessage ? statusDescId : '']
                            .filter(Boolean)
                            .join(' ') || undefined
                    }
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm text-on-surface bg-surface-container-lowest placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 transition-colors ${
                        hasError
                            ? 'border-error focus:ring-error/40'
                            : 'border-outline-variant/30 focus:ring-primary/40'
                    }`}
                />
                <button
                    type="button"
                    onClick={onCheckConnectivity}
                    disabled={connectivityStatus === 'checking' || !value}
                    aria-label="Check Soroban RPC connectivity"
                    className="shrink-0 px-3 py-2 rounded-lg border border-outline-variant/30 text-sm text-on-surface-variant hover:bg-surface-container-low transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {connectivityStatus === 'checking' ? 'Checking…' : 'Check'}
                </button>
            </div>
            {hasError && (
                <p id={errorId} role="alert" className="text-xs text-error">
                    {error}
                </p>
            )}
            {statusMessage && (
                <p
                    id={statusDescId}
                    className={`text-xs flex items-center gap-1 ${STATUS_CLASSES[connectivityStatus]}`}
                >
                    <span aria-hidden="true">{STATUS_ICONS[connectivityStatus]}</span>
                    {statusMessage}
                </p>
            )}
        </div>
    );
}
