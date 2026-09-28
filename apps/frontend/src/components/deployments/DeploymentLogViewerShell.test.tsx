import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeploymentLogViewerShell, formatLogTimestamp } from './DeploymentLogViewerShell';
import type { DeploymentLogEntry } from '@/types/deployment';

const TIMESTAMP = '2026-03-15T14:30:45.000Z';

const logs: DeploymentLogEntry[] = [
    {
        id: 'log-1',
        deploymentId: 'dep-1',
        timestamp: TIMESTAMP,
        level: 'info',
        message: 'Build started',
    },
];

/** Extracts the timeZoneName part Intl would render for the given options. */
function expectedZone(options: Intl.DateTimeFormatOptions = {}): string {
    return (
        new Intl.DateTimeFormat(undefined, { timeZoneName: 'short', ...options })
            .formatToParts(new Date(TIMESTAMP))
            .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
}

describe('formatLogTimestamp', () => {
    it('includes a timezone indicator for local time', () => {
        const zone = expectedZone();
        expect(zone).not.toBe('');
        expect(formatLogTimestamp(TIMESTAMP)).toContain(zone);
    });

    it('renders in UTC with a UTC indicator when requested', () => {
        const formatted = formatLogTimestamp(TIMESTAMP, 'utc');
        expect(formatted).toContain(expectedZone({ timeZone: 'UTC' }));
        expect(formatted).toMatch(/UTC|GMT/);
    });

    it('returns the raw value for an unparseable timestamp', () => {
        expect(formatLogTimestamp('not-a-date')).toBe('not-a-date');
    });
});

describe('DeploymentLogViewerShell timestamps', () => {
    it('renders each log timestamp with a timezone indicator, defaulting to local time', () => {
        render(<DeploymentLogViewerShell logs={logs} />);
        const time = screen.getByTestId('deployment-log-timestamp');
        expect(time.textContent).toContain(expectedZone());
        expect(time.getAttribute('dateTime')).toBe(TIMESTAMP);
        expect(screen.getByTestId('deployment-logs-tz-local').getAttribute('aria-pressed')).toBe('true');
    });

    it('switches rendered timestamps to UTC via the toggle', () => {
        render(<DeploymentLogViewerShell logs={logs} />);
        fireEvent.click(screen.getByTestId('deployment-logs-tz-utc'));

        expect(screen.getByTestId('deployment-logs-tz-utc').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('deployment-log-timestamp').textContent).toBe(
            formatLogTimestamp(TIMESTAMP, 'utc')
        );
    });
});
