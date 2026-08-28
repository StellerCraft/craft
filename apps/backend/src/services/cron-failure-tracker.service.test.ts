/**
 * Unit tests for CronFailureTrackerService — Issue #1046
 *
 * Regression coverage for the full escalation sequence (3 → 6 failures):
 *   - Slack alert fires exactly once at the Slack threshold (count >= 3)
 *   - Email alert fires exactly once at the email threshold (count >= 6)
 *   - Crossing the email threshold does NOT fire a second Slack alert
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronFailureTrackerService } from './cron-failure-tracker.service';

// ── Supabase mock ─────────────────────────────────────────────────────────────

let currentCount = 0;
const alertState = { slack_alert_sent: false, email_alert_sent: false };

const mockRpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === 'increment_cron_failure') {
        return { data: currentCount, error: null };
    }
    if (name === 'mark_cron_alert_sent') {
        if (params.p_alert_type === 'slack') alertState.slack_alert_sent = true;
        if (params.p_alert_type === 'email') alertState.email_alert_sent = true;
        return { data: null, error: null };
    }
    return { data: null, error: null };
});

const mockSingle = vi.fn(() => ({ data: { ...alertState }, error: null }));
const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({
    upsert: vi.fn().mockResolvedValue({ error: null }),
    select: mockSelect,
}));

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeService() {
    const service = new CronFailureTrackerService();
    const slackSpy = vi
        .spyOn(service as unknown as { _sendSlackAlert: (...a: unknown[]) => Promise<void> }, '_sendSlackAlert')
        .mockResolvedValue(undefined);
    const emailSpy = vi
        .spyOn(service as unknown as { _sendEmailAlert: (...a: unknown[]) => void }, '_sendEmailAlert')
        .mockImplementation(() => undefined);
    return { service, slackSpy, emailSpy };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CronFailureTrackerService — escalation (#1046)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        currentCount = 0;
        alertState.slack_alert_sent = false;
        alertState.email_alert_sent = false;
    });

    it('fires the Slack alert once when reaching the Slack threshold', async () => {
        const { service, slackSpy, emailSpy } = makeService();
        currentCount = 3;

        await service.recordFailure('job-a', 'boom');

        expect(slackSpy).toHaveBeenCalledTimes(1);
        expect(emailSpy).not.toHaveBeenCalled();
    });

    it('does NOT double-fire the Slack alert when crossing the email threshold', async () => {
        const { service, slackSpy, emailSpy } = makeService();
        currentCount = 6;

        await service.recordFailure('job-b', 'boom');

        expect(slackSpy).toHaveBeenCalledTimes(1);
        expect(emailSpy).toHaveBeenCalledTimes(1);
    });

    it('fires Slack once and Email once across the full 3→6 escalation sequence', async () => {
        const { service, slackSpy, emailSpy } = makeService();

        currentCount = 3;
        await service.recordFailure('job-c', 'boom');
        expect(slackSpy).toHaveBeenCalledTimes(1);
        expect(emailSpy).not.toHaveBeenCalled();

        currentCount = 6;
        await service.recordFailure('job-c', 'boom');

        // Slack only ever fired once (at the Slack threshold), not a second
        // time at the email threshold.
        expect(slackSpy).toHaveBeenCalledTimes(1);
        expect(emailSpy).toHaveBeenCalledTimes(1);
    });

    it('fires mark_cron_alert_sent for email exactly once at the email threshold', async () => {
        const { service } = makeService();
        currentCount = 6;

        await service.recordFailure('job-d', 'boom');

        const emailMarks = mockRpc.mock.calls.filter(
            (c) => c[0] === 'mark_cron_alert_sent' && (c[1] as Record<string, unknown>).p_alert_type === 'email',
        );
        expect(emailMarks).toHaveLength(1);
    });
});
