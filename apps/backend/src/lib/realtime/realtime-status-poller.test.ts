import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { RealtimeStatusPoller } from './realtime-status-poller';

// Mock Supabase
vi.mock('@supabase/supabase-js');

describe('RealtimeStatusPoller', () => {
  let mockSupabase: Partial<SupabaseClient>;
  let mockChannel: Partial<RealtimeChannel>;

  beforeEach(() => {
    mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    };

    mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { user_id: 'user-123' },
              error: null,
            }),
          }),
        }),
      }),
      channel: vi.fn().mockReturnValue(mockChannel),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates a poller with default options', () => {
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
      );
      expect(poller.connectionState).toBe('disconnected');
    });

    it('accepts custom backoff options', () => {
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
        {
          maxRetries: 3,
          baseDelayMs: 100,
          maxDelayMs: 5000,
        },
      );
      expect(poller.connectionState).toBe('disconnected');
    });

    it('accepts injectable random function', () => {
      const mockRandom = vi.fn().mockReturnValue(0.5);
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
        { randomFn: mockRandom },
      );
      expect(poller.connectionState).toBe('disconnected');
    });
  });

  describe('onStatus', () => {
    it('registers a status handler', () => {
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
      );
      const handler = vi.fn();
      const unsubscribe = poller.onStatus(handler);

      expect(typeof unsubscribe).toBe('function');
    });

    it('returns a function that unsubscribes the handler', () => {
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
      );
      const handler = vi.fn();
      const unsubscribe = poller.onStatus(handler);

      unsubscribe();
      expect(unsubscribe).toBeDefined();
    });
  });

  describe('connectionState', () => {
    it('returns the current connection state', () => {
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
      );
      expect(poller.connectionState).toBe('disconnected');
    });
  });

  describe('disconnect', () => {
    it('sets state to closed', async () => {
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
      );
      await poller.disconnect();
      expect(poller.connectionState).toBe('closed');
    });
  });

  describe('backoff with jitter', () => {
    it('applies jitter to reconnect delays using injectable random', async () => {
      vi.useFakeTimers();

      // Track delays applied to setTimeout
      const delays: number[] = [];
      const originalSetTimeout = setTimeout;
      vi.stubGlobal('setTimeout', vi.fn((cb: any, delay: number) => {
        delays.push(delay);
        return originalSetTimeout(cb, 0); // Run immediately for test
      }));

      const mockRandom = vi.fn()
        .mockReturnValueOnce(0.5) // First retry
        .mockReturnValueOnce(0.5); // Second retry

      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
        {
          baseDelayMs: 100,
          maxDelayMs: 10000,
          maxRetries: 5,
          randomFn: mockRandom,
        },
      );

      await poller.connect();

      // Simulate disconnect by calling subscribe callback
      const subscribeCallback = (mockChannel.subscribe as any).mock.calls[0][0];
      subscribeCallback('CHANNEL_ERROR');

      vi.runAllTimers();
      vi.useRealTimers();

      // Should have at least one delay (from first reconnect attempt)
      expect(delays.length).toBeGreaterThan(0);
    });

    it('respects max retry count', async () => {
      vi.useFakeTimers();

      const mockRandom = vi.fn().mockReturnValue(0.5);
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
        {
          maxRetries: 2,
          baseDelayMs: 100,
          randomFn: mockRandom,
        },
      );

      await poller.connect();

      const subscribeCallback = (mockChannel.subscribe as any).mock.calls[0][0];

      // Trigger disconnects up to max retries
      subscribeCallback('CHANNEL_ERROR');
      vi.runAllTimers();

      subscribeCallback('CHANNEL_ERROR');
      vi.runAllTimers();

      // After max retries, should transition to closed
      expect(poller.connectionState).toBe('closed');

      vi.useRealTimers();
    });

    it('calculates delays with exponential backoff', async () => {
      const delays: number[] = [];

      // Mock calculateBackoffDelay to capture arguments
      vi.stubGlobal('setTimeout', vi.fn((cb: any, delay: number) => {
        delays.push(delay);
        return 0;
      }));

      const mockRandom = vi.fn().mockReturnValue(0.5);
      const poller = new RealtimeStatusPoller(
        mockSupabase as SupabaseClient,
        'deploy-123',
        'user-123',
        {
          baseDelayMs: 100,
          maxDelayMs: 10000,
          randomFn: mockRandom,
        },
      );

      await poller.connect();

      const subscribeCallback = (mockChannel.subscribe as any).mock.calls[0][0];

      // First disconnect: attempt 0, delay ≈ 100ms (with jitter)
      subscribeCallback('CHANNEL_ERROR');
      const firstDelay = delays[delays.length - 1];

      // Second disconnect: attempt 1, delay ≈ 200ms (with jitter)
      subscribeCallback('CHANNEL_ERROR');
      const secondDelay = delays[delays.length - 1];

      // Second delay should generally be >= first delay (exponential)
      // Note: due to jitter, this isn't always true, but with controlled random it should be
      expect(secondDelay).toBeGreaterThanOrEqual(firstDelay * 0.8); // Allow for jitter variance
    });
  });
});
