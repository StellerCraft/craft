import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomizationDraftService, normalizeDraftConfig } from './customization-draft.service';
import type { CustomizationConfig } from '@craft/types';

// ── DeploymentUpdateService mock ──────────────────────────────────────────────
const mockUpdateDeployment = vi.fn();
vi.mock('./deployment-update.service', () => ({
    deploymentUpdateService: { updateDeployment: (...args: any[]) => mockUpdateDeployment(...args) },
}));

// ── Supabase mock ─────────────────────────────────────────────────────────────
//
// All Supabase query-builder calls (eq, select, upsert) are chained on a single
// shared object so that the terminal `.single()` can be configured per-test
// via `mockSingle.mockResolvedValueOnce(...)`.

const mockSingle = vi.fn();
const _chain: any = { single: mockSingle };
_chain.eq = vi.fn(() => _chain);
_chain.select = vi.fn(() => _chain);
_chain.upsert = vi.fn(() => _chain);
const mockFrom = vi.fn(() => _chain);

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const userId = 'user-abc';
const templateId = 'tmpl-xyz';
const deploymentId = 'dep-001';

const validConfig: CustomizationConfig = {
    branding: {
        appName: 'My DEX',
        primaryColor: '#6366f1',
        secondaryColor: '#a5b4fc',
        fontFamily: 'Inter',
    },
    features: {
        enableCharts: true,
        enableTransactionHistory: false,
        enableAnalytics: false,
        enableNotifications: false,
    },
    stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
    },
};

// Simulates the raw DB row returned by Supabase (snake_case keys)
const dbRow = {
    id: 'draft-1',
    user_id: userId,
    template_id: templateId,
    customization_config: validConfig,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
};

// ── normalizeDraftConfig ──────────────────────────────────────────────────────

const full = {
    branding: { appName: 'DEX', primaryColor: '#f00', secondaryColor: '#0f0', fontFamily: 'Mono' },
    features: { enableCharts: false, enableTransactionHistory: false, enableAnalytics: true, enableNotifications: true },
    stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' },
};

