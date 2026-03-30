/**
 * Unit tests for AnalyticsService — page view recording
 * Feature: write-unit-tests-for-analytics-service-page-view-record
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsService } from './analytics.service';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsertChain(result: { error: any } = { error: null }) {
    const chain = { insert: mockInsert };
    mockInsert.mockResolvedValue(result);
    mockFrom.mockReturnValue(chain);
    return chain;
}

describe('AnalyticsService — recordPageView', () => {
    let service: AnalyticsService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AnalyticsService();
    });

    it('inserts a page_view record for a valid deployment ID', async () => {
        makeInsertChain();

        await service.recordPageView('deploy-123');

        expect(mockFrom).toHaveBeenCalledWith('deployment_analytics');
        expect(mockInsert).toHaveBeenCalledWith({
            deployment_id: 'deploy-123',
            metric_type: 'page_view',
            metric_value: 1,
        });
    });

    it('records multiple page views independently', async () => {
        makeInsertChain();

        await service.recordPageView('deploy-abc');
        await service.recordPageView('deploy-abc');
        await service.recordPageView('deploy-abc');

        expect(mockInsert).toHaveBeenCalledTimes(3);
        expect(mockInsert).toHaveBeenNthCalledWith(1, expect.objectContaining({ deployment_id: 'deploy-abc' }));
        expect(mockInsert).toHaveBeenNthCalledWith(2, expect.objectContaining({ deployment_id: 'deploy-abc' }));
        expect(mockInsert).toHaveBeenNthCalledWith(3, expect.objectContaining({ deployment_id: 'deploy-abc' }));
    });

    it('records page views for different deployment IDs separately', async () => {
        makeInsertChain();

        await service.recordPageView('deploy-1');
        await service.recordPageView('deploy-2');

        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ deployment_id: 'deploy-1' }));
        expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ deployment_id: 'deploy-2' }));
    });

    it('always inserts metric_value of 1 per page view', async () => {
        makeInsertChain();

        await service.recordPageView('deploy-xyz');

        expect(mockInsert).toHaveBeenCalledWith(
            expect.objectContaining({ metric_type: 'page_view', metric_value: 1 })
        );
    });

    it('does not throw when supabase returns an error (fire-and-forget)', async () => {
        makeInsertChain({ error: { message: 'insert failed' } });

        // recordPageView does not throw on insert error — it is fire-and-forget
        await expect(service.recordPageView('deploy-bad')).resolves.toBeUndefined();
    });

    it('does not throw for an invalid (empty string) deployment ID', async () => {
        makeInsertChain();

        await expect(service.recordPageView('')).resolves.toBeUndefined();
        expect(mockInsert).toHaveBeenCalledWith(
            expect.objectContaining({ deployment_id: '' })
        );
    });
});
