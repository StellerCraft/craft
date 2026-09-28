import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { StellarConfigPanel } from './StellarConfigPanel';
import type { StellarConfigFormReturn } from './useStellarConfigForm';

function createMockForm(overrides: Partial<StellarConfigFormReturn> = {}): StellarConfigFormReturn {
    return {
        state: {
            network: 'testnet',
            horizonUrl: 'https://horizon-testnet.stellar.org',
            sorobanRpcUrl: '',
            assetPairs: [],
            contractAddresses: {},
        },
        errors: new Map(),
        isDirty: false,
        setField: vi.fn(),
        setAssetPairs: vi.fn(),
        setContractAddress: vi.fn(),
        removeContractAddress: vi.fn(),
        validate: vi.fn(() => []),
        reset: vi.fn(),
        ...overrides,
    };
}

describe('StellarConfigPanel - Connection Status Re-validation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders initial connected status badge', async () => {
        const getConnectionStatus = vi.fn().mockResolvedValue({ stellar: true });

        render(
            <StellarConfigPanel
                form={createMockForm()}
                onSubmit={vi.fn()}
                getConnectionStatus={getConnectionStatus}
                initialConnected={true}
            />,
        );

        await act(async () => {
            await Promise.resolve();
        });

        const badge = screen.getByTestId('stellar-connection-badge');
        expect(badge.getAttribute('data-status')).toBe('connected');
        expect(badge.textContent).toBe('connected');
    });

    it('re-fetches connection status on window focus after an out-of-band disconnect and updates badge', async () => {
        let isConnectedServerSide = true;
        const getConnectionStatus = vi.fn().mockImplementation(async () => ({
            stellar: isConnectedServerSide,
        }));

        render(
            <StellarConfigPanel
                form={createMockForm()}
                onSubmit={vi.fn()}
                getConnectionStatus={getConnectionStatus}
                initialConnected={true}
                debounceDelayMs={100}
            />,
        );

        await act(async () => {
            await Promise.resolve();
        });

        const badge = screen.getByTestId('stellar-connection-badge');
        expect(badge.getAttribute('data-status')).toBe('connected');

        // Simulate out-of-band disconnect (e.g. extension revokes access or another tab disconnects)
        isConnectedServerSide = false;

        // Simulate window focus event
        act(() => {
            window.dispatchEvent(new Event('focus'));
        });

        // Fast-forward debounce timer
        await act(async () => {
            vi.advanceTimersByTime(150);
            await Promise.resolve();
        });

        expect(getConnectionStatus).toHaveBeenCalledTimes(2);
        expect(badge.getAttribute('data-status')).toBe('disconnected');
        expect(badge.textContent).toBe('disconnected');
    });

    it('re-fetches connection status on document visibilitychange when tab becomes visible', async () => {
        let isConnectedServerSide = true;
        const getConnectionStatus = vi.fn().mockImplementation(async () => ({
            stellar: isConnectedServerSide,
        }));

        render(
            <StellarConfigPanel
                form={createMockForm()}
                onSubmit={vi.fn()}
                getConnectionStatus={getConnectionStatus}
                initialConnected={true}
                debounceDelayMs={100}
            />,
        );

        await act(async () => {
            await Promise.resolve();
        });

        isConnectedServerSide = false;

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });

        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        await act(async () => {
            vi.advanceTimersByTime(150);
            await Promise.resolve();
        });

        const badge = screen.getByTestId('stellar-connection-badge');
        expect(badge.getAttribute('data-status')).toBe('disconnected');
    });

    it('debounces rapid focus events to avoid redundant requests', async () => {
        const getConnectionStatus = vi.fn().mockResolvedValue({ stellar: true });

        render(
            <StellarConfigPanel
                form={createMockForm()}
                onSubmit={vi.fn()}
                getConnectionStatus={getConnectionStatus}
                debounceDelayMs={100}
            />,
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(getConnectionStatus).toHaveBeenCalledTimes(1);

        // Rapid focus events within debounce window
        act(() => {
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('focus'));
            window.dispatchEvent(new Event('focus'));
        });

        await act(async () => {
            vi.advanceTimersByTime(50);
        });

        expect(getConnectionStatus).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(100);
            await Promise.resolve();
        });

        expect(getConnectionStatus).toHaveBeenCalledTimes(2);
    });
});
