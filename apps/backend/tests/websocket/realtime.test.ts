/**
 * Real-time WebSocket Connection Tests (#339)
 *
 * Tests the RealtimeStatusPoller which wraps Supabase Realtime channels
 * (WebSocket transport) for deployment status updates.
 *
 * Coverage:
 *   1. Connection lifecycle (connect, disconnect, state transitions)
 *   2. Authentication (ownership check before subscribing)
 *   3. Message delivery and ordering (sequence numbers)
 *   4. Reconnection with exponential backoff
 *   5. Concurrent connections (multiple pollers for different deployments)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RealtimeStatusPoller } from '@/lib/realtime/realtime-status-poller';
import type { DeploymentStatusPayload } from '@/lib/realtime/realtime-status-poller';

// ── Supabase channel mock factory ─────────────────────────────────────────────

type SubscribeCallback = (status: string) => void;
type ChangeCallback = (payload: any) => void;

interface MockChannel {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  _triggerSubscribe: (status: string) => void;
  _triggerChange: (payload: any) => void;
}

function makeMockChannel(): MockChannel {
  let subscribeCb: SubscribeCallback = () => {};
  let changeCb: ChangeCallback = () => {};

  const channel: MockChannel = {
    on: vi.fn().mockImplementation((_event: any, _filter: any, cb: ChangeCallback) => {
      changeCb = cb;
      return channel;
    }),
    subscribe: vi.fn().mockImplementation((cb: SubscribeCallback) => {
      subscribeCb = cb;
      return channel;
    }),
    _triggerSubscribe: (status: string) => subscribeCb(status),
    _triggerChange: (payload: any) => changeCb(payload),
  };
  return channel;
}

function makeSupabaseMock(opts: {
  deploymentUserId?: string;
  queryError?: boolean;
} = {}) {
  const channel = makeMockChannel();

  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(
            opts.queryError
              ? { data: null, error: new Error('db error') }
              : { data: { user_id: opts.deploymentUserId ?? 'user-1' }, error: null }
          ),
        }),
      }),
    }),
    channel: vi.fn().mockReturnValue(channel),
    removeChannel: vi.fn().mockResolvedValue(undefined),
    _channel: channel,
  };

  return supabase;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Connection lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('RealtimeStatusPoller – connection lifecycle', () => {
  it('starts in disconnected state', () => {
    const supabase = makeSupabaseMock();
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');
    expect(poller.connectionState).toBe('disconnected');
  });

  it('transitions to connecting then connected on successful subscribe', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    const connectPromise = poller.connect();
    await connectPromise;
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    expect(poller.connectionState).toBe('connected');
  });

  it('transitions to closed on disconnect()', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    await poller.disconnect();
    expect(poller.connectionState).toBe('closed');
  });

  it('calls supabase.removeChannel on disconnect', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    await poller.disconnect();
    expect(supabase.removeChannel).toHaveBeenCalledOnce();
  });

  it('does not open a second channel if already connected', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    await poller.connect(); // second call — should be a no-op
    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });

  it('does not open a second channel if already connecting', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    // Start connecting but don't trigger SUBSCRIBED yet
    const p1 = poller.connect();
    const p2 = poller.connect();
    await Promise.all([p1, p2]);
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    expect(supabase.channel).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Authentication
// ─────────────────────────────────────────────────────────────────────────────

describe('RealtimeStatusPoller – authentication', () => {
  it('throws and sets state=closed when deployment belongs to a different user', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'other-user' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    await expect(poller.connect()).rejects.toThrow('Unauthorized');
    expect(poller.connectionState).toBe('closed');
  });

  it('throws and sets state=closed when the DB query errors', async () => {
    const supabase = makeSupabaseMock({ queryError: true });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    await expect(poller.connect()).rejects.toThrow('Unauthorized');
    expect(poller.connectionState).toBe('closed');
  });

  it('does not open a channel when auth fails', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'other-user' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    await expect(poller.connect()).rejects.toThrow();
    expect(supabase.channel).not.toHaveBeenCalled();
  });

  it('opens the channel when auth succeeds', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    expect(supabase.channel).toHaveBeenCalledWith('deployment:dep-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Message delivery and ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('RealtimeStatusPoller – message delivery and ordering', () => {
  async function connectedPoller() {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1');
    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');
    return { poller, supabase };
  }

  it('delivers status updates to registered handlers', async () => {
    const { poller, supabase } = await connectedPoller();
    const received: DeploymentStatusPayload[] = [];
    poller.onStatus((msg) => received.push(msg));

    supabase._channel._triggerChange({ new: { status: 'building' } });

    expect(received).toHaveLength(1);
    expect(received[0].status).toBe('building');
    expect(received[0].deploymentId).toBe('dep-1');
  });

  it('assigns monotonically increasing sequence numbers', async () => {
    const { poller, supabase } = await connectedPoller();
    const received: DeploymentStatusPayload[] = [];
    poller.onStatus((msg) => received.push(msg));

    supabase._channel._triggerChange({ new: { status: 'building' } });
    supabase._channel._triggerChange({ new: { status: 'deploying' } });
    supabase._channel._triggerChange({ new: { status: 'completed' } });

    expect(received.map((m) => m.sequenceNumber)).toEqual([1, 2, 3]);
  });

  it('delivers messages to multiple handlers', async () => {
    const { poller, supabase } = await connectedPoller();
    const a: string[] = [];
    const b: string[] = [];
    poller.onStatus((m) => a.push(m.status));
    poller.onStatus((m) => b.push(m.status));

    supabase._channel._triggerChange({ new: { status: 'completed' } });

    expect(a).toEqual(['completed']);
    expect(b).toEqual(['completed']);
  });

  it('stops delivering to a handler after unsubscribe', async () => {
    const { poller, supabase } = await connectedPoller();
    const received: string[] = [];
    const unsub = poller.onStatus((m) => received.push(m.status));

    supabase._channel._triggerChange({ new: { status: 'building' } });
    unsub();
    supabase._channel._triggerChange({ new: { status: 'completed' } });

    expect(received).toEqual(['building']);
  });

  it('includes a timestamp on every message', async () => {
    const { poller, supabase } = await connectedPoller();
    const received: DeploymentStatusPayload[] = [];
    poller.onStatus((m) => received.push(m));

    supabase._channel._triggerChange({ new: { status: 'building' } });

    expect(new Date(received[0].timestamp).getTime()).toBeGreaterThan(0);
  });

  it('handles unknown status gracefully', async () => {
    const { poller, supabase } = await connectedPoller();
    const received: DeploymentStatusPayload[] = [];
    poller.onStatus((m) => received.push(m));

    supabase._channel._triggerChange({ new: {} }); // no status field

    expect(received[0].status).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Reconnection with exponential backoff
// ─────────────────────────────────────────────────────────────────────────────

describe('RealtimeStatusPoller – reconnection with exponential backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions to reconnecting on CHANNEL_ERROR', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1', { baseDelayMs: 100 });

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    supabase._channel._triggerSubscribe('CHANNEL_ERROR');
    expect(poller.connectionState).toBe('reconnecting');
  });

  it('transitions to reconnecting on TIMED_OUT', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1', { baseDelayMs: 100 });

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    supabase._channel._triggerSubscribe('TIMED_OUT');
    expect(poller.connectionState).toBe('reconnecting');
  });

  it('reopens the channel after the backoff delay', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1', { baseDelayMs: 100 });

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    supabase._channel._triggerSubscribe('CHANNEL_ERROR');
    expect(supabase.channel).toHaveBeenCalledTimes(1);

    // Advance past the first backoff window (100ms * 2^0 = 100ms)
    await vi.advanceTimersByTimeAsync(150);
    expect(supabase.channel).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff: delay doubles on each retry', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1', {
      baseDelayMs: 100,
      maxRetries: 5,
    });

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    // Retry 1: delay = 100ms
    supabase._channel._triggerSubscribe('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(110);
    supabase._channel._triggerSubscribe('CHANNEL_ERROR');

    // Retry 2: delay = 200ms — should NOT fire at 110ms
    expect(supabase.channel).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(210);
    expect(supabase.channel).toHaveBeenCalledTimes(3);
  });

  it('caps backoff at maxDelayMs', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1', {
      baseDelayMs: 1000,
      maxDelayMs: 2000,
      maxRetries: 10,
    });

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    // Force several retries to push past the cap
    for (let i = 0; i < 5; i++) {
      supabase._channel._triggerSubscribe('CHANNEL_ERROR');
      await vi.advanceTimersByTimeAsync(2100);
      supabase._channel._triggerSubscribe('SUBSCRIBED');
    }

    // All retries should have fired (not stuck waiting for > maxDelayMs)
    expect(supabase.channel.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('transitions to closed after maxRetries exhausted', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1', {
      baseDelayMs: 10,
      maxRetries: 2,
    });

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    // Exhaust all retries
    for (let i = 0; i < 3; i++) {
      supabase._channel._triggerSubscribe('CHANNEL_ERROR');
      await vi.advanceTimersByTimeAsync(500);
    }

    expect(poller.connectionState).toBe('closed');
  });

  it('resets retry count after a successful reconnect', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1', {
      baseDelayMs: 10,
      maxRetries: 3,
    });

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    // Disconnect and reconnect successfully
    supabase._channel._triggerSubscribe('CHANNEL_ERROR');
    await vi.advanceTimersByTimeAsync(50);
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    // Should still be connected (retry count reset)
    expect(poller.connectionState).toBe('connected');
  });

  it('cancels pending retry timer on explicit disconnect', async () => {
    const supabase = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const poller = new RealtimeStatusPoller(supabase as any, 'dep-1', 'user-1', {
      baseDelayMs: 1000,
      maxRetries: 5,
    });

    await poller.connect();
    supabase._channel._triggerSubscribe('SUBSCRIBED');

    supabase._channel._triggerSubscribe('CHANNEL_ERROR');
    expect(poller.connectionState).toBe('reconnecting');

    await poller.disconnect();
    expect(poller.connectionState).toBe('closed');

    // Advance past the retry window — no new channel should open
    const callsBefore = supabase.channel.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(supabase.channel.mock.calls.length).toBe(callsBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Concurrent connections
// ─────────────────────────────────────────────────────────────────────────────

describe('RealtimeStatusPoller – concurrent connections', () => {
  it('creates independent channels for different deployments', async () => {
    const s1 = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const s2 = makeSupabaseMock({ deploymentUserId: 'user-1' });

    const p1 = new RealtimeStatusPoller(s1 as any, 'dep-A', 'user-1');
    const p2 = new RealtimeStatusPoller(s2 as any, 'dep-B', 'user-1');

    await p1.connect();
    s1._channel._triggerSubscribe('SUBSCRIBED');

    await p2.connect();
    s2._channel._triggerSubscribe('SUBSCRIBED');

    expect(s1.channel).toHaveBeenCalledWith('deployment:dep-A');
    expect(s2.channel).toHaveBeenCalledWith('deployment:dep-B');
  });

  it('messages from one channel do not reach handlers of another', async () => {
    const s1 = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const s2 = makeSupabaseMock({ deploymentUserId: 'user-1' });

    const p1 = new RealtimeStatusPoller(s1 as any, 'dep-A', 'user-1');
    const p2 = new RealtimeStatusPoller(s2 as any, 'dep-B', 'user-1');

    const msgs1: string[] = [];
    const msgs2: string[] = [];
    p1.onStatus((m) => msgs1.push(m.deploymentId));
    p2.onStatus((m) => msgs2.push(m.deploymentId));

    await p1.connect();
    s1._channel._triggerSubscribe('SUBSCRIBED');

    await p2.connect();
    s2._channel._triggerSubscribe('SUBSCRIBED');

    s1._channel._triggerChange({ new: { status: 'building' } });
    s2._channel._triggerChange({ new: { status: 'completed' } });

    expect(msgs1).toEqual(['dep-A']);
    expect(msgs2).toEqual(['dep-B']);
  });

  it('disconnecting one poller does not affect another', async () => {
    const s1 = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const s2 = makeSupabaseMock({ deploymentUserId: 'user-1' });

    const p1 = new RealtimeStatusPoller(s1 as any, 'dep-A', 'user-1');
    const p2 = new RealtimeStatusPoller(s2 as any, 'dep-B', 'user-1');

    await p1.connect();
    s1._channel._triggerSubscribe('SUBSCRIBED');

    await p2.connect();
    s2._channel._triggerSubscribe('SUBSCRIBED');

    await p1.disconnect();

    expect(p1.connectionState).toBe('closed');
    expect(p2.connectionState).toBe('connected');
  });

  it('sequence numbers are independent per poller instance', async () => {
    const s1 = makeSupabaseMock({ deploymentUserId: 'user-1' });
    const s2 = makeSupabaseMock({ deploymentUserId: 'user-1' });

    const p1 = new RealtimeStatusPoller(s1 as any, 'dep-A', 'user-1');
    const p2 = new RealtimeStatusPoller(s2 as any, 'dep-B', 'user-1');

    const seqs1: number[] = [];
    const seqs2: number[] = [];
    p1.onStatus((m) => seqs1.push(m.sequenceNumber));
    p2.onStatus((m) => seqs2.push(m.sequenceNumber));

    await p1.connect();
    s1._channel._triggerSubscribe('SUBSCRIBED');

    await p2.connect();
    s2._channel._triggerSubscribe('SUBSCRIBED');

    s1._channel._triggerChange({ new: { status: 'building' } });
    s1._channel._triggerChange({ new: { status: 'deploying' } });
    s2._channel._triggerChange({ new: { status: 'completed' } });

    expect(seqs1).toEqual([1, 2]);
    expect(seqs2).toEqual([1]); // independent counter
  });
});
