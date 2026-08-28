/**
 * GET /api/deployments/[id]/logs/stream
 *
 * Server-Sent Events (SSE) endpoint for streaming deployment logs in real-time.
 * Returns a continuous stream of log entries and heartbeat events.
 *
 * Authentication: requires a valid Supabase session (401 if missing).
 * Ownership: the authenticated user must own the deployment.
 *            Non-owners and missing deployments both return 404.
 *
 * CORS: uses origin allow-list (see lib/api/cors.ts). Credentialed requests from
 *       disallowed origins receive no Access-Control-Allow-Origin header, causing
 *       the browser to block the response.
 *
 * Query parameters:
 *   since   ISO 8601       Start streaming logs created after this timestamp (optional)
 *   level   log level      Filter by log level (optional)
 *   stage   stage name     Filter by deployment stage (optional)
 *
 * Response format (text/event-stream):
 *   event: log
 *   data: {"id": "...", "deploymentId": "...", "timestamp": "...", "level": "...", "message": "..."}
 *
 *   event: heartbeat
 *   data: {"timestamp": "..."}
 *
 *   event: error
 *   data: {"error": "..."}
 *
 * Responses:
 *   200 — SSE stream established
 *   400 — Invalid query parameters
 *   401 — Not authenticated
 *   404 — Deployment not found (or not owned by caller)
 *   500 — Unexpected server error
 *
 * Issue: #605
 * Branch: feat/issue-069-deployment-log-sse-streaming
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { corsHeaders } from '@/lib/api/cors';
import {
    deploymentLogsService,
    type ExtendedLogsQueryParams,
} from '@/services/deployment-logs.service';
import { LogStreamBuffer } from '@/lib/sse/log-stream-buffer';

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_STREAM_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const BUFFER_CAPACITY = 100; // max pending log lines per client before backpressure drops

/**
 * Parse a Last-Event-ID value into a starting sequence number. Returns 0 (no
 * resume) for missing/invalid/negative values.
 */
export function parseLastEventId(raw: string | null | undefined): number {
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n >= 0 ? n : 0;
}

class SSEStreamManager {
    private encoder = new TextEncoder();
    private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    private lastLogId: string | null = null;
    private lastTimestamp: string | null = null;
    private pollTimeout: NodeJS.Timeout | null = null;
    private heartbeatTimeout: NodeJS.Timeout | null = null;
    private streamStartTime: number;
    private closed = false;
    private readonly buffer: LogStreamBuffer;

    constructor(startSeq = 0) {
        this.streamStartTime = Date.now();
        this.buffer = new LogStreamBuffer({ capacity: BUFFER_CAPACITY, startSeq });
    }

    async initialize(
        controller: ReadableStreamDefaultController<Uint8Array>,
        deploymentId: string,
        since: string | undefined,
        supabase: any,
        user: any,
    ): Promise<void> {
        this.controller = controller;
        this.lastTimestamp = since || new Date(Date.now() - 60000).toISOString(); // Default to last minute

        // Send initial connection event (resumes from the client's Last-Event-ID seq)
        this.sendControl('connected', {
            deploymentId,
            timestamp: new Date().toISOString(),
            lastEventId: this.buffer.lastSeq,
        });

        // Start polling for new logs
        this.startPolling(deploymentId, supabase);

        // Start heartbeat
        this.startHeartbeat();
    }

    private startPolling(deploymentId: string, supabase: any): void {
        const poll = async () => {
            if (this.closed) return;

            try {
                const params: ExtendedLogsQueryParams = {
                    page: 1,
                    limit: 100,
                    order: 'asc',
                    since: this.lastTimestamp,
                };

                const result = await deploymentLogsService.getLogs(
                    deploymentId,
                    params,
                    supabase,
                );

                // Enqueue any new logs into the backpressure buffer (assigns seq).
                for (const log of result.data) {
                    if (!this.lastLogId || log.id !== this.lastLogId) {
                        this.buffer.enqueue('log', log as Record<string, unknown>);
                        this.lastLogId = log.id;
                    }
                }

                // Flush whatever the client can currently accept.
                this.flush();

                // Update last timestamp to avoid re-fetching the same logs
                if (result.data.length > 0) {
                    const lastLog = result.data[result.data.length - 1];
                    this.lastTimestamp = lastLog.timestamp;
                }

                // Check if stream duration exceeded
                if (Date.now() - this.streamStartTime > MAX_STREAM_DURATION) {
                    this.sendControl('end', {
                        reason: 'Stream duration limit reached',
                        timestamp: new Date().toISOString(),
                    });
                    this.close();
                    return;
                }
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Polling failed';
                console.error('[sse-stream] polling error:', err);
                this.sendControl('error', { error: msg });
                // Don't close on error, continue polling
            }

            // Schedule next poll
            if (!this.closed) {
                this.pollTimeout = setTimeout(poll, POLL_INTERVAL);
            }
        };

        poll();
    }

