import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeploymentRow } from './DeploymentRow';
import type { Deployment } from '@/types/deployment';

const base: Deployment = {
    id: 'dep-001',
    name: 'stellar-dex',
    status: 'success',
    environment: 'production',
    trigger: 'push',
    commit: {
        sha: 'a3f9c12',
        message: 'feat: add liquidity pool',
        author: 'jana.m',
        branch: 'main',
    },
    region: { id: 'us-east-1', label: 'US East', flag: '🇺🇸' },
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    durationSeconds: 127,
    url: 'https://stellar-dex.craft.app',
    logsUrl: '#',
};

describe('DeploymentRow', () => {
    it('renders deployment name', () => {
        render(<ul><DeploymentRow deployment={base} /></ul>);
        expect(screen.getByText('stellar-dex')).toBeDefined();
    });

    it('renders commit sha and message', () => {
        render(<ul><DeploymentRow deployment={base} /></ul>);
        expect(screen.getByText('a3f9c12')).toBeDefined();
        expect(screen.getByText('feat: add liquidity pool')).toBeDefined();
    });

    it('renders environment badge', () => {
        render(<ul><DeploymentRow deployment={base} /></ul>);
        expect(screen.getByText('Production')).toBeDefined();
    });

    it('renders status badge', () => {
        render(<ul><DeploymentRow deployment={base} /></ul>);
        expect(screen.getByText('Success')).toBeDefined();
    });

    it('renders duration when provided', () => {
        render(<ul><DeploymentRow deployment={base} /></ul>);
        expect(screen.getByText('2m 7s')).toBeDefined();
    });

    it('does not render duration when omitted', () => {
        const { queryByText } = render(<ul><DeploymentRow deployment={{ ...base, durationSeconds: undefined }} /></ul>);
        expect(queryByText(/\dm/)).toBeNull();
    });

    it('renders visit link when url is present', () => {
        render(<ul><DeploymentRow deployment={base} /></ul>);
        const link = screen.getByRole('link', { name: /Visit stellar-dex/i });
        expect(link.getAttribute('href')).toBe('https://stellar-dex.craft.app');
    });

    it('does not render visit link when url is absent', () => {
        render(<ul><DeploymentRow deployment={{ ...base, url: undefined }} /></ul>);
        expect(screen.queryByRole('link', { name: /Visit/i })).toBeNull();
    });

    it('calls onViewLogs when logs button clicked', () => {
        const onViewLogs = vi.fn();
        render(<ul><DeploymentRow deployment={base} onViewLogs={onViewLogs} /></ul>);
        fireEvent.click(screen.getByRole('button', { name: /View logs for stellar-dex/i }));
        expect(onViewLogs).toHaveBeenCalledWith('dep-001');
    });

    it('does not render logs button when logsUrl is absent', () => {
        render(<ul><DeploymentRow deployment={{ ...base, logsUrl: undefined }} onViewLogs={vi.fn()} /></ul>);
        expect(screen.queryByRole('button', { name: /View logs/i })).toBeNull();
    });

    it('calls onRedeploy when redeploy button clicked for success status', () => {
        const onRedeploy = vi.fn();
        render(<ul><DeploymentRow deployment={base} onRedeploy={onRedeploy} /></ul>);
        fireEvent.click(screen.getByRole('button', { name: /Redeploy stellar-dex/i }));
        expect(onRedeploy).toHaveBeenCalledWith('dep-001');
    });

    it('renders redeploy button for failed status', () => {
        render(<ul><DeploymentRow deployment={{ ...base, status: 'failed' }} onRedeploy={vi.fn()} /></ul>);
        expect(screen.getByRole('button', { name: /Redeploy/i })).toBeDefined();
    });

    it('does not render redeploy button for running status', () => {
        render(<ul><DeploymentRow deployment={{ ...base, status: 'running' }} onRedeploy={vi.fn()} /></ul>);
        expect(screen.queryByRole('button', { name: /Redeploy/i })).toBeNull();
    });

    it('sets the row id attribute', () => {
        const { container } = render(<ul><DeploymentRow deployment={base} /></ul>);
        expect(container.querySelector('#deployment-row-dep-001')).not.toBeNull();
    });

    it('renders region flag', () => {
        render(<ul><DeploymentRow deployment={base} /></ul>);
        expect(screen.getByText('🇺🇸')).toBeDefined();
    });
});
