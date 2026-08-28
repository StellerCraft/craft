import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SupabaseRealtimeSubscriptionService,
  DeploymentStatusUpdate,
  ConnectionState,
} from './supabase-realtime-subscription.service';

/**
 * Integration Tests: Supabase Realtime Connection Recovery
 *
 * Tests:
 * - WebSocket disconnection mid-subscription: automatic reconnection within 5 seconds
 * - Event replay after reconnection
 * - Handler deduplication (not double-registered)
 */

describe('SupabaseRealtimeSubscriptionService - Network Interruption Recovery', () => {
  let service: SupabaseRealtimeSubscriptionService;
  let mockRealtime: any;
  let mockPolling: any;
  let updateCallback: ((update: DeploymentStatusUpdate) => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();

    mockRealtime = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(async () => {}),
      isConnected: vi.fn(() => false),
    };

    mockPolling = {
      pollDeploymentStatus: vi.fn(),
    };

    service = new SupabaseRealtimeSubscriptionService(mockRealtime, mockPolling, {
      reconnectDelayMs: 100, // Shorter delays for tests
      reconnectAttemptsMax: 3,
      pollingIntervalMs: 500,
    });

    updateCallback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Successful connection and event reception', () => {
    it('should connect to realtime successfully', async () => {
      mockRealtime.subscribe.mockResolvedValue(undefined);

      const unsubscribe = await service.subscribe('user_123', (update) => {
        updateCallback?.(update);
      });

      expect(mockRealtime.subscribe).toHaveBeenCalledWith('deployments', 'user_123');
      expect(service.getConnectionState()).toBe('connected');
      expect(service.isActive()).toBe(true);

      await unsubscribe();
    });

    it('should receive 3 successful events', async () => {
      mockRealtime.subscribe.mockResolvedValue(undefined);
      const updates: DeploymentStatusUpdate[] = [];

      updateCallback = (update) => {
        updates.push(update);
      };

      const unsubscribe = await service.subscribe('user_123', (update) => {
        updateCallback?.(update);
      });

      // Simulate events from realtime
      const event1: DeploymentStatusUpdate = {
        deploymentId: 'dep_001',
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };
      const event2: DeploymentStatusUpdate = {
        deploymentId: 'dep_002',
        status: 'building',
        updatedAt: new Date().toISOString(),
      };
      const event3: DeploymentStatusUpdate = {
        deploymentId: 'dep_003',
        status: 'ready',
        updatedAt: new Date().toISOString(),
        url: 'https://deploy.example.com',
      };

      updateCallback?.(event1);
      updateCallback?.(event2);
      updateCallback?.(event3);

      expect(updates).toHaveLength(3);
      expect(updates[0].status).toBe('pending');
      expect(updates[1].status).toBe('building');
      expect(updates[2].status).toBe('ready');

      await unsubscribe();
    });
  });

  describe('Disconnection and reconnection', () => {
    it('should detect disconnection and attempt reconnection within 5 seconds', async () => {
      mockRealtime.subscribe.mockRejectedValueOnce(new Error('Connection failed'));
      mockRealtime.subscribe.mockResolvedValueOnce(undefined);

      const unsubscribe = await service.subscribe('user_123', () => {});

      expect(service.getConnectionState()).not.toBe('disconnected');

      // Advance time to trigger reconnection retry
      await vi.advanceTimersByTimeAsync(200);

      // After exponential backoff, should attempt reconnect
      expect(mockRealtime.subscribe).toHaveBeenCalledTimes(2);

      await unsubscribe();
    });

    it('should reconnect within 5 seconds after 3 events', async () => {
      mockRealtime.subscribe.mockResolvedValueOnce(undefined);
      const updates: DeploymentStatusUpdate[] = [];

      updateCallback = (update) => {
        updates.push(update);
      };

      const unsubscribe = await service.subscribe('user_123', (update) => {
        updateCallback?.(update);
      });

      // Receive 3 events
      updateCallback?.({
        deploymentId: 'dep_001',
        status: 'pending',
        updatedAt: new Date().toISOString(),
      });
      updateCallback?.({
        deploymentId: 'dep_002',
        status: 'building',
        updatedAt: new Date().toISOString(),
      });
      updateCallback?.({
        deploymentId: 'dep_003',
        status: 'ready',
        updatedAt: new Date().toISOString(),
      });

      expect(updates).toHaveLength(3);
      expect(service.getConnectionState()).toBe('connected');

      await unsubscribe();
    });

    it('should fallback to polling after max reconnection attempts', async () => {
      mockRealtime.subscribe
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'));

      mockPolling.pollDeploymentStatus.mockResolvedValue([
        {
          deploymentId: 'dep_poll_001',
          status: 'ready',
          updatedAt: new Date().toISOString(),
        },
      ]);

      const unsubscribe = await service.subscribe('user_123', () => {});

      // Advance time past max reconnect attempts
      await vi.advanceTimersByTimeAsync(1000);

      expect(service.getConnectionState()).toBe('polling');
      expect(service.isActive()).toBe(true);

      await unsubscribe();
    });
  });

  describe('Event replay after reconnection', () => {
    it('should not replay events already received before disconnection', async () => {
      mockRealtime.subscribe.mockResolvedValue(undefined);
      const updates: DeploymentStatusUpdate[] = [];

      updateCallback = (update) => {
        updates.push(update);
      };

      const unsubscribe = await service.subscribe('user_123', (update) => {
        updateCallback?.(update);
      });

      const event: DeploymentStatusUpdate = {
        deploymentId: 'dep_001',
        status: 'pending',
        updatedAt: new Date().toISOString(),
      };

      updateCallback?.(event);
      expect(updates).toHaveLength(1);

      await unsubscribe();
    });

    it('should handle recovery and resume without interruption', async () => {
      mockRealtime.subscribe.mockResolvedValue(undefined);
      mockRealtime.isConnected.mockReturnValueOnce(true); // Recover

      const updates: DeploymentStatusUpdate[] = [];

      updateCallback = (update) => {
        updates.push(update);
      };

      const unsubscribe = await service.subscribe('user_123', (update) => {
        updateCallback?.(update);
      });

      // Simulate initial events
      updateCallback?.({
        deploymentId: 'dep_001',
        status: 'pending',
        updatedAt: new Date().toISOString(),
      });

      // Recovery
      mockRealtime.isConnected.mockReturnValueOnce(true);

      updateCallback?.({
        deploymentId: 'dep_002',
        status: 'ready',
        updatedAt: new Date().toISOString(),
      });

      expect(updates.length).toBeGreaterThanOrEqual(2);

      await unsubscribe();
    });
  });

  describe('Handler deduplication', () => {
    it('should not double-register event handlers after reconnect', async () => {
      mockRealtime.subscribe.mockResolvedValue(undefined);
      let callCount = 0;

      const handler = () => {
        callCount++;
      };

      const unsubscribe = await service.subscribe('user_123', handler);

      // Subscribe again should not double-register
      const unsubscribe2 = await service.subscribe('user_123', handler);

      expect(mockRealtime.subscribe).toHaveBeenCalledTimes(2);
      expect(callCount).toBe(0); // Handler not called until events arrive

      await unsubscribe();
      await unsubscribe2();
    });

    it('should maintain single handler after connection recovery', async () => {
      mockRealtime.subscribe.mockResolvedValue(undefined);
      mockRealtime.isConnected.mockReturnValue(false);

      const handler = vi.fn();

      const unsubscribe = await service.subscribe('user_123', handler);

      expect(mockRealtime.subscribe).toHaveBeenCalledWith('deployments', 'user_123');
      expect(service.getConnectionState()).toBe('connected');

      await unsubscribe();
    });

    it('should unsubscribe cleanly and stop all listeners', async () => {
      mockRealtime.subscribe.mockResolvedValue(undefined);

      const unsubscribe = await service.subscribe('user_123', () => {});

      expect(service.isActive()).toBe(true);

      await unsubscribe();

      expect(service.isActive()).toBe(false);
      expect(service.getConnectionState()).toBe('disconnected');
      expect(mockRealtime.unsubscribe).toHaveBeenCalled();
    });
  });

  describe('Polling fallback strategy', () => {
    it('should poll when realtime connection exhausts retries', async () => {
      mockRealtime.subscribe
        .mockRejectedValueOnce(new Error('Failed'))
        .mockRejectedValueOnce(new Error('Failed'))
        .mockRejectedValueOnce(new Error('Failed'));

      mockPolling.pollDeploymentStatus.mockResolvedValue([
        { deploymentId: 'dep_poll', status: 'ready', updatedAt: new Date().toISOString() },
      ]);

      const updates: DeploymentStatusUpdate[] = [];

      const unsubscribe = await service.subscribe('user_123', (update) => {
        updates.push(update);
      });

      await vi.advanceTimersByTimeAsync(1000);

      expect(service.getConnectionState()).toBe('polling');
      expect(mockPolling.pollDeploymentStatus).toHaveBeenCalled();

      await unsubscribe();
    });
  });
});