    private startHeartbeat(): void {
        const heartbeat = () => {
            if (this.closed) return;

            // A heartbeat is also a chance to flush anything the client can now accept.
            this.flush();
            this.sendControl('heartbeat', {
                timestamp: new Date().toISOString(),
                pending: this.buffer.size,
            });

            if (!this.closed) {
                this.heartbeatTimeout = setTimeout(heartbeat, HEARTBEAT_INTERVAL);
            }
        };

        this.heartbeatTimeout = setTimeout(heartbeat, HEARTBEAT_INTERVAL);
    }

    /**
     * Flush pending log entries to the client, respecting backpressure. While
     * the controller reports it cannot accept more (desiredSize <= 0), entries
     * stay in the ring buffer and the oldest are dropped once it overflows.
     * After flushing, any overflow drops are surfaced as a buffer_overflow event.
     */
    private flush(): void {
        if (!this.controller || this.closed) return;

        // Slow consumer: leave entries buffered until it drains.
        const desired = this.controller.desiredSize;
        if (desired !== null && desired <= 0) return;

        const events = this.buffer.drain();
        for (const entry of events) {
            this.writeRaw(
                `id: ${entry.seq}\nevent: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`,
            );
        }

        const dropped = this.buffer.consumeDropped();
        if (dropped > 0) {
            this.sendControl('buffer_overflow', {
                dropped,
                totalDropped: this.buffer.totalDroppedCount,
                timestamp: new Date().toISOString(),
            });
        }
    }

    /** Send a control event (no sequence id, not subject to the ring buffer). */
    private sendControl(eventType: string, data: Record<string, unknown>): void {
        this.writeRaw(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    }

    private writeRaw(frame: string): void {
        if (!this.controller || this.closed) return;

        try {
            this.controller.enqueue(this.encoder.encode(frame));
        } catch (err: unknown) {
            console.error('[sse-stream] failed to send event:', err);
            this.close();
        }
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;

        if (this.pollTimeout) clearTimeout(this.pollTimeout);
        if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);

        try {
            this.controller?.close();
        } catch (err: unknown) {
            console.error('[sse-stream] error closing stream:', err);
        }
    }
}

export const GET = withAuth(async (req: NextRequest, { params, user, supabase }) => {
    const deploymentId = (params as { id: string }).id;

    // Ownership check
    const { data: deployment } = await supabase
        .from('deployments')
        .select('user_id')
        .eq('id', deploymentId)
        .single();

    if (!deployment || deployment.user_id !== user.id) {
        return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    // Validate query parameters
    const since = req.nextUrl.searchParams.get('since') ?? undefined;
    if (since) {
        const d = new Date(since);
        if (isNaN(d.getTime())) {
            return NextResponse.json(
                { error: 'Invalid since parameter' },
                { status: 400 },
            );
        }
    }

    // Resume support: a reconnecting client sends the last sequence it received
    // via the Last-Event-ID header (or a lastEventId query fallback). Event
    // numbering continues after it so the client can detect gaps.
    const startSeq = parseLastEventId(
        req.headers.get('last-event-id') ??
            req.nextUrl.searchParams.get('lastEventId'),
    );

    try {
        const manager = new SSEStreamManager(startSeq);

        // Stop producing immediately when the client disconnects.
        req.signal?.addEventListener('abort', () => manager.close());

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                manager.initialize(controller, deploymentId, since, supabase, user).catch(
                    (err: unknown) => {
                        console.error('[sse-stream] initialization error:', err);
                        controller.error(err);
                    },
                );
            },
            cancel() {
                manager.close();
            },
        });

        const origin = req.headers.get('origin');
        return new NextResponse(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                ...corsHeaders(origin),
            },
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to establish stream';
        console.error('[sse-stream] unexpected error:', err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
});
