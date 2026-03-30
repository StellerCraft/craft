import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HealthSummaryBar } from './HealthSummaryBar';
import type { DeploymentAnalytics } from '@/types/deployment';

const baseAnalytics: DeploymentAnalytics = {
  totalDeployments: 100,
  successRate: 96,
  avgDurationSeconds: 120,
  activeDeployments: 2,
  failedLast24h: 0,
  deploymentsToday: 5,
  successRateTrend: 1,
  avgDurationTrend: -5,
};

describe('HealthSummaryBar', () => {
  it('shows "All systems healthy" when success rate >= 95 and no failures', () => {
    render(<HealthSummaryBar analytics={baseAnalytics} />);
    expect(screen.getByText('All systems healthy')).toBeDefined();
  });

  it('shows "Degraded performance" when success rate is 80–94', () => {
    render(
      <HealthSummaryBar analytics={{ ...baseAnalytics, successRate: 85, failedLast24h: 1 }} />,
    );
    expect(screen.getByText('Degraded performance')).toBeDefined();
  });

  it('shows "Critical failures detected" when success rate < 80', () => {
    render(
      <HealthSummaryBar analytics={{ ...baseAnalytics, successRate: 70, failedLast24h: 5 }} />,
    );
    expect(screen.getByText('Critical failures detected')).toBeDefined();
  });

  it('renders success rate as text', () => {
    render(<HealthSummaryBar analytics={baseAnalytics} />);
    expect(screen.getByText('96.0%')).toBeDefined();
  });

  it('shows active deployments count', () => {
    render(<HealthSummaryBar analytics={baseAnalytics} />);
    expect(screen.getByText('2')).toBeDefined();
  });

  it('has accessible region label', () => {
    render(<HealthSummaryBar analytics={baseAnalytics} />);
    expect(
      screen.getByRole('region', { name: 'Deployment health summary' }),
    ).toBeDefined();
  });

  it('has progress bar with correct aria-valuenow', () => {
    render(<HealthSummaryBar analytics={baseAnalytics} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('96');
  });
});
