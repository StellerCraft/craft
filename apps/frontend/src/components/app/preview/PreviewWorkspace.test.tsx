import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PreviewWorkspace } from './PreviewWorkspace';
import type { CustomizationConfig, ViewportClass } from '@craft/types';

vi.mock('@/hooks/usePreviewService', () => ({
  usePreviewService: () => ({
    generatePreview: vi.fn().mockResolvedValue({
      branding: { primaryColor: '#6366f1', secondaryColor: '#a5b4fc', fontFamily: 'Inter' },
      features: { enableCharts: true, enableTransactionHistory: true },
      mockData: { accountBalance: '10000', recentTransactions: [] },
      css: 'body { background: #6366f1; }',
      viewport: { width: 1440, height: 900, class: 'desktop' as ViewportClass },
    }),
    refreshPreview: vi.fn().mockResolvedValue({
      branding: { primaryColor: '#6366f1', secondaryColor: '#a5b4fc', fontFamily: 'Inter' },
      features: { enableCharts: true, enableTransactionHistory: true },
      mockData: { accountBalance: '10000', recentTransactions: [] },
      css: 'body { background: #6366f1; }',
      viewport: { width: 1440, height: 900, class: 'desktop' as ViewportClass },
    }),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('../LoadingSkeleton', () => ({
  LoadingSkeleton: () => <div data-testid="loading-skeleton">Loading...</div>,
}));

vi.mock('../ErrorState', () => ({
  ErrorState: ({ title, description, onRetry }: any) => (
    <div data-testid="error-state">
      <h1>{title}</h1>
      <p>{description}</p>
      <button onClick={onRetry}>Retry</button>
    </div>
  ),
}));

const mockCustomization: CustomizationConfig = {
  branding: {
    appName: 'Test App',
    primaryColor: '#6366f1',
    secondaryColor: '#a5b4fc',
    fontFamily: 'Inter',
  },
  features: {
    enableCharts: true,
    enableTransactionHistory: true,
    enableAnalytics: false,
    enableNotifications: false,
  },
  stellar: {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
};

describe('PreviewWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders preview controls and iframe area', () => {
    render(<PreviewWorkspace templateId="test-template" customization={mockCustomization} />);

    expect(screen.getByText('Desktop')).toBeInTheDocument();
    expect(screen.getByText('Tablet')).toBeInTheDocument();
    expect(screen.getByText('Mobile')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('switches viewports correctly', async () => {
    render(<PreviewWorkspace templateId="test-template" customization={mockCustomization} />);

    const tabletButton = screen.getByText('Tablet');
    fireEvent.click(tabletButton);

    await waitFor(() => {
      expect(tabletButton.closest('button')).toHaveClass('bg-white');
    });
  });

  it('shows loading state initially', () => {
    render(<PreviewWorkspace templateId="test-template" customization={mockCustomization} />);

    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  it('handles refresh action', async () => {
    render(<PreviewWorkspace templateId="test-template" customization={mockCustomization} />);

    const refreshButton = screen.getByText('Refresh');
    fireEvent.click(refreshButton);

    await waitFor(() => {
      expect(refreshButton.closest('button')).toBeDisabled();
    });
  });

  it('displays viewport dimensions', () => {
    render(<PreviewWorkspace templateId="test-template" customization={mockCustomization} />);

    expect(screen.getByText('1440×900')).toBeInTheDocument();
  });

  it('handles missing customization gracefully', () => {
    render(<PreviewWorkspace templateId="test-template" />);

    expect(screen.getByText('Desktop')).toBeInTheDocument();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });
});