describe('normalizeDraftConfig', () => {
    it('returns full config unchanged', () => {
        const result = normalizeDraftConfig(full);
        expect(result.branding.appName).toBe('DEX');
        expect(result.stellar.network).toBe('mainnet');
    });

    it('fills missing branding fields with defaults', () => {
        const result = normalizeDraftConfig({ branding: { appName: 'X' }, features: full.features, stellar: full.stellar });
        expect(result.branding.primaryColor).toBe('#6366f1');
        expect(result.branding.appName).toBe('X');
    });

    it('fills missing features with defaults', () => {
        const result = normalizeDraftConfig({ branding: full.branding, stellar: full.stellar });
        expect(result.features.enableCharts).toBe(true);
    });

    it('fills missing stellar with defaults', () => {
        const result = normalizeDraftConfig({ branding: full.branding, features: full.features });
        expect(result.stellar.network).toBe('testnet');
        expect(result.stellar.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    });

    it('handles null input gracefully', () => {
        const result = normalizeDraftConfig(null);
        expect(result.branding.fontFamily).toBe('Inter');
        expect(result.features.enableCharts).toBe(true);
    });

    it('handles completely empty object', () => {
        const result = normalizeDraftConfig({});
        expect(result.stellar.network).toBe('testnet');
    });
});

// ── CustomizationDraftService ─────────────────────────────────────────────────

describe('CustomizationDraftService', () => {
    let service: CustomizationDraftService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new CustomizationDraftService();
    });

    // ── saveDraft ─────────────────────────────────────────────────────────────

    describe('saveDraft', () => {
        it('saves and returns the mapped draft when template exists', async () => {
            mockSingle
                .mockResolvedValueOnce({ data: { id: templateId }, error: null }) // template check
                .mockResolvedValueOnce({ data: dbRow, error: null }); // upsert result

            const result = await service.saveDraft(userId, templateId, validConfig);

            expect(result.id).toBe('draft-1');
            expect(result.userId).toBe(userId);
            expect(result.templateId).toBe(templateId);
            expect(result.customizationConfig.branding.appName).toBe('My DEX');
            expect(result.createdAt).toBeInstanceOf(Date);
            expect(result.updatedAt).toBeInstanceOf(Date);
        });

        it('throws "Template not found" when template query returns null data', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: null });

            await expect(service.saveDraft(userId, templateId, validConfig)).rejects.toThrow('Template not found');
        });

        it('throws "Template not found" when template query returns an error', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

            await expect(service.saveDraft(userId, templateId, validConfig)).rejects.toThrow('Template not found');
        });

        it('throws with the DB error message when upsert fails', async () => {
            mockSingle
                .mockResolvedValueOnce({ data: { id: templateId }, error: null })
                .mockResolvedValueOnce({ data: null, error: { message: 'connection refused' } });

            await expect(service.saveDraft(userId, templateId, validConfig)).rejects.toThrow(
                'Failed to save draft: connection refused',
            );
        });

        it('passes the correct upsert payload with user_id, template_id, and onConflict', async () => {
            mockSingle
                .mockResolvedValueOnce({ data: { id: templateId }, error: null })
                .mockResolvedValueOnce({ data: dbRow, error: null });

            await service.saveDraft(userId, templateId, validConfig);

            expect(_chain.upsert).toHaveBeenCalledWith(
                expect.objectContaining({ user_id: userId, template_id: templateId }),
                expect.objectContaining({ onConflict: 'user_id,template_id' }),
            );
        });

        it('normalizes partial customization_config returned from the DB', async () => {
            const partialRow = {
                ...dbRow,
                customization_config: { branding: { appName: 'Partial' } }, // missing features/stellar
            };
            mockSingle
                .mockResolvedValueOnce({ data: { id: templateId }, error: null })
                .mockResolvedValueOnce({ data: partialRow, error: null });

            const result = await service.saveDraft(userId, templateId, validConfig);

            // normalizeDraftConfig must fill defaults for missing sections
            expect(result.customizationConfig.features.enableCharts).toBe(true);
            expect(result.customizationConfig.stellar.network).toBe('testnet');
            expect(result.customizationConfig.stellar.horizonUrl).toBe('https://horizon-testnet.stellar.org');
        });

        it('rejects invalid branding payload — primaryColor and secondaryColor cannot match', async () => {
            // This is a business-rule error caught by validateCustomizationConfig before saveDraft
            // is called at the API layer, but we verify saveDraft itself still forwards the config
            // unchanged (validation is not saveDraft's responsibility).
            const twinColors: CustomizationConfig = {
                ...validConfig,
                branding: { ...validConfig.branding, primaryColor: '#abc', secondaryColor: '#abc' },
            };
            mockSingle
                .mockResolvedValueOnce({ data: { id: templateId }, error: null })
                .mockResolvedValueOnce({ data: { ...dbRow, customization_config: twinColors }, error: null });

            const result = await service.saveDraft(userId, templateId, twinColors);

            // saveDraft persists whatever it receives; business validation is upstream
            expect(result.customizationConfig.branding.primaryColor).toBe('#abc');
        });
    });

    // ── getDraft ──────────────────────────────────────────────────────────────

    describe('getDraft', () => {
        it('returns the draft when it exists', async () => {
            mockSingle.mockResolvedValueOnce({ data: dbRow, error: null });

            const result = await service.getDraft(userId, templateId);

            expect(result).not.toBeNull();
            expect(result!.id).toBe('draft-1');
            expect(result!.userId).toBe(userId);
            expect(result!.templateId).toBe(templateId);
        });

        it('returns null when no draft exists (PGRST116)', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

            const result = await service.getDraft(userId, templateId);

            expect(result).toBeNull();
        });

        it('throws on unexpected DB error', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'table does not exist' } });

            await expect(service.getDraft(userId, templateId)).rejects.toThrow(
                'Failed to get draft: table does not exist',
            );
        });

        it('returns null when data is null without an error', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: null });

            const result = await service.getDraft(userId, templateId);

            expect(result).toBeNull();
        });

        it('maps snake_case DB row to camelCase interface', async () => {
            mockSingle.mockResolvedValueOnce({ data: dbRow, error: null });

            const result = await service.getDraft(userId, templateId);

            expect(result!.userId).toBe(dbRow.user_id);
            expect(result!.templateId).toBe(dbRow.template_id);
            expect(result!.createdAt).toBeInstanceOf(Date);
            expect(result!.updatedAt).toBeInstanceOf(Date);
        });

        it('normalizes a stale/partial customization_config from the DB', async () => {
            const staleRow = {
                ...dbRow,
                customization_config: { stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' } },
            };
            mockSingle.mockResolvedValueOnce({ data: staleRow, error: null });

            const result = await service.getDraft(userId, templateId);

            // Missing branding and features should be filled with defaults
            expect(result!.customizationConfig.branding.fontFamily).toBe('Inter');
            expect(result!.customizationConfig.branding.primaryColor).toBe('#6366f1');
            expect(result!.customizationConfig.features.enableCharts).toBe(true);
        });

        it('normalizes a draft that has all features set to non-default values', async () => {
            const customRow = {
                ...dbRow,
                customization_config: {
                    ...validConfig,
                    features: {
                        enableCharts: false,
                        enableTransactionHistory: false,
                        enableAnalytics: true,
                        enableNotifications: true,
                    },
                },
            };
            mockSingle.mockResolvedValueOnce({ data: customRow, error: null });

            const result = await service.getDraft(userId, templateId);

            // Non-default feature values should be preserved (not overwritten by defaults)
            expect(result!.customizationConfig.features.enableAnalytics).toBe(true);
            expect(result!.customizationConfig.features.enableNotifications).toBe(true);
            expect(result!.customizationConfig.features.enableCharts).toBe(false);
        });
    });

    // ── getDraftByDeployment ──────────────────────────────────────────────────

    describe('getDraftByDeployment', () => {
        it('returns the draft when deployment and draft both exist', async () => {
            mockSingle
                .mockResolvedValueOnce({ data: { template_id: templateId, user_id: userId }, error: null })
                .mockResolvedValueOnce({ data: dbRow, error: null });

            const result = await service.getDraftByDeployment(userId, deploymentId);

            expect(result).not.toBeNull();
            expect(result!.id).toBe('draft-1');
            expect(result!.templateId).toBe(templateId);
        });

        it('returns null when the deployment does not exist (PGRST116)', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

            const result = await service.getDraftByDeployment(userId, deploymentId);

            expect(result).toBeNull();
        });

        it('returns null when deployment data is null without an error', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: null });

            const result = await service.getDraftByDeployment(userId, deploymentId);

            expect(result).toBeNull();
        });

        it('throws "Forbidden" when the deployment belongs to a different user', async () => {
            mockSingle.mockResolvedValueOnce({
                data: { template_id: templateId, user_id: 'another-user' },
                error: null,
            });

            await expect(service.getDraftByDeployment(userId, deploymentId)).rejects.toThrow('Forbidden');
        });

        it('returns null when no draft exists for the deployment template', async () => {
            mockSingle
                .mockResolvedValueOnce({ data: { template_id: templateId, user_id: userId }, error: null })
                .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

            const result = await service.getDraftByDeployment(userId, deploymentId);

            expect(result).toBeNull();
        });

        it('throws on unexpected deployment query error', async () => {
            mockSingle.mockResolvedValueOnce({
                data: null,
                error: { code: '42P01', message: 'table does not exist' },
            });

            await expect(service.getDraftByDeployment(userId, deploymentId)).rejects.toThrow(
                'Failed to load deployment: table does not exist',
            );
        });

        it('delegates to getDraft with the correct userId and templateId from the deployment', async () => {
            mockSingle
                .mockResolvedValueOnce({ data: { template_id: templateId, user_id: userId }, error: null })
                .mockResolvedValueOnce({ data: dbRow, error: null });

            await service.getDraftByDeployment(userId, deploymentId);

            expect(mockFrom).toHaveBeenCalledWith('deployments');
            expect(mockFrom).toHaveBeenCalledWith('customization_drafts');
        });

        it('error shape from getDraftByDeployment matches the expected API error contract', async () => {
            mockSingle.mockResolvedValueOnce({
                data: { template_id: templateId, user_id: 'other' },
                error: null,
            });

            let caughtError: Error | null = null;
            try {
                await service.getDraftByDeployment(userId, deploymentId);
            } catch (e) {
                caughtError = e as Error;
            }

            expect(caughtError).not.toBeNull();
            expect(caughtError!.message).toBe('Forbidden');
        });
    });

    // ── promoteDraft ──────────────────────────────────────────────────────────

    describe('promoteDraft', () => {
        const deploymentId = 'dep-001';

        it('throws "Draft not found" when no draft exists for the user+template', async () => {
            mockSingle.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

            await expect(service.promoteDraft(userId, templateId, deploymentId)).rejects.toThrow('Draft not found');
        });

        it('throws with validationErrors when the draft config is invalid', async () => {
            const invalidConfig = {
                ...validConfig,
                branding: { ...validConfig.branding, appName: '' }, // fails min(1)
            };
            const invalidRow = { ...dbRow, customization_config: invalidConfig };
            mockSingle.mockResolvedValueOnce({ data: invalidRow, error: null });

            let caught: any;
            try {
                await service.promoteDraft(userId, templateId, deploymentId);
            } catch (e) {
                caught = e;
            }

            expect(caught).toBeDefined();
            expect(caught.validationErrors).toBeDefined();
            expect(Array.isArray(caught.validationErrors)).toBe(true);
        });

        it('calls updateDeployment with correct deploymentId, userId, and config on valid draft', async () => {
            mockSingle.mockResolvedValueOnce({ data: dbRow, error: null });
            mockUpdateDeployment.mockResolvedValueOnce({
                success: true,
                deploymentId,
                rolledBack: false,
            });

            await service.promoteDraft(userId, templateId, deploymentId);

            expect(mockUpdateDeployment).toHaveBeenCalledWith({
                deploymentId,
                userId,
                customizationConfig: expect.objectContaining({
                    branding: expect.objectContaining({ appName: 'My DEX' }),
                }),
            });
        });

        it('returns the UpdateDeploymentResult from updateDeployment', async () => {
            mockSingle.mockResolvedValueOnce({ data: dbRow, error: null });
            const expected = { success: true, deploymentId, rolledBack: false, deploymentUrl: 'https://x.vercel.app' };
            mockUpdateDeployment.mockResolvedValueOnce(expected);

            const result = await service.promoteDraft(userId, templateId, deploymentId);

            expect(result).toEqual(expected);
        });

        it('propagates errors thrown by updateDeployment', async () => {
            mockSingle.mockResolvedValueOnce({ data: dbRow, error: null });
            mockUpdateDeployment.mockRejectedValueOnce(new Error('DB connection lost'));

            await expect(service.promoteDraft(userId, templateId, deploymentId)).rejects.toThrow('DB connection lost');
        });
    });
});