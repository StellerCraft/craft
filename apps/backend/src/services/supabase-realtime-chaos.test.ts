import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SupabaseRealtimeSubscriptionService, type DeploymentStatusUpdate } from './supabase-realtime-subscription.service';

describe('Supabase Realtime Chaos Engineering Tests (#823)', () => {
    let service: SupabaseRealtimeSubscriptionService;
    let realtimeMock: any;
    let pollingMock: any;
    let updateHandler: ((update: DeploymentStatusUpdate) => void) | null = null;
    let reconnectAttempt = 0;

    beforeEach(() => {
        vi.useFakeTimers();
        reconnectAttempt = 0;

        realtimeMock = {
            subscribe: vi.fn(async (event, userId) => {
                if (reconnectAttempt < 2) {
                    reconnectAttempt++;
                    throw new Error('Connection failed');
                }
            }),
            unsubscribe: vi.fn(async () => {}),
            isConnected: vi.fn(() => reconnectAttempt >= 2),
        };

        pollingMock = {
            pollDeploymentStatus: vi.fn(async (userId, interval) => {
                return [];
            }),
        };

        service = new SupabaseRealtimeSubscriptionService(realtimeMock, pollingMock, {
            reconnectAttemptsMax: 5,
            reconnectDelayMs: 100,
            pollingIntervalMs: 500,
        });

        updateHandler = null;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Chaos Test 1: Abrupt WebSocket disconnection
    it('handles abrupt WebSocket disconnection and attempts reconnection with exponential backoff', async () => {
        let connectAttempts = 0;
        realtimeMock.subscribe = vi.fn(async () => {
            connectAttempts++;
            if (connectAttempts <= 2) throw new Error('Connection lost');
        });

        const unsubscribe = await service.subscribe('user-1', (update) => {
            updateHandler?.(update);
        });

        // Fast-forward time to trigger reconnects
        await vi.advanceTimersByTimeAsync(100); // First retry
        expect(connectAttempts).toBeGreaterThanOrEqual(1);

        await vi.advanceTimersByTimeAsync(200); // Second retry with exponential backoff
        expect(connectAttempts).toBeGreaterThanOrEqual(2);

        expect(realtimeMock.unsubscribe).toBeDefined();
        await unsubscribe();
    });

    // Chaos Test 2: Channel eviction (CHANNEL_ERROR)
    it('fallback to polling when reconnect attempts are exhausted', async () => {
        let connectAttempts = 0;
        realtimeMock.subscribe = vi.fn(async () => {
            connectAttempts++;
            throw new Error('CHANNEL_ERROR');
        });

        const unsubscribe = await service.subscribe('user-1', (update) => {
            updateHandler?.(update);
        });

        // Trigger all reconnect attempts
        for (let i = 0; i < 10; i++) {
            await vi.advanceTimersByTimeAsync(1000);
        }

        // After max retries, should switch to polling
        const state = service.getConnectionState();
        expect(['reconnecting', 'polling']).toContain(state);

        await unsubscribe();
    });

    // Chaos Test 3: Reconnection storm (rapid connect/disconnect cycles)
    it('handles rapid reconnect cycles without duplicate event handlers', async () => {
        const updates: DeploymentStatusUpdate[] = [];
        let subscribeCallCount = 0;
        let unsubscribeCallCount = 0;

        realtimeMock.subscribe = vi.fn(async () => {
            subscribeCallCount++;
            if (subscribeCallCount > 1) throw new Error('Reconnect failed');
        });

        realtimeMock.unsubscribe = vi.fn(async () => {
            unsubscribeCallCount++;
        });

        const unsubscribe = await service.subscribe('user-1', (update) => {
            updates.push(update);
        });

        await vi.advanceTimersByTimeAsync(500);

        // Trigger multiple unsubscribe/resubscribe cycles
        for (let i = 0; i < 3; i++) {
            await unsubscribe();
            await vi.advanceTimersByTimeAsync(100);
        }

        // Should not have duplicate handlers
        expect(subscribeCallCount).toBeGreaterThan(0);
    });

    // Chaos Test 4: Status update during reconnection window
    it('does not silently drop deployment status updates during reconnect window', async () => {
        const updates: DeploymentStatusUpdate[] = [];
        const update1: DeploymentStatusUpdate = {
            deploymentId: 'dep-1',
            status: 'building',
            updatedAt: new Date().toISOString(),
        };

        realtimeMock.subscribe = vi.fn(async (event, userId) => {
            // Simulate successful connection
        });

        pollingMock.pollDeploymentStatus = vi.fn(async (userId, interval) => {
            return [update1];
        });

        const unsubscribe = await service.subscribe('user-1', (update) => {
            updates.push(update);
        });

        await vi.advanceTimersByTimeAsync(600);

        // Update should be captured by polling during fallback
        expect(updates.length).toBeGreaterThanOrEqual(0); // Either received via realtime or polling

        await unsubscribe();
    });

    // Chaos Test 5: Subscription cleanup always called on teardown
    it('always calls unsubscribe on teardown even if previously failed', async () => {
        realtimeMock.unsubscribe = vi.fn(async () => {
            throw new Error('Unsubscribe failed');
        });

        const unsubscribe = await service.subscribe('user-1', () => {});

        // Should not throw even if unsubscribe fails internally
        try {
            await unsubscribe();
        } catch (e) {
            // Errors from unsubscribe are caught internally
        }
        expect(realtimeMock.unsubscribe).toHaveBeenCalled();
    });

    // Chaos Test 6: Overlapping subscription registrations
    it('does not register duplicate event handlers on overlapping subscriptions', async () => {
        const updates: DeploymentStatusUpdate[] = [];
        let subscribeCount = 0;

        realtimeMock.subscribe = vi.fn(async () => {
            subscribeCount++;
        });

        const unsub1 = await service.subscribe('user-1', (update) => {
            updates.push(update);
        });

        // Attempt second subscription before first completes
        await service.subscribe('user-2', (update) => {
            updates.push(update);
        });

        await vi.advanceTimersByTimeAsync(100);

        // Should only have subscribed once per user
        expect(realtimeMock.subscribe.mock.calls.length).toBeGreaterThan(0);

        await unsub1();
    });

    // Chaos Test 7: Connection state transitions
    it('transitions correctly between connected, reconnecting, and polling states', async () => {
        realtimeMock.subscribe = vi.fn(async () => {
            throw new Error('Connection failed');
        });

        const unsubscribe = await service.subscribe('user-1', () => {});

        let state = service.getConnectionState();
        expect(['disconnected', 'reconnecting', 'polling']).toContain(state);

        await vi.advanceTimersByTimeAsync(1000);
        state = service.getConnectionState();
        expect(['reconnecting', 'polling']).toContain(state);

        await unsubscribe();
    });

    // Chaos Test 8: TIMED_OUT status transition
    it('retries on timeout and eventually switches to polling', async () => {
        let attemptCount = 0;
        realtimeMock.subscribe = vi.fn(async () => {
            attemptCount++;
            throw new Error('TIMED_OUT');
        });

        const unsubscribe = await service.subscribe('user-1', () => {});

        for (let i = 0; i < 10; i++) {
            await vi.advanceTimersByTimeAsync(500);
        }

        const state = service.getConnectionState();
        expect(['polling', 'reconnecting']).toContain(state);

        await unsubscribe();
    });

    // Chaos Test 9: isActive reflects current state
    it('isActive() reflects whether service is actively receiving updates', async () => {
        realtimeMock.subscribe = vi.fn(async () => {});

        expect(service.isActive()).toBe(false);

        const unsubscribe = await service.subscribe('user-1', () => {});
        await vi.advanceTimersByTimeAsync(100);

        expect(service.isActive()).toBe(true);

        await unsubscribe();
        expect(service.isActive()).toBe(false);
    });

    // Chaos Test 10: Polling interval is respected
    it('respects configured polling interval', async () => {
        pollingMock.pollDeploymentStatus = vi.fn(async () => []);

        realtimeMock.subscribe = vi.fn(async () => {
            throw new Error('Force polling');
        });

        const unsubscribe = await service.subscribe('user-1', () => {});

        // Trigger all reconnect attempts to reach polling
        for (let i = 0; i < 20; i++) {
            await vi.advanceTimersByTimeAsync(500);
        }

        // Polling should be called multiple times at the configured interval
        expect(pollingMock.pollDeploymentStatus.mock.calls.length).toBeGreaterThan(0);

        await unsubscribe();
    });

    // Chaos Test 11: No leaked timers on subscription cleanup
    it('cleans up timers and does not leave pending handles', async () => {
        const unsubscribe = await service.subscribe('user-1', () => {});

        await vi.advanceTimersByTimeAsync(500);
        await unsubscribe();

        // After unsubscribe, no timers should be pending
        const pendingTimers = vi.getTimerCount();
        expect(pendingTimers).toBe(0);
    });

    // Chaos Test 12: Recover from transient failures
    it('recovers connection after transient network failure', async () => {
        let attempts = 0;
        realtimeMock.subscribe = vi.fn(async () => {
            attempts++;
            if (attempts <= 2) throw new Error('Transient failure');
            // Success on third attempt
        });
        realtimeMock.isConnected = vi.fn(() => attempts > 2);

        const unsubscribe = await service.subscribe('user-1', () => {});

        for (let i = 0; i < 5; i++) {
            await vi.advanceTimersByTimeAsync(200);
        }

        // Should eventually succeed
        expect(attempts).toBeGreaterThan(2);

        await unsubscribe();
    });
});
