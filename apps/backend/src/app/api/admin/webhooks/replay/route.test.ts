import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PUT } from './route';

const mockWebhookDeliveryService = {
    getDeliveriesForReplay: vi.fn(),
    replayDelivery: vi.fn(),
};

const mockGithubDeliveryFetcherService = {
    detectMissedDeliveries: vi.fn(),
};

vi.mock('@/services/webhook-delivery.service', () => ({
    webhookDeliveryService: mockWebhookDeliveryService,
}));

vi.mock('@/services/github-delivery-fetcher.service', () => ({
    githubDeliveryFetcherService: mockGithubDeliveryFetcherService,
}));

const mockAuth = (handler: Function) => handler;
vi.mock('@/lib/github/github-webhook', () => ({
    withGitHubWebhookAuth: (handler: Function) => handler,
}));

function makeRequest(method: 'GET' | 'POST' | 'PUT', body?: any) {
    return new NextRequest('http://localhost/api/admin/webhooks/replay', {
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: body ? { 'content-type': 'application/json' } : undefined,
    });
}

describe('Webhook Replay Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('GET /api/admin/webhooks/replay', () => {
        it('lists deliveries for replay', async () => {
            const mockDeliveries = [
                { deliveryId: 'delivery-1', source: 'failed' },
                { deliveryId: 'delivery-2', source: 'missed' },
            ];

            mockWebhookDeliveryService.getDeliveriesForReplay.mockResolvedValue({
                success: true,
                deliveries: mockDeliveries,
            });

            const res = await GET(makeRequest('GET'));
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.count).toBe(2);
            expect(body.deliveries).toHaveLength(2);
            expect(res.headers.get('x-correlation-id')).toBeTruthy();
        });

        it('filters deliveries by type', async () => {
            const mockDeliveries = [
                { deliveryId: 'delivery-1', source: 'failed' },
                { deliveryId: 'delivery-2', source: 'missed' },
            ];

            mockWebhookDeliveryService.getDeliveriesForReplay.mockResolvedValue({
                success: true,
                deliveries: mockDeliveries,
            });

            const req = new NextRequest('http://localhost/api/admin/webhooks/replay?type=failed');
            const res = await GET(req);
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.count).toBe(1);
            expect(body.deliveries[0].source).toBe('failed');
        });

        it('returns 500 on service error', async () => {
            mockWebhookDeliveryService.getDeliveriesForReplay.mockResolvedValue({
                success: false,
                error: 'Database error',
            });

            const res = await GET(makeRequest('GET'));
            expect(res.status).toBe(500);

            const body = await res.json();
            expect(body.error).toBe('Database error');
        });
    });

    describe('POST /api/admin/webhooks/replay', () => {
        it('replays a single delivery', async () => {
            mockWebhookDeliveryService.replayDelivery.mockResolvedValue({
                success: true,
                newDeliveryId: 'new-delivery-1',
            });

            const res = await POST(makeRequest('POST', { deliveryId: 'delivery-1' }));
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.replayed).toBe(1);
            expect(body.newDeliveryId).toBe('new-delivery-1');
            expect(mockWebhookDeliveryService.replayDelivery).toHaveBeenCalledWith('delivery-1');
        });

        it('replays all deliveries when replayAll is true', async () => {
            const mockDeliveries = [
                { deliveryId: 'delivery-1', source: 'failed' },
                { deliveryId: 'delivery-2', source: 'failed' },
            ];

            mockWebhookDeliveryService.getDeliveriesForReplay.mockResolvedValue({
                success: true,
                deliveries: mockDeliveries,
            });

            mockWebhookDeliveryService.replayDelivery
                .mockResolvedValueOnce({ success: true, newDeliveryId: 'new-1' })
                .mockResolvedValueOnce({ success: true, newDeliveryId: 'new-2' });

            const res = await POST(makeRequest('POST', { replayAll: true }));
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.replayed).toBe(2);
            expect(body.total).toBe(2);
            expect(mockWebhookDeliveryService.replayDelivery).toHaveBeenCalledTimes(2);
        });

        it('returns error when both deliveryId and replayAll are specified', async () => {
            const res = await POST(makeRequest('POST', { deliveryId: 'delivery-1', replayAll: true }));
            expect(res.status).toBe(400);

            const body = await res.json();
            expect(body.error).toContain('Cannot specify both');
        });

        it('returns error when neither deliveryId nor replayAll are specified', async () => {
            const res = await POST(makeRequest('POST', {}));
            expect(res.status).toBe(400);

            const body = await res.json();
            expect(body.error).toContain('Either deliveryId or replayAll');
        });

        it('handles partial failures in bulk replay', async () => {
            const mockDeliveries = [
                { deliveryId: 'delivery-1', source: 'failed' },
                { deliveryId: 'delivery-2', source: 'failed' },
            ];

            mockWebhookDeliveryService.getDeliveriesForReplay.mockResolvedValue({
                success: true,
                deliveries: mockDeliveries,
            });

            mockWebhookDeliveryService.replayDelivery
                .mockResolvedValueOnce({ success: true, newDeliveryId: 'new-1' })
                .mockResolvedValueOnce({ success: false, error: 'Delivery not found' });

            const res = await POST(makeRequest('POST', { replayAll: true }));
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.replayed).toBe(1);
            expect(body.errors).toHaveLength(1);
            expect(body.errors[0].error).toBe('Delivery not found');
        });
    });

    describe('PUT /api/admin/webhooks/detect-missed', () => {
        it('detects missed deliveries', async () => {
            mockGithubDeliveryFetcherService.detectMissedDeliveries.mockResolvedValue({
                success: true,
                missedCount: 5,
            });

            const res = await PUT(makeRequest('PUT', { hookId: 12345 }));
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.missedCount).toBe(5);
            expect(res.headers.get('x-correlation-id')).toBeTruthy();
        });

        it('returns error when hookId is missing', async () => {
            const res = await PUT(makeRequest('PUT', {}));
            expect(res.status).toBe(400);

            const body = await res.json();
            expect(body.error).toContain('hookId');
        });

        it('detects missed deliveries with custom lookback hours', async () => {
            mockGithubDeliveryFetcherService.detectMissedDeliveries.mockResolvedValue({
                success: true,
                missedCount: 3,
            });

            const res = await PUT(makeRequest('PUT', { hookId: 12345, lookbackHours: 72 }));
            expect(res.status).toBe(200);

            expect(mockGithubDeliveryFetcherService.detectMissedDeliveries).toHaveBeenCalledWith(12345, 72);
        });

        it('returns 500 on detection error', async () => {
            mockGithubDeliveryFetcherService.detectMissedDeliveries.mockResolvedValue({
                success: false,
                error: 'GitHub API rate limit exceeded',
            });

            const res = await PUT(makeRequest('PUT', { hookId: 12345 }));
            expect(res.status).toBe(500);

            const body = await res.json();
            expect(body.error).toContain('GitHub API');
        });
    });
});
