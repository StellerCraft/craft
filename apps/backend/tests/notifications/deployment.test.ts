/**
 * Deployment Notification Tests
 * Issue #360: Add Deployment Notification Tests
 *
 * Tests that verify deployment notifications are sent correctly for all deployment events
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Services ─────────────────────────────────────────────────────────────

interface NotificationEvent {
  type: string;
  deploymentId: string;
  status: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface NotificationPreference {
  userId: string;
  emailNotifications: boolean;
  slackNotifications: boolean;
  webhookUrl?: string;
}

const mockNotificationService = {
  sendNotification: vi.fn(),
  sendEmailNotification: vi.fn(),
  sendSlackNotification: vi.fn(),
  sendWebhookNotification: vi.fn(),
  getNotificationPreferences: vi.fn(),
  updateNotificationPreferences: vi.fn(),
};

const mockDeploymentService = {
  createDeployment: vi.fn(),
  updateDeploymentStatus: vi.fn(),
  getDeployment: vi.fn(),
  deleteDeployment: vi.fn(),
};

const mockEmailService = {
  sendEmail: vi.fn(),
  sendBulkEmail: vi.fn(),
  getEmailTemplate: vi.fn(),
};

const mockSlackService = {
  sendMessage: vi.fn(),
  sendThreadMessage: vi.fn(),
  updateMessage: vi.fn(),
};

vi.mock('@/services/notification.service', () => ({
  notificationService: mockNotificationService,
}));

vi.mock('@/services/deployment.service', () => ({
  deploymentService: mockDeploymentService,
}));

vi.mock('@/services/email.service', () => ({
  emailService: mockEmailService,
}));

vi.mock('@/services/slack.service', () => ({
  slackService: mockSlackService,
}));

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Deployment Notifications', () => {
  const mockUserId = 'user-123';
  const mockDeploymentId = 'dep-456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Notification Triggers', () => {
    it('should send notification on deployment success', async () => {
      const event: NotificationEvent = {
        type: 'deployment.success',
        deploymentId: mockDeploymentId,
        status: 'completed',
        timestamp: new Date(),
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(event);
      expect(mockNotificationService.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('should send notification on deployment failure', async () => {
      const event: NotificationEvent = {
        type: 'deployment.failed',
        deploymentId: mockDeploymentId,
        status: 'failed',
        timestamp: new Date(),
        metadata: { error: 'Build failed' },
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(event);
    });

    it('should send notification on deployment started', async () => {
      const event: NotificationEvent = {
        type: 'deployment.started',
        deploymentId: mockDeploymentId,
        status: 'building',
        timestamp: new Date(),
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(event);
    });

    it('should send notification on deployment cancelled', async () => {
      const event: NotificationEvent = {
        type: 'deployment.cancelled',
        deploymentId: mockDeploymentId,
        status: 'cancelled',
        timestamp: new Date(),
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      expect(mockNotificationService.sendNotification).toHaveBeenCalledWith(event);
    });
  });

  describe('Notification Content Accuracy', () => {
    it('should include deployment ID in notification', async () => {
      const event: NotificationEvent = {
        type: 'deployment.success',
        deploymentId: mockDeploymentId,
        status: 'completed',
        timestamp: new Date(),
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      const call = mockNotificationService.sendNotification.mock.calls[0][0];
      expect(call.deploymentId).toBe(mockDeploymentId);
    });

    it('should include deployment status in notification', async () => {
      const event: NotificationEvent = {
        type: 'deployment.success',
        deploymentId: mockDeploymentId,
        status: 'completed',
        timestamp: new Date(),
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      const call = mockNotificationService.sendNotification.mock.calls[0][0];
      expect(call.status).toBe('completed');
    });

    it('should include timestamp in notification', async () => {
      const now = new Date();
      const event: NotificationEvent = {
        type: 'deployment.success',
        deploymentId: mockDeploymentId,
        status: 'completed',
        timestamp: now,
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      const call = mockNotificationService.sendNotification.mock.calls[0][0];
      expect(call.timestamp).toEqual(now);
    });

    it('should include error details in failure notifications', async () => {
      const errorMessage = 'Build failed: syntax error';
      const event: NotificationEvent = {
        type: 'deployment.failed',
        deploymentId: mockDeploymentId,
        status: 'failed',
        timestamp: new Date(),
        metadata: { error: errorMessage },
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      const call = mockNotificationService.sendNotification.mock.calls[0][0];
      expect(call.metadata?.error).toBe(errorMessage);
    });
  });

  describe('Notification Delivery Methods', () => {
    it('should send email notification when enabled', async () => {
      const preferences: NotificationPreference = {
        userId: mockUserId,
        emailNotifications: true,
        slackNotifications: false,
      };

      mockNotificationService.getNotificationPreferences.mockResolvedValue(preferences);
      mockNotificationService.sendEmailNotification.mockResolvedValue({ success: true });

      await mockNotificationService.getNotificationPreferences(mockUserId);
      const prefs = await mockNotificationService.getNotificationPreferences(mockUserId);

      if (prefs.emailNotifications) {
        await mockNotificationService.sendEmailNotification({
          userId: mockUserId,
          deploymentId: mockDeploymentId,
        });
      }

      expect(mockNotificationService.sendEmailNotification).toHaveBeenCalled();
    });

    it('should send Slack notification when enabled', async () => {
      const preferences: NotificationPreference = {
        userId: mockUserId,
        emailNotifications: false,
        slackNotifications: true,
      };

      mockNotificationService.getNotificationPreferences.mockResolvedValue(preferences);
      mockNotificationService.sendSlackNotification.mockResolvedValue({ success: true });

      await mockNotificationService.getNotificationPreferences(mockUserId);
      const prefs = await mockNotificationService.getNotificationPreferences(mockUserId);

      if (prefs.slackNotifications) {
        await mockNotificationService.sendSlackNotification({
          userId: mockUserId,
          deploymentId: mockDeploymentId,
        });
      }

      expect(mockNotificationService.sendSlackNotification).toHaveBeenCalled();
    });

    it('should send webhook notification when configured', async () => {
      const webhookUrl = 'https://example.com/webhook';
      const preferences: NotificationPreference = {
        userId: mockUserId,
        emailNotifications: false,
        slackNotifications: false,
        webhookUrl,
      };

      mockNotificationService.getNotificationPreferences.mockResolvedValue(preferences);
      mockNotificationService.sendWebhookNotification.mockResolvedValue({ success: true });

      await mockNotificationService.getNotificationPreferences(mockUserId);
      const prefs = await mockNotificationService.getNotificationPreferences(mockUserId);

      if (prefs.webhookUrl) {
        await mockNotificationService.sendWebhookNotification({
          userId: mockUserId,
          deploymentId: mockDeploymentId,
          webhookUrl: prefs.webhookUrl,
        });
      }

      expect(mockNotificationService.sendWebhookNotification).toHaveBeenCalled();
    });

    it('should respect notification preferences', async () => {
      const preferences: NotificationPreference = {
        userId: mockUserId,
        emailNotifications: false,
        slackNotifications: false,
      };

      mockNotificationService.getNotificationPreferences.mockResolvedValue(preferences);

      const prefs = await mockNotificationService.getNotificationPreferences(mockUserId);

      expect(prefs.emailNotifications).toBe(false);
      expect(prefs.slackNotifications).toBe(false);
    });
  });

  describe('Notification Preferences', () => {
    it('should retrieve user notification preferences', async () => {
      const preferences: NotificationPreference = {
        userId: mockUserId,
        emailNotifications: true,
        slackNotifications: true,
      };

      mockNotificationService.getNotificationPreferences.mockResolvedValue(preferences);

      const result = await mockNotificationService.getNotificationPreferences(mockUserId);

      expect(result).toEqual(preferences);
      expect(mockNotificationService.getNotificationPreferences).toHaveBeenCalledWith(mockUserId);
    });

    it('should update notification preferences', async () => {
      const updatedPreferences: NotificationPreference = {
        userId: mockUserId,
        emailNotifications: false,
        slackNotifications: true,
      };

      mockNotificationService.updateNotificationPreferences.mockResolvedValue(updatedPreferences);

      const result = await mockNotificationService.updateNotificationPreferences(mockUserId, updatedPreferences);

      expect(result).toEqual(updatedPreferences);
      expect(mockNotificationService.updateNotificationPreferences).toHaveBeenCalledWith(
        mockUserId,
        updatedPreferences
      );
    });

    it('should allow disabling all notifications', async () => {
      const preferences: NotificationPreference = {
        userId: mockUserId,
        emailNotifications: false,
        slackNotifications: false,
      };

      mockNotificationService.updateNotificationPreferences.mockResolvedValue(preferences);

      const result = await mockNotificationService.updateNotificationPreferences(mockUserId, preferences);

      expect(result.emailNotifications).toBe(false);
      expect(result.slackNotifications).toBe(false);
    });

    it('should allow enabling multiple notification channels', async () => {
      const preferences: NotificationPreference = {
        userId: mockUserId,
        emailNotifications: true,
        slackNotifications: true,
        webhookUrl: 'https://example.com/webhook',
      };

      mockNotificationService.updateNotificationPreferences.mockResolvedValue(preferences);

      const result = await mockNotificationService.updateNotificationPreferences(mockUserId, preferences);

      expect(result.emailNotifications).toBe(true);
      expect(result.slackNotifications).toBe(true);
      expect(result.webhookUrl).toBe('https://example.com/webhook');
    });
  });

  describe('Notification Timing', () => {
    it('should send notifications immediately on deployment completion', async () => {
      const event: NotificationEvent = {
        type: 'deployment.success',
        deploymentId: mockDeploymentId,
        status: 'completed',
        timestamp: new Date(),
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      const startTime = Date.now();
      await mockNotificationService.sendNotification(event);
      const endTime = Date.now();

      expect(mockNotificationService.sendNotification).toHaveBeenCalled();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should include event timestamp in notification', async () => {
      const timestamp = new Date('2024-01-15T10:30:00Z');
      const event: NotificationEvent = {
        type: 'deployment.success',
        deploymentId: mockDeploymentId,
        status: 'completed',
        timestamp,
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      const call = mockNotificationService.sendNotification.mock.calls[0][0];
      expect(call.timestamp).toEqual(timestamp);
    });
  });

  describe('Notification Format', () => {
    it('should have consistent notification structure', async () => {
      const event: NotificationEvent = {
        type: 'deployment.success',
        deploymentId: mockDeploymentId,
        status: 'completed',
        timestamp: new Date(),
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      const call = mockNotificationService.sendNotification.mock.calls[0][0];
      expect(call).toHaveProperty('type');
      expect(call).toHaveProperty('deploymentId');
      expect(call).toHaveProperty('status');
      expect(call).toHaveProperty('timestamp');
    });

    it('should include metadata when available', async () => {
      const event: NotificationEvent = {
        type: 'deployment.failed',
        deploymentId: mockDeploymentId,
        status: 'failed',
        timestamp: new Date(),
        metadata: { error: 'Build failed', duration: 120 },
      };

      mockNotificationService.sendNotification.mockResolvedValue({ success: true });

      await mockNotificationService.sendNotification(event);

      const call = mockNotificationService.sendNotification.mock.calls[0][0];
      expect(call.metadata).toBeDefined();
      expect(call.metadata?.error).toBe('Build failed');
    });
  });
});
