/**
 * RealtimeStatusPoller
 *
 * Wraps Supabase Realtime channel subscriptions to deliver deployment status
 * updates to subscribers. This is the platform's "WebSocket" layer: Supabase
 * Realtime uses WebSocket transport under the hood, and this utility provides
 * the connection lifecycle, message ordering, reconnection with exponential
 * backoff, and authentication that the issue requires.
 *
 * Architecture note:
 *   There is no custom WebSocket server in this codebase. Real-time updates
 *   flow through Supabase Realtime channels (postgres_changes events).
 *   This class abstracts that into a testable interface.
 */

import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DeploymentStatusPayload = {
  deploymentId: string;
  status: string;
  sequenceNumber: number;
  timestamp: string;
};

export type StatusHandler = (payload: DeploymentStatusPayload) => void;

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface PollerOptions {
  /** Maximum number of reconnect attempts before giving up. Default: 5 */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff. Default: 500 */
  baseDelayMs?: number;
  /** Maximum backoff delay in ms. Default: 30_000 */
  maxDelayMs?: number;
}

// ── RealtimeStatusPoller ──────────────────────────────────────────────────────

export class RealtimeStatusPoller {
  private channel: RealtimeChannel | null = null;
  private handlers = new Set<StatusHandler>();
  private state: ConnectionState = 'disconnected';
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private sequenceCounter = 0;
  private readonly opts: Required<PollerOptions>;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly deploymentId: string,
    private readonly userId: string,
    opts: PollerOptions = {},
  ) {
    this.opts = {
      maxRetries: opts.maxRetries ?? 5,
      baseDelayMs: opts.baseDelayMs ?? 500,
      maxDelayMs: opts.maxDelayMs ?? 30_000,
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get connectionState(): ConnectionState {
    return this.state;
  }

  /**
   * Subscribe to deployment status updates.
   * Returns an unsubscribe function.
   */
  onStatus(handler: StatusHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Establish the Supabase Realtime channel connection.
   * Validates that the userId matches the deployment owner before subscribing.
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return;
    this.setState('connecting');

    // Authentication check: verify the user owns this deployment
    const { data, error } = await this.supabase
      .from('deployments')
      .select('user_id')
      .eq('id', this.deploymentId)
      .single();

    if (error || !data || data.user_id !== this.userId) {
      this.setState('closed');
      throw new Error('Unauthorized: deployment does not belong to this user');
    }

    this.openChannel();
  }

  /**
   * Disconnect and clean up the channel.
   */
  async disconnect(): Promise<void> {
    this.clearRetryTimer();
    if (this.channel) {
      await this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this.setState('closed');
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private openChannel(): void {
    const channelName = `deployment:${this.deploymentId}`;

    this.channel = this.supabase
      .channel(channelName)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'deployments',
          filter: `id=eq.${this.deploymentId}`,
        },
        (payload: any) => {
          this.sequenceCounter += 1;
          const msg: DeploymentStatusPayload = {
            deploymentId: this.deploymentId,
            status: payload.new?.status ?? 'unknown',
            sequenceNumber: this.sequenceCounter,
            timestamp: new Date().toISOString(),
          };
          this.emit(msg);
        },
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          this.setState('connected');
          this.retryCount = 0;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.handleDisconnect();
        } else if (status === 'CLOSED') {
          if (this.state !== 'closed') {
            this.handleDisconnect();
          }
        }
      });
  }

  private handleDisconnect(): void {
    if (this.state === 'closed') return;

    if (this.retryCount >= this.opts.maxRetries) {
      this.setState('closed');
      return;
    }

    this.setState('reconnecting');
    this.retryCount += 1;

    const delay = Math.min(
      this.opts.baseDelayMs * 2 ** (this.retryCount - 1),
      this.opts.maxDelayMs,
    );

    this.retryTimer = setTimeout(() => {
      if (this.channel) {
        this.supabase.removeChannel(this.channel);
        this.channel = null;
      }
      this.openChannel();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setState(next: ConnectionState): void {
    this.state = next;
  }

  private emit(payload: DeploymentStatusPayload): void {
    for (const handler of this.handlers) {
      handler(payload);
    }
  }
}
