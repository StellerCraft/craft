import { NextRequest, NextResponse } from 'next/server';
import { createLogger, resolveCorrelationId, CORRELATION_ID_HEADER } from '@/lib/api/logger';
import { webhookDeliveryService } from '@/services/webhook-delivery.service';
import { githubDeliveryFetcherService } from '@/services/github-delivery-fetcher.service';
import { withGitHubWebhookAuth } from '@/lib/github/github-webhook';

/**
 * GET /api/admin/webhooks/replay
 *
 * Lists webhook deliveries available for replay (failed or missed).
 *
 * Query parameters:
 *   - type: 'failed' | 'missed' | 'all' (default: 'all')
 *
 * Returns:
 *   - deliveries: Array of deliveries that can be replayed
 *   - count: Total number of deliveries available for replay
 */
export const GET = withGitHubWebhookAuth(async (req: NextRequest) => {
    const correlationId = resolveCorrelationId(req);
    const log = createLogger({ correlationId, service: 'webhook-replay-admin' });

    log.info('Fetching deliveries for replay');

    try {
        const result = await webhookDeliveryService.getDeliveriesForReplay();

        if (!result.success) {
            log.error('Failed to fetch deliveries for replay', undefined, {
                error: result.error,
            });
            return NextResponse.json(
                { error: result.error || 'Failed to fetch deliveries' },
                { status: 500 }
            );
        }

        const deliveries = result.deliveries || [];

        // Filter by type if specified
        const searchParams = req.nextUrl.searchParams;
        const typeFilter = searchParams.get('type') || 'all';

        const filteredDeliveries =
            typeFilter === 'all'
                ? deliveries
                : deliveries.filter((d) => d.source === typeFilter);

        log.info('Deliveries for replay fetched', {
            total: deliveries.length,
            filtered: filteredDeliveries.length,
            typeFilter,
        });

        const res = NextResponse.json({
            deliveries: filteredDeliveries,
            count: filteredDeliveries.length,
        });
        res.headers.set(CORRELATION_ID_HEADER, correlationId);
        return res;
    } catch (error: any) {
        log.error('Unexpected error fetching deliveries for replay', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
});

/**
 * Replays a single webhook delivery and logs the outcome.
 * Returns { success: true, newDeliveryId } or { success: false, error }.
 */
async function replayOne(
    deliveryId: string,
    log: ReturnType<typeof createLogger>,
): Promise<{ success: boolean; newDeliveryId?: string; error?: string }> {
    const result = await webhookDeliveryService.replayDelivery(deliveryId);

    if (!result.success) {
        log.error('Failed to replay delivery', undefined, {
            deliveryId,
            error: result.error,
        });
        return {
            success: false,
            error: result.error || 'Unknown error',
        };
    }

    log.info('Delivery replayed', {
        originalDeliveryId: deliveryId,
        newDeliveryId: result.newDeliveryId,
    });

    return {
        success: true,
        newDeliveryId: result.newDeliveryId,
    };
}

/**
 * POST /api/admin/webhooks/replay
 *
 * Triggers replay of webhook deliveries.
 *
 * Request body:
 *   - deliveryId: string (optional) - Specific delivery ID to replay
 *   - replayAll: boolean (optional) - Replay all failed/missed deliveries
 *   - hookId: number (required for missed deliveries) - GitHub webhook ID
 *
 * Returns:
 *   - success: boolean
 *   - replayed: number - Count of deliveries replayed
 *   - errors: Array of errors encountered during replay
 */
export const POST = withGitHubWebhookAuth(async (req: NextRequest) => {
    const correlationId = resolveCorrelationId(req);
    const log = createLogger({ correlationId, service: 'webhook-replay-admin' });

    try {
        const body = await req.json();
        const { deliveryId, replayAll, hookId } = body;

        log.info('Webhook replay requested', { deliveryId, replayAll, hookId });

        // Validate request
        if (!deliveryId && !replayAll) {
            return NextResponse.json(
                { error: 'Either deliveryId or replayAll must be specified' },
                { status: 400 }
            );
        }

        if (deliveryId && replayAll) {
            return NextResponse.json(
                { error: 'Cannot specify both deliveryId and replayAll' },
                { status: 400 }
            );
        }

        // Replay a specific delivery
        if (deliveryId) {
            const result = await replayOne(deliveryId, log);

            if (!result.success) {
                return NextResponse.json(
                    { error: result.error || 'Failed to replay delivery' },
                    { status: 500 }
                );
            }

            const res = NextResponse.json({
                success: true,
                replayed: 1,
                newDeliveryId: result.newDeliveryId,
            });
            res.headers.set(CORRELATION_ID_HEADER, correlationId);
            return res;
        }

        // Replay all failed/missed deliveries
        if (replayAll) {
            const deliveriesResult = await webhookDeliveryService.getDeliveriesForReplay();

            if (!deliveriesResult.success) {
                log.error('Failed to fetch deliveries for replay', undefined, {
                    error: deliveriesResult.error,
                });
                return NextResponse.json(
                    { error: deliveriesResult.error || 'Failed to fetch deliveries' },
                    { status: 500 }
                );
            }

            const deliveries = deliveriesResult.deliveries || [];
            const errors: Array<{ deliveryId: string; error: string }> = [];
            let replayedCount = 0;

            for (const delivery of deliveries) {
                if (delivery.source === 'missed') {
                    if (!hookId) {
                        errors.push({
                            deliveryId: delivery.deliveryId,
                            error: 'hookId required for missed deliveries',
                        });
                        continue;
                    }

                    log.warn('Missed delivery replay not fully implemented', {
                        deliveryId: delivery.deliveryId,
                        reason: 'Need numeric delivery ID for GitHub API',
                    });
                    errors.push({
                        deliveryId: delivery.deliveryId,
                        error: 'Missed delivery replay requires numeric delivery ID',
                    });
                    continue;
                }

                const result = await replayOne(delivery.deliveryId, log);
                if (result.success) {
                    replayedCount++;
                } else {
                    errors.push({
                        deliveryId: delivery.deliveryId,
                        error: result.error || 'Unknown error',
                    });
                }
            }

            log.info('Bulk replay completed', {
                total: deliveries.length,
                replayed: replayedCount,
                errors: errors.length,
            });

            const res = NextResponse.json({
                success: true,
                replayed: replayedCount,
                total: deliveries.length,
                errors: errors.length > 0 ? errors : undefined,
            });
            res.headers.set(CORRELATION_ID_HEADER, correlationId);
            return res;
        }

        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    } catch (error: any) {
        log.error('Unexpected error during webhook replay', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
});

/**
 * PUT /api/admin/webhooks/detect-missed
 *
 * Detects missed webhook deliveries by comparing GitHub's delivery log
 * against our database records.
 *
 * Request body:
 *   - hookId: number (required) - GitHub webhook ID
 *   - lookbackHours: number (optional) - How many hours back to check (default: 24)
 *
 * Returns:
 *   - success: boolean
 *   - missedCount: number - Count of missed deliveries detected
 */
export const PUT = withGitHubWebhookAuth(async (req: NextRequest) => {
    const correlationId = resolveCorrelationId(req);
    const log = createLogger({ correlationId, service: 'webhook-missed-detection' });

    try {
        const body = await req.json();
        const { hookId, lookbackHours = 24 } = body;

        if (!hookId) {
            return NextResponse.json({ error: 'hookId is required' }, { status: 400 });
        }

        log.info('Detecting missed deliveries', { hookId, lookbackHours });

        const result = await githubDeliveryFetcherService.detectMissedDeliveries(
            hookId,
            lookbackHours
        );

        if (!result.success) {
            log.error('Failed to detect missed deliveries', undefined, {
                error: result.error,
            });
            return NextResponse.json(
                { error: result.error || 'Failed to detect missed deliveries' },
                { status: 500 }
            );
        }

        log.info('Missed deliveries detected', { missedCount: result.missedCount });

        const res = NextResponse.json({
            success: true,
            missedCount: result.missedCount || 0,
        });
        res.headers.set(CORRELATION_ID_HEADER, correlationId);
        return res;
    } catch (error: any) {
        log.error('Unexpected error detecting missed deliveries', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
});
