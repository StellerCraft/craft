import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsGrid } from './AnalyticsGrid';
import type { DeploymentAnalytics } from '@/types/deployment';

const analytics: DeploymentAnalytics = {
    totalDeployments: 248,
    successRate: 94.2,
    avgDurationSeconds: 118,
    activeDeployments: 2,
    failedLast24h: 1,
    deploymentsToday: 8,
    successRateTrend: 2.1,
    avgDurationTrend: -8,
};

describe('AnalyticsGrid', () => {
    it('renders all six analytics cards', () => {
        render(<AnalyticsGrid analytics={analytics} />);
        expect(screen.getByText('Total Deployments')).toBeDefined();
        expect(screen.getByText('Success Rate')).toBeDefined();
        expect(screen.getByText('Avg Build Time')).toBeDefined();
        expect(screen.getByText('Active Deployments')).toBeDefined();
        expect(screen.getByText('Failed (24 h)')).toBeDefined();
        expect(screen.getByText('Deployments Today')).toBeDefined();
    });

    it('displays total deployments value', () => {
        render(<AnalyticsGrid analytics={analytics} />);
        expect(screen.getByText('248')).toBeDefined();
    });

    it('displays success rate formatted to 1 decimal', () => {
        render(<AnalyticsGrid analytics={analytics} />);
        expect(screen.getByText('94.2%')).toBeDefined();
    });

    it('displays avg duration in minutes and seconds', () => {
        render(<AnalyticsGrid analytics={analytics} />);
        expect(screen.getByText('1m 58s')).toBeDefined();
    });

    it('displays avg duration in seconds only when < 60s', () => {
        render(<AnalyticsGrid analytics={{ ...analytics, avgDurationSeconds: 45 }} />);
        expect(screen.getByText('45s')).toBeDefined();
    });

    it('has accessible section label', () => {
        render(<AnalyticsGrid analytics={analytics} />);
        expect(screen.getByRole('region', { name: 'Deployment analytics' })).toBeDefined();
    });

    it('shows "No failures" sub-value when failedLast24h is 0', () => {
        render(<AnalyticsGrid analytics={{ ...analytics, failedLast24h: 0 }} />);
        expect(screen.getByText('No failures — great!')).toBeDefined();
    });

    it('shows "Needs attention" sub-value when failedLast24h > 0', () => {
        render(<AnalyticsGrid analytics={analytics} />);
        expect(screen.getByText('Needs attention')).toBeDefined();
    });
});
