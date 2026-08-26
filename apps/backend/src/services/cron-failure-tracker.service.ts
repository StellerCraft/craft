/**
 * Cron Job Failure Tracker Service
 *
 * Persists per-job failure state in Supabase so the escalation chain
 * survives server restarts.
 *
 * Escalation:
 *   - 3 consecutive failures → Slack webhook alert (SLACK_WEBHOOK_URL)
 *   - 6 consecutive failures → email alert (console.error [EMAIL_ALERT])
 *   - Successful run        → resets consecutive_failures to 0
 *
 * Issue: #759
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const SLACK_ALERT_THRESHOLD = 3;
const EMAIL_ALERT_THRESHOLD = 6;

export class CronFailureTrackerService {
    /**
     * Record a successful cron run — clears the consecutive failure count
     * and resets alert tracking.
     */
    async recordSuccess(jobName: string): Promise<void> {
        const supabase = createClient();

        // Reset alert flags and zero the counter
        await supabase.from('cron_job_failures').upsert(
            {
                job_name: jobName,
                consecutive_failures: 0,
                slack_alert_sent: false,
                email_alert_sent: false,
                last_success_at: new Date().toISOString(),
                last_error: null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'job_name' }
        );
    }

    /**
     * Record a failed cron run with atomic counter increment, then trigger
     * escalation alerts. Uses Postgres RPC for atomicity to prevent lost
     * increments under concurrent calls.
     */
    async recordFailure(jobName: string, error: string): Promise<void> {
        const supabase = createClient();

        // Atomically increment the consecutive failure count via RPC
        const { data: count, error: rpcError } = await supabase.rpc(
            'increment_cron_failure',
            { p_job_name: jobName, p_error: error },
        );

        if (rpcError) {
            console.error('[cron-failure-tracker] RPC call failed, falling back to upsert', rpcError);
            // Fallback: read-then-upsert (not atomic, but better than failing)
            const { data: existing } = await supabase
                .from('cron_job_failures')
                .select('consecutive_failures')
                .eq('job_name', jobName)
                .single();

            const newCount = (existing?.consecutive_failures ?? 0) + 1;

            await supabase.from('cron_job_failures').upsert(
                {
                    job_name: jobName,
                    consecutive_failures: newCount,
                    last_failure_at: new Date().toISOString(),
                    last_error: error,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'job_name' }
            );

            await this._escalate(jobName, newCount, error);
            return;
        }

        const newCount = count as number;
        await this._escalate(jobName, newCount, error);
    }

    /**
     * Wraps a cron route handler.
     * Calls recordFailure on thrown exceptions or non-2xx responses,
     * recordSuccess on 2xx responses.
     */
    wrapCronHandler(
        jobName: string,
        handler: (req: NextRequest) => Promise<NextResponse>
    ): (req: NextRequest) => Promise<NextResponse> {
        return async (req: NextRequest): Promise<NextResponse> => {
            try {
                const response = await handler(req);
                if (response.status >= 400) {
                    await this.recordFailure(jobName, `HTTP ${response.status}`);
                } else {
                    await this.recordSuccess(jobName);
                }
                return response;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                await this.recordFailure(jobName, msg);
                return NextResponse.json({ error: msg }, { status: 500 });
            }
        };
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private async _escalate(jobName: string, count: number, error: string): Promise<void> {
        const supabase = createClient();

        // Fetch current alert state
        const { data: row } = await supabase
            .from('cron_job_failures')
            .select('slack_alert_sent, email_alert_sent')
            .eq('job_name', jobName)
            .single();

        // Slack alert at threshold 3 or above (if not already sent)
        if (count >= SLACK_ALERT_THRESHOLD && !row?.slack_alert_sent) {
            await this._sendSlackAlert(jobName, count, error);
            await supabase.rpc('mark_cron_alert_sent', {
                p_job_name: jobName,
                p_alert_type: 'slack',
            });
        }

        // Email alert at threshold 6 or above (if not already sent)
        if (count >= EMAIL_ALERT_THRESHOLD && !row?.email_alert_sent) {
            this._sendEmailAlert(jobName, count, error);
            await supabase.rpc('mark_cron_alert_sent', {
                p_job_name: jobName,
                p_alert_type: 'email',
            });
        }
    }

    private async _sendSlackAlert(
        jobName: string,
        count: number,
        error: string
    ): Promise<void> {
        const url = process.env.SLACK_WEBHOOK_URL;
        if (!url) return;

        try {
            await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `🚨 Cron job *${jobName}* has failed *${count}* consecutive times.\nError: ${error}`,
                }),
            });
        } catch (err) {
            console.error('[cron-failure-tracker] Failed to send Slack alert', err);
        }
    }

    private _sendEmailAlert(jobName: string, count: number, error: string): void {
        console.error('[CRON_EMAIL_ALERT]', {
            jobName,
            consecutiveFailures: count,
            error,
            timestamp: new Date().toISOString(),
        });
    }
}

export const cronFailureTrackerService = new CronFailureTrackerService();
