import { NextRequest, NextResponse } from 'next/server';
import { webhookDeliveryService } from '@/services/webhook-delivery.service';
import { cronFailureTrackerService } from '@/services/cron-failure-tracker.service';

/**
 * Cron: prune successfully-processed GitHub webhook deliveries past the
 * retention window (WEBHOOK_DELIVERY_RETENTION_DAYS, default: 90 days).
 *
 * Only 'processed' deliveries are eligible; 'failed' and 'received' rows are
 * left untouched since they remain eligible for replay. See
 * WebhookDeliveryService.pruneOldDeliveries.
 *
 * Protected by CRON_SECRET. Failures/successes are tracked via
 * CronFailureTrackerService for alerting.
 */
async function handler(req: NextRequest): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await webhookDeliveryService.pruneOldDeliveries();

    if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ pruned: result.pruned });
}

export const GET = cronFailureTrackerService.wrapCronHandler('prune-webhook-deliveries', handler);
