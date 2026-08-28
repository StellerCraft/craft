/**
 * POST /api/webhooks/email
 *
 * Receives delivery-status events from the transactional email provider and
 * advances the matching email_deliveries row (sent → delivered / bounced /
 * opened). Provider events are normalised to {@link DeliveryWebhookEvent}.
 *
 * Authentication: optional shared secret via the EMAIL_WEBHOOK_SECRET env var,
 * checked against the `authorization: Bearer <secret>` header when configured.
 *
 * Supported provider event names are mapped to internal statuses:
 *   delivered            → delivered
 *   bounced / bounce / complained → bounced
 *   opened / open        → opened
 *   sent / delivery_sent → sent
 *
 * Always returns 200 for recognised-but-unmapped events so the provider does
 * not retry unnecessarily.
 *
 * Issue: #769 — Email Notification Delivery Service with Template Rendering
 *               and Delivery Tracking
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    emailDeliveryService,
    type DeliveryStatus,
    type DeliveryWebhookEvent,
} from '@/services/email-delivery.service';

const STATUS_MAP: Record<string, DeliveryStatus> = {
    sent: 'sent',
    delivery_sent: 'sent',
    delivered: 'delivered',
    delivery: 'delivered',
    bounced: 'bounced',
    bounce: 'bounced',
    complained: 'bounced',
    complaint: 'bounced',
    opened: 'opened',
    open: 'opened',
};

/** Pull the provider message id from the common field names across providers. */
function extractMessageId(payload: Record<string, any>): string | null {
    return (
        payload.message_id ??
        payload.messageId ??
        payload.id ??
        payload.data?.message_id ??
        payload.data?.id ??
        null
    );
}

/** Pull the event/type name from the common field names across providers. */
function extractEventName(payload: Record<string, any>): string | null {
    const raw = payload.type ?? payload.event ?? payload.record_type ?? payload.RecordType;
    return typeof raw === 'string' ? raw.toLowerCase() : null;
}

function normalise(payload: Record<string, any>): DeliveryWebhookEvent | null {
    const messageId = extractMessageId(payload);
    const eventName = extractEventName(payload);
    if (!messageId || !eventName) return null;

    const status = STATUS_MAP[eventName];
    if (!status) return null;

    const error =
        payload.error ??
        payload.reason ??
        payload.data?.reason ??
        (status === 'bounced' ? 'bounced' : undefined);

    return { providerMessageId: messageId, status, error };
}

export async function POST(req: NextRequest) {
    const secret = process.env.EMAIL_WEBHOOK_SECRET;
    if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let payload: Record<string, any>;
    try {
        payload = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Providers may batch events into an array or send a single object.
    const events = Array.isArray(payload) ? payload : [payload];

    let updated = 0;
    let ignored = 0;
    for (const raw of events) {
        const event = normalise(raw);
        if (!event) {
            ignored++;
            continue;
        }
        const applied = await emailDeliveryService.handleWebhook(event);
        if (applied) updated++;
        else ignored++;
    }

    return NextResponse.json({ received: events.length, updated, ignored });
}
