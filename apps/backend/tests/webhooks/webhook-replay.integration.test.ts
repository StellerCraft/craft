// @vitest-environment node
/**
 * Webhook Delivery Replay Integration Tests (#1069)
 *
 * Verifies that replaying a delivery actually re-triggers downstream
 * event processing and transitions status to processed/failed rather
 * than leaving the delivery stuck at 'received'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookDeliveryService } from '@/services/webhook-delivery.service';

const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(() => ({
        rpc: mockRpc,
        from: mockFrom,
    })),
}));

describe('Webhook Delivery Replay Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockFrom.mockReturnValue({
            select: mockSelect,
            insert: mockInsert,
            update: mockUpdate,
        });

        mockSelect.mockReturnValue({
            eq: mockEq,
        });

        mockInsert.mockReturnValue({
            select: mockSelect,
        });

        mockUpdate.mockReturnValue({
            eq: mockEq,
        });

        mockEq.mockReturnValue({
            single: mockSingle,
            select: mockSelect,
        });

        mockSingle.mockResolvedValue({
            data: null,
            error: null,
        });

        mockRpc.mockResolvedValue({ data: null, error: null });
    });

    it('replays delivery and invokes registered processor, transitioning status to processed', async () => {
        const service = new WebhookDeliveryService();

        const originalDelivery = {
            id: 'uuid-1',
            delivery_id: 'del-orig-1',
            event_type: 'push',
            payload: { ref: 'refs/heads/main' },
            headers: { 'x-github-event': 'push' },
            status: 'failed',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        const replayedDeliveryRow = {
            id: 'uuid-2',
            delivery_id: 'replay-12345-abc',
            event_type: 'push',
            payload: { ref: 'refs/heads/main' },
            headers: { 'x-github-event': 'push' },
            status: 'received',
            replayed_from_delivery_id: 'del-orig-1',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        mockFrom.mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                        data: originalDelivery,
                        error: null,
                    }),
                }),
            }),
        });

        mockFrom.mockReturnValueOnce({
            insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                        data: replayedDeliveryRow,
                        error: null,
                    }),
                }),
            }),
        });

        const processorMock = vi.fn().mockResolvedValue(undefined);
        service.registerProcessor(processorMock);

        const result = await service.replayDelivery('del-orig-1');

        expect(result.success).toBe(true);
        expect(result.newDeliveryId).toBe('replay-12345-abc');
        expect(processorMock).toHaveBeenCalledOnce();
        expect(processorMock).toHaveBeenCalledWith(
            expect.objectContaining({
                deliveryId: 'replay-12345-abc',
                eventType: 'push',
                payload: { ref: 'refs/heads/main' },
            })
        );
        expect(mockRpc).toHaveBeenCalledWith('mark_delivery_processed', {
            p_delivery_id: 'replay-12345-abc',
        });
    });

    it('marks delivery as failed when registered processor throws an error', async () => {
        const service = new WebhookDeliveryService();

        const originalDelivery = {
            id: 'uuid-1',
            delivery_id: 'del-orig-2',
            event_type: 'push',
            payload: { ref: 'refs/heads/main' },
            headers: { 'x-github-event': 'push' },
            status: 'failed',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        const replayedDeliveryRow = {
            id: 'uuid-3',
            delivery_id: 'replay-67890-xyz',
            event_type: 'push',
            payload: { ref: 'refs/heads/main' },
            headers: { 'x-github-event': 'push' },
            status: 'received',
            replayed_from_delivery_id: 'del-orig-2',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        mockFrom.mockReturnValueOnce({
            select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                        data: originalDelivery,
                        error: null,
                    }),
                }),
            }),
        });

        mockFrom.mockReturnValueOnce({
            insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                        data: replayedDeliveryRow,
                        error: null,
                    }),
                }),
            }),
        });

        const processorMock = vi.fn().mockRejectedValue(new Error('Downstream processing failed'));
        service.registerProcessor(processorMock);

        const result = await service.replayDelivery('del-orig-2');

        expect(result.success).toBe(true);
        expect(processorMock).toHaveBeenCalledOnce();
        expect(mockRpc).toHaveBeenCalledWith('mark_delivery_failed', {
            p_delivery_id: 'replay-67890-xyz',
            p_error_message: 'Downstream processing failed',
        });
    });
});
