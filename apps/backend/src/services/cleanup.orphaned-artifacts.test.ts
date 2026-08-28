/**
 * Unit tests for CleanupService.purgeOrphanedArtifacts (#758)
 *
 * Coverage:
 *   - orphan detection (artifact with no deployments row)
 *   - 24h retention window (recent orphans are kept)
 *   - 100-per-run batch limit
 *   - audit log emission with size and age
 *   - deployment-id derivation from artifact path
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CleanupService, deploymentIdFromArtifactPath } from './cleanup.service';

// ── Mock Supabase client (storage + deployments cross-reference + audit) ───────

const mockList = vi.fn();
const mockRemove = vi.fn();
const mockIn = vi.fn();
const mockAuditInsert = vi.fn();

function buildClient() {
    return {
        storage: {
            from: vi.fn(() => ({
                list: mockList,
                remove: mockRemove,
            })),
        },
        from: vi.fn((table: string) => {
            if (table === 'deployments') {
                return {
                    select: vi.fn(() => ({ in: mockIn })),
                };
            }
            if (table === 'orphaned_artifact_cleanup_log') {
                return { insert: mockAuditInsert };
            }
            throw new Error(`unexpected table ${table}`);
        }),
    };
}

vi.mock('@/lib/supabase/server', () => ({
    createClient: vi.fn(() => buildClient()),
}));

const NOW = new Date('2026-06-26T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

function artifact(name: string, ageHours: number, size = 1024) {
    return { name, created_at: hoursAgo(ageHours), metadata: { size } };
}

describe('CleanupService.purgeOrphanedArtifacts', () => {
    let service: CleanupService;

    beforeEach(() => {
        service = new CleanupService();
        vi.clearAllMocks();
        mockRemove.mockResolvedValue({ error: null });
        mockAuditInsert.mockResolvedValue({ error: null });
        mockIn.mockResolvedValue({ data: [], error: null });
    });

    it('derives the deployment id from both folder and flat artifact paths', () => {
        expect(deploymentIdFromArtifactPath('dep-1/bundle.zip')).toBe('dep-1');
        expect(deploymentIdFromArtifactPath('dep-2.zip')).toBe('dep-2');
        expect(deploymentIdFromArtifactPath('dep-2.tar.gz')).toBe('dep-2');
        expect(deploymentIdFromArtifactPath('dep-2.json.zlib')).toBe('dep-2');
        expect(deploymentIdFromArtifactPath('dep-3')).toBe('dep-3');
    });

    it('deletes an artifact with no corresponding deployments record', async () => {
        mockList.mockResolvedValue({
            data: [artifact('orphan-1/bundle.zip', 48)],
            error: null,
        });
        // No matching deployment rows → orphan.
        mockIn.mockResolvedValue({ data: [], error: null });

        const result = await service.purgeOrphanedArtifacts({ now: NOW });

        expect(result.recordsDeleted).toBe(1);
        expect(mockRemove).toHaveBeenCalledWith(['orphan-1/bundle.zip']);
        expect(result.orphansDeleted[0]).toMatchObject({
            path: 'orphan-1/bundle.zip',
            sizeBytes: 1024,
        });
        expect(result.orphansDeleted[0].ageSeconds).toBe(48 * 3600);
    });

    it('keeps artifacts that DO have a deployments record', async () => {
        mockList.mockResolvedValue({
            data: [artifact('live-1/bundle.zip', 48)],
            error: null,
        });
        mockIn.mockResolvedValue({ data: [{ id: 'live-1' }], error: null });

        const result = await service.purgeOrphanedArtifacts({ now: NOW });

        expect(result.recordsDeleted).toBe(0);
        expect(mockRemove).not.toHaveBeenCalled();
    });

    it('respects the 24h retention window (keeps recent orphans)', async () => {
        mockList.mockResolvedValue({
            data: [
                artifact('recent/bundle.zip', 5), // < 24h → retained
                artifact('old/bundle.zip', 30), // > 24h → deleted
            ],
            error: null,
        });
        mockIn.mockResolvedValue({ data: [], error: null });

        const result = await service.purgeOrphanedArtifacts({ now: NOW });

        expect(result.recordsDeleted).toBe(1);
        expect(result.skippedWithinRetention).toBe(1);
        expect(mockRemove).toHaveBeenCalledWith(['old/bundle.zip']);
    });

    it('treats the retention boundary as exclusive (exactly 24h old is deleted)', async () => {
        mockList.mockResolvedValue({
            data: [artifact('boundary/bundle.zip', 24)],
            error: null,
        });
        mockIn.mockResolvedValue({ data: [], error: null });

        const result = await service.purgeOrphanedArtifacts({ now: NOW });
        expect(result.recordsDeleted).toBe(1);
    });

    it('enforces the 100-per-run batch limit', async () => {
        const many = Array.from({ length: 150 }, (_, i) => artifact(`orphan-${i}/b.zip`, 48));
        mockList.mockResolvedValue({ data: many, error: null });
        mockIn.mockResolvedValue({ data: [], error: null });

        const result = await service.purgeOrphanedArtifacts({ now: NOW });

        expect(result.recordsDeleted).toBe(100);
        expect(result.batchLimitReached).toBe(true);
        expect(mockRemove.mock.calls[0][0]).toHaveLength(100);
    });

    it('emits an audit log entry per deleted orphan with size and age', async () => {
        mockList.mockResolvedValue({
            data: [artifact('orphan-1/b.zip', 48, 2048)],
            error: null,
        });
        mockIn.mockResolvedValue({ data: [], error: null });

        await service.purgeOrphanedArtifacts({ now: NOW });

        expect(mockAuditInsert).toHaveBeenCalledTimes(1);
        const rows = mockAuditInsert.mock.calls[0][0];
        expect(rows[0]).toMatchObject({
            artifact_path: 'orphan-1/b.zip',
            size_bytes: 2048,
            age_seconds: 48 * 3600,
        });
    });

    it('does nothing when the bucket is empty', async () => {
        mockList.mockResolvedValue({ data: [], error: null });

        const result = await service.purgeOrphanedArtifacts({ now: NOW });

        expect(result.recordsDeleted).toBe(0);
        expect(result.scanned).toBe(0);
        expect(mockRemove).not.toHaveBeenCalled();
    });

    it('throws when listing storage fails', async () => {
        mockList.mockResolvedValue({ data: null, error: { message: 'bucket missing' } });

        await expect(service.purgeOrphanedArtifacts({ now: NOW })).rejects.toThrow(
            /Failed to list storage artifacts/,
        );
    });

    it('honours a custom retention window and batch limit', async () => {
        mockList.mockResolvedValue({
            data: [artifact('a/b.zip', 2), artifact('c/d.zip', 2), artifact('e/f.zip', 2)],
            error: null,
        });
        mockIn.mockResolvedValue({ data: [], error: null });

        const result = await service.purgeOrphanedArtifacts({
            now: NOW,
            retentionHours: 1, // all 2h-old orphans are now eligible
            batchLimit: 2,
        });

        expect(result.recordsDeleted).toBe(2);
        expect(result.batchLimitReached).toBe(true);
    });
});
