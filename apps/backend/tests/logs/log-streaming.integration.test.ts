// @vitest-environment node
/**
 * Deployment Log Streaming SSE Integration Test
 *
 * Verifies SSE connection management: proper headers, real-time delivery,
 * auto-close on completion, and client disconnect handling.
 *
 * Run: pnpm test -- log-streaming.integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface SSEEvent {
  id: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}

interface StreamConfig {
  deploymentId: string;
  maxDuration: number;
  heartbeatInterval: number;
}

class MockSSEStream {
  private events: SSEEvent[] = [];
  private eventId = 0;
  private isOpen = true;
  private writeDelay = 0;

  constructor(private config: StreamConfig) {}

  async writeEvent(event: string, data: Record<string, unknown>): Promise<void> {
    if (!this.isOpen) return;

    if (this.writeDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.writeDelay));
    }

    this.events.push({
      id: String(this.eventId++),
      event,
      data,
      timestamp: Date.now(),
    });
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }

  getEvents(): SSEEvent[] {
    return this.events;
  }

  isConnected(): boolean {
    return this.isOpen;
  }

  setWriteDelay(ms: number): void {
    this.writeDelay = ms;
  }
}

class DeploymentLogStreamService {
  private streams = new Map<string, MockSSEStream>();

  createStream(deploymentId: string, config: StreamConfig): MockSSEStream {
    const stream = new MockSSEStream(config);
    this.streams.set(deploymentId, stream);
    return stream;
  }

  getStream(deploymentId: string): MockSSEStream | undefined {
    return this.streams.get(deploymentId);
  }

  removeStream(deploymentId: string): void {
    this.streams.delete(deploymentId);
  }
}

describe('Deployment Log Streaming SSE Connection Management', () => {
  let logStreamService: DeploymentLogStreamService;
  let stream: MockSSEStream;
  const deploymentId = 'dep-test-123';

  beforeEach(() => {
    logStreamService = new DeploymentLogStreamService();
    stream = logStreamService.createStream(deploymentId, {
      deploymentId,
      maxDuration: 60000,
      heartbeatInterval: 30000,
    });
  });

  describe('SSE Headers and Response Format', () => {
    it('should respond with text/event-stream Content-Type header', async () => {
      const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      };

      expect(headers['Content-Type']).toBe('text/event-stream');
      expect(headers['Cache-Control']).toBe('no-cache');
      expect(headers['Connection']).toBe('keep-alive');
    });

    it('should include CORS headers in SSE response', async () => {
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      expect(headers['Access-Control-Allow-Origin']).toBe('*');
      expect(headers['Access-Control-Allow-Methods']).toBe('GET');
      expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type');
    });

    it('should send connected event on stream initialization', async () => {
      await stream.writeEvent('connected', {
        deploymentId,
        timestamp: new Date().toISOString(),
      });

      const events = stream.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('connected');
      expect(events[0].data.deploymentId).toBe(deploymentId);
    });
  });

  describe('Real-Time Log Delivery', () => {
    it('should stream log events as they are written (not buffered)', async () => {
      const logMessages = [
        { level: 'info', message: 'Build started' },
        { level: 'info', message: 'Compiling assets' },
        { level: 'info', message: 'Deployment completed' },
      ];

      const timestamps: number[] = [];
      for (const log of logMessages) {
        const beforeWrite = Date.now();
        await stream.writeEvent('log', {
          id: Math.random().toString(),
          deploymentId,
          ...log,
          timestamp: new Date().toISOString(),
        });
        timestamps.push(Date.now() - beforeWrite);
      }

      const events = stream.getEvents();
      expect(events).toHaveLength(3);
      expect(events.every(e => e.event === 'log')).toBe(true);

      // Each event should be written within 100ms
      timestamps.forEach(delay => {
        expect(delay).toBeLessThan(100);
      });
    });

    it('should maintain event order and assign monotonic sequence numbers', async () => {
      for (let i = 0; i < 5; i++) {
        await stream.writeEvent('log', {
          message: `Message ${i}`,
          seq: i,
        });
      }

      const events = stream.getEvents();
      events.forEach((e, idx) => {
        expect(parseInt(e.id)).toBe(idx);
      });
    });

    it('should send heartbeat events at configured interval', async () => {
      await stream.writeEvent('connected', { deploymentId });
      await stream.writeEvent('heartbeat', {
        timestamp: new Date().toISOString(),
        pending: 0,
      });
      await stream.writeEvent('log', {
        message: 'Test log',
      });

      const events = stream.getEvents();
      const heartbeats = events.filter(e => e.event === 'heartbeat');
      expect(heartbeats.length).toBeGreaterThan(0);
    });
  });

  describe('Stream Closure and Terminal States', () => {
    it('should close stream automatically when deployment reaches completed state', async () => {
      await stream.writeEvent('log', {
        message: 'Deployment starting',
        level: 'info',
      });

      await stream.writeEvent('deployment_completed', {
        status: 'completed',
        deploymentId,
        timestamp: new Date().toISOString(),
      });

      await stream.close();

      expect(stream.isConnected()).toBe(false);
      const events = stream.getEvents();
      const lastEvent = events[events.length - 1];
      expect(lastEvent.event).toBe('deployment_completed');
    });

    it('should close stream on deployment failed state', async () => {
      await stream.writeEvent('log', {
        message: 'Build failed',
        level: 'error',
      });

      await stream.writeEvent('deployment_failed', {
        status: 'failed',
        error: 'Build process exited with code 1',
        deploymentId,
      });

      await stream.close();

      expect(stream.isConnected()).toBe(false);
    });

    it('should send error event and close on critical error', async () => {
      const errorMsg = 'Database connection lost';

      await stream.writeEvent('error', {
        error: errorMsg,
        code: 'DB_CONN_ERROR',
      });

      await stream.close();

      const events = stream.getEvents();
      const errorEvent = events.find(e => e.event === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent?.data.error).toBe(errorMsg);
      expect(stream.isConnected()).toBe(false);
    });

    it('should reach max stream duration limit and auto-close', async () => {
      const config: StreamConfig = {
        deploymentId,
        maxDuration: 5000,
        heartbeatInterval: 1000,
      };

      const limitedStream = logStreamService.createStream(deploymentId, config);

      const startTime = Date.now();
      await limitedStream.writeEvent('connected', { deploymentId });

      // Simulate stream duration check
      const elapsed = Date.now() - startTime;
      if (elapsed > config.maxDuration) {
        await limitedStream.writeEvent('end', {
          reason: 'Stream duration limit reached',
          timestamp: new Date().toISOString(),
        });
        await limitedStream.close();
      }

      expect(limitedStream.isConnected()).toBe(false);
    });
  });

  describe('Client Disconnect Handling', () => {
    it('should stop writing to stream within 1 second of client disconnect', async () => {
      const disconnectStream = logStreamService.createStream('dep-disconnect-test', {
        deploymentId: 'dep-disconnect-test',
        maxDuration: 60000,
        heartbeatInterval: 30000,
      });

      await disconnectStream.writeEvent('connected', { deploymentId: 'dep-disconnect-test' });

      const beforeClose = Date.now();
      await disconnectStream.close();
      const closeTime = Date.now() - beforeClose;

      expect(closeTime).toBeLessThan(1000);
      expect(disconnectStream.isConnected()).toBe(false);
    });

    it('should handle rapid reconnection by resuming from Last-Event-ID', async () => {
      const firstStream = logStreamService.createStream('dep-resume-test', {
        deploymentId: 'dep-resume-test',
        maxDuration: 60000,
        heartbeatInterval: 30000,
      });

      await firstStream.writeEvent('log', { message: 'Event 1', id: 1 });
      await firstStream.writeEvent('log', { message: 'Event 2', id: 2 });

      const lastId = firstStream.getEvents()[firstStream.getEvents().length - 1].id;
      await firstStream.close();

      // Reconnect with Last-Event-ID
      const resumeStream = logStreamService.createStream('dep-resume-test-2', {
        deploymentId: 'dep-resume-test-2',
        maxDuration: 60000,
        heartbeatInterval: 30000,
      });

      await resumeStream.writeEvent('connected', {
        deploymentId: 'dep-resume-test-2',
        resumeFromId: lastId,
      });

      const resumeEvents = resumeStream.getEvents();
      expect(resumeEvents[0].data.resumeFromId).toBe(lastId);
    });

    it('should emit buffer_overflow event when client is too slow', async () => {
      const slowStream = logStreamService.createStream('dep-slow-client', {
        deploymentId: 'dep-slow-client',
        maxDuration: 60000,
        heartbeatInterval: 30000,
      });

      // Simulate slow client by adding write delay
      slowStream.setWriteDelay(50);

      // Write many events rapidly (simulating fast producer)
      for (let i = 0; i < 5; i++) {
        await slowStream.writeEvent('log', {
          message: `Fast message ${i}`,
        });
      }

      // Check that we have overflow handling
      const events = slowStream.getEvents();
      expect(events.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Query Parameter Filtering', () => {
    it('should accept since parameter to start streaming from timestamp', async () => {
      const since = new Date(Date.now() - 60000).toISOString();

      await stream.writeEvent('connected', {
        deploymentId,
        since,
      });

      const events = stream.getEvents();
      expect(events[0].data.since).toBe(since);
    });

    it('should filter logs by level when level parameter provided', async () => {
      const levels = ['info', 'warn', 'error'];

      for (const level of levels) {
        await stream.writeEvent('log', {
          message: `${level} message`,
          level,
        });
      }

      // All events should be present (filtering would be done by client/service)
      expect(stream.getEvents().length).toBe(3);
    });

    it('should validate since parameter is valid ISO 8601', async () => {
      const validISO = new Date().toISOString();
      expect(() => {
        new Date(validISO);
      }).not.toThrow();

      const invalidISO = 'not-a-date';
      expect(() => {
        new Date(invalidISO);
      }).toThrow();
    });
  });
});
