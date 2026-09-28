import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SorobanRpcInput } from './SorobanRpcInput';
import type { ConnectivityStatus } from './useStellarConfigForm';
import type { ConnectivityCheckResult } from '@/lib/stellar/endpoint-connectivity';

describe('SorobanRpcInput component tests (#1291)', () => {
    const defaultProps = {
        value: 'https://soroban-testnet.stellar.org',
        onChange: vi.fn(),
        onCheckConnectivity: vi.fn(),
        connectivityStatus: 'idle' as ConnectivityStatus,
        connectivityResult: null as ConnectivityCheckResult | null,
    };

    it('renders in idle state with input and Check button', () => {
        render(<SorobanRpcInput {...defaultProps} connectivityStatus="idle" />);
        const input = screen.getByLabelText(/Soroban RPC URL/i);
        expect(input).toBeDefined();
        const button = screen.getByRole('button', { name: 'Check Soroban RPC connectivity' });
        expect(button).toBeDefined();
        expect(button.textContent).toBe('Check');
        expect((button as HTMLButtonElement).disabled).toBe(false);
        expect(screen.queryByText(/Checking connectivity/i)).toBeNull();
        expect(screen.queryByText(/Reachable/i)).toBeNull();
    });

    it('renders checking state with accessible status message and disabled button', () => {
        render(<SorobanRpcInput {...defaultProps} connectivityStatus="checking" />);
        const button = screen.getByRole('button', { name: 'Check Soroban RPC connectivity' });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(button.textContent).toBe('Checking…');
        const statusMsg = screen.getByText('Checking connectivity…');
        expect(statusMsg).toBeDefined();
        expect(statusMsg.id).toBe('soroban-rpc-status');
        const input = screen.getByLabelText(/Soroban RPC URL/i);
        expect(input.getAttribute('aria-describedby')).toContain('soroban-rpc-status');
    });

    it('renders ok state with reachable status and response time', () => {
        const result: ConnectivityCheckResult = {
            reachable: true,
            endpoint: 'https://soroban-testnet.stellar.org',
            responseTime: 55.6,
        };
        render(
            <SorobanRpcInput
                {...defaultProps}
                connectivityStatus="ok"
                connectivityResult={result}
            />,
        );
        const statusMsg = screen.getByText('Reachable (56ms)');
        expect(statusMsg).toBeDefined();
        const input = screen.getByLabelText(/Soroban RPC URL/i);
        expect(input.getAttribute('aria-describedby')).toContain('soroban-rpc-status');
    });

    it('renders ok state with reachable status without response time', () => {
        const result: ConnectivityCheckResult = {
            reachable: true,
            endpoint: 'https://soroban-testnet.stellar.org',
        };
        render(
            <SorobanRpcInput
                {...defaultProps}
                connectivityStatus="ok"
                connectivityResult={result}
            />,
        );
        expect(screen.getByText('Reachable')).toBeDefined();
    });

    it('renders error state with accessible error message from result', () => {
        const result: ConnectivityCheckResult = {
            reachable: false,
            endpoint: 'https://soroban-testnet.stellar.org',
            error: 'Soroban RPC returned 503',
        };
        render(
            <SorobanRpcInput
                {...defaultProps}
                connectivityStatus="error"
                connectivityResult={result}
            />,
        );
        const statusMsg = screen.getByText('Soroban RPC returned 503');
        expect(statusMsg).toBeDefined();
        const input = screen.getByLabelText(/Soroban RPC URL/i);
        expect(input.getAttribute('aria-describedby')).toContain('soroban-rpc-status');
    });

    it('renders error state with fallback error message when result error is absent', () => {
        render(
            <SorobanRpcInput
                {...defaultProps}
                connectivityStatus="error"
                connectivityResult={null}
            />,
        );
        expect(screen.getByText('Endpoint unreachable')).toBeDefined();
    });

    it('renders validation error message and associates alert role and aria-describedby', () => {
        render(
            <SorobanRpcInput
                {...defaultProps}
                error="Invalid Soroban RPC URL"
            />,
        );
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toBe('Invalid Soroban RPC URL');
        const input = screen.getByLabelText(/Soroban RPC URL/i);
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toContain('soroban-rpc-error');
    });

    it('does not render error paragraph when error is absent', () => {
        render(<SorobanRpcInput {...defaultProps} error={undefined} />);
        expect(screen.queryByRole('alert')).toBeNull();
        const input = screen.getByLabelText(/Soroban RPC URL/i);
        expect(input.getAttribute('aria-invalid')).toBe('false');
    });

    it('fires onCheckConnectivity on button click', () => {
        const onCheck = vi.fn();
        render(<SorobanRpcInput {...defaultProps} onCheckConnectivity={onCheck} />);
        const button = screen.getByRole('button', { name: 'Check Soroban RPC connectivity' });
        fireEvent.click(button);
        expect(onCheck).toHaveBeenCalledOnce();
    });

    it('disables Check button when value is empty', () => {
        render(<SorobanRpcInput {...defaultProps} value="" />);
        const button = screen.getByRole('button', { name: 'Check Soroban RPC connectivity' });
        expect((button as HTMLButtonElement).disabled).toBe(true);
    });
});
