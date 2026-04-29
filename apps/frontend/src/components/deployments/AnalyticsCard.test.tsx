import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnalyticsCard } from './AnalyticsCard';

const icon = <svg aria-hidden="true" />;

describe('AnalyticsCard', () => {
    it('renders label and value', () => {
        render(<AnalyticsCard id="c1" label="Total Deployments" value="248" icon={icon} />);
        expect(screen.getByText('Total Deployments')).toBeDefined();
        expect(screen.getByText('248')).toBeDefined();
    });

    it('renders subValue when provided', () => {
        render(<AnalyticsCard id="c1" label="Total" value="10" subValue="5 today" icon={icon} />);
        expect(screen.getByText('5 today')).toBeDefined();
    });

    it('does not render subValue when omitted', () => {
        render(<AnalyticsCard id="c1" label="Total" value="10" icon={icon} />);
        expect(screen.queryByText('5 today')).toBeNull();
    });

    it('renders positive trend with + sign', () => {
        render(<AnalyticsCard id="c1" label="Rate" value="94%" trend={2.1} trendLabel="pp" icon={icon} />);
        expect(screen.getByText(/\+2\.1/)).toBeDefined();
    });

    it('renders negative trend without + sign', () => {
        render(<AnalyticsCard id="c1" label="Duration" value="2m" trend={-8} trendLabel="s" icon={icon} />);
        expect(screen.getByText(/-8/)).toBeDefined();
        expect(screen.queryByText(/\+/)).toBeNull();
    });

    it('does not render trend badge when trend is undefined', () => {
        const { container } = render(<AnalyticsCard id="c1" label="Total" value="10" icon={icon} />);
        expect(container.querySelector('.bg-green-50')).toBeNull();
        expect(container.querySelector('.bg-red-50')).toBeNull();
    });

    it('has accessible article with aria-label', () => {
        render(<AnalyticsCard id="c1" label="Success Rate" value="94%" icon={icon} />);
        expect(screen.getByRole('article', { name: 'Success Rate' })).toBeDefined();
    });

    it('sets the id attribute', () => {
        const { container } = render(<AnalyticsCard id="analytics-total" label="Total" value="10" icon={icon} />);
        expect(container.querySelector('#analytics-total')).not.toBeNull();
    });
});
