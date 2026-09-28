import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HorizonUrlInput } from './HorizonUrlInput';
import type { ConnectivityStatus } from './useStellarConfigForm';
import type { ConnectivityCheckResult } from '@/lib/stellar/endpoint-connectivity';

describe('HorizonUrlInput component tests (#1291)', () => {
    const defaultProps = {
        value: 'https://horizon-testnet.stellar.org',
        onChange: vi.fn(),
        onCheckConnectivity: vi.fn(),
        connectivityStatus: 'idle' as ConnectivityStatus,
        connectivityResult: null as ConnectivityCheckResult | null,
    };

    it('renders in idle state with input and Check button', () => {
        render(<HorizonUrlInput {...defaultProps} connectivityStatus="idle" />);
        const input = screen.getByLabelText('Horizon URL');
        expect(input).toBeDefined();
        const button = screen.getByRole('button', { name: 'Check connectivity' });
        expect(button).toBeDefined();
        expect(button.textContent).toBe('Check');
        expect((button as HTMLButtonElement).disabled).toBe(false);
        expect(screen.queryByText(/Checking connectivity/i)).toBeNull();
        expect(screen.queryByText(/Reachable/i)).toBeNull();
    });

    it('renders checking state with accessible status message and disabled button', () => {
        render(<HorizonUrlInput {...defaultProps} connectivityStatus="checking" />);
        const button = screen.getByRole('button', { name: 'Check connectivity' });
        expect((button as HTMLButtonElement).disabled).toBe(true);
        expect(button.textContent).toBe('Checking…');
        const statusMsg = screen.getByText('Checking connectivity…');
        expect(statusMsg).toBeDefined();
        expect(statusMsg.id).toBe('horizon-url-status');
        const input = screen.getByLabelText('Horizon URL');
        expect(input.getAttribute('aria-describedby')).toContain('horizon-url-status');
    });

    it('renders ok state with reachable status and response time', () => {
        const result: ConnectivityCheckResult = {
            reachable: true,
            endpoint: 'https://horizon-testnet.stellar.org',
            responseTime: 42.4,
        };
        render(
            <HorizonUrlInput
                {...defaultProps}
                connectivityStatus="ok"
                connectivityResult={result}
            />,
        );
        const statusMsg = screen.getByText('Reachable (42ms)');
        expect(statusMsg).toBeDefined();
        const input = screen.getByLabelText('Horizon URL');
        expect(input.getAttribute('aria-describedby')).toContain('horizon-url-status');
    });

    it('renders ok state with reachable status without response time', () => {
        const result: ConnectivityCheckResult = {
            reachable: true,
            endpoint: 'https://horizon-testnet.stellar.org',
        };
        render(
            <HorizonUrlInput
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
            endpoint: 'https://horizon-testnet.stellar.org',
            error: 'Connection timed out after 5000ms',
        };
        render(
            <HorizonUrlInput
                {...defaultProps}
                connectivityStatus="error"
                connectivityResult={result}
            />,
        );
        const statusMsg = screen.getByText('Connection timed out after 5000ms');
        expect(statusMsg).toBeDefined();
        const input = screen.getByLabelText('Horizon URL');
        expect(input.getAttribute('aria-describedby')).toContain('horizon-url-status');
    });

    it('renders error state with fallback error message when result error is absent', () => {
        render(
            <HorizonUrlInput
                {...defaultProps}
                connectivityStatus="error"
                connectivityResult={null}
            />,
        );
        expect(screen.getByText('Endpoint unreachable')).toBeDefined();
    });

    it('renders validation error message and associates alert role and aria-describedby', () => {
        render(
            <HorizonUrlInput
                {...defaultProps}
                error="Invalid Horizon URL"
            />,
        );
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toBe('Invalid Horizon URL');
        const input = screen.getByLabelText('Horizon URL');
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.getAttribute('aria-describedby')).toContain('horizon-url-error');
    });

    it('does not render error paragraph when error is absent', () => {
        render(<HorizonUrlInput {...defaultProps} error={undefined} />);
        expect(screen.queryByRole('alert')).toBeNull();
        const input = screen.getByLabelText('Horizon URL');
        expect(input.getAttribute('aria-invalid')).toBe('false');
    });

    it('fires onCheckConnectivity on button click', () => {
        const onCheck = vi.fn();
        render(<HorizonUrlInput {...defaultProps} onCheckConnectivity={onCheck} />);
        const button = screen.getByRole('button', { name: 'Check connectivity' });
        fireEvent.click(button);
        expect(onCheck).toHaveBeenCalledOnce();
    });

    it('disables Check button when value is empty', () => {
        render(<HorizonUrlInput {...defaultProps} value="" />);
        const button = screen.getByRole('button', { name: 'Check connectivity' });
        expect((button as HTMLButtonElement).disabled).toBe(true);
    });
});
