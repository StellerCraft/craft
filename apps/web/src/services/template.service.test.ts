import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService } from './template.service';

// --- Supabase mock ---
const mockSingle = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom }),
}));

// Chainable query builder — every method returns `this` so the service can
// reassign `query` freely. Set the resolved value via `q.mockResolve(val)`.
const makeQuery = (overrides: Record<string, any> = {}) => {
    let resolvedValue: any = { data: [], error: null };
    const q: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        single: mockSingle,
        // Make the query itself awaitable
        then: (resolve: any, reject: any) =>
            Promise.resolve(resolvedValue).then(resolve, reject),
        mockResolve: (val: any) => { resolvedValue = val; return q; },
        ...overrides,
    };
    return q;
};

const dbTemplate = (overrides: Record<string, any> = {}) => ({
    id: 'tpl-1',
    name: 'Stellar DEX',
    description: 'A DEX template',
    category: 'dex',
    is_active: true,
    base_repository_url: 'https://github.com/org/stellar-dex',
    preview_image_url: 'https://example.com/thumb.jpg',
    customization_schema: {
        features: {
            enableCharts: { type: 'boolean', default: true },
            enableAnalytics: { type: 'boolean', default: false },
        },
    },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    ...overrides,
});

describe('TemplateService', () => {
    let service: TemplateService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new TemplateService();
    });

    // ── listTemplates ──────────────────────────────────────────────────────────

    describe('listTemplates', () => {
        it('returns mapped templates when no filters are applied', async () => {
            const query = makeQuery().mockResolve({ data: [dbTemplate()], error: null });
            mockFrom.mockReturnValue(query);

            const results = await service.listTemplates();

            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('tpl-1');
            expect(results[0].blockchainType).toBe('stellar');
            expect(query.eq).toHaveBeenCalledWith('is_active', true);
        });

        it('applies category filter', async () => {
            const query = makeQuery().mockResolve({ data: [], error: null });
            mockFrom.mockReturnValue(query);

            await service.listTemplates({ category: 'dex' });

            expect(query.eq).toHaveBeenCalledWith('category', 'dex');
        });

        it('applies blockchainType filter', async () => {
            const query = makeQuery().mockResolve({ data: [], error: null });
            mockFrom.mockReturnValue(query);

            await service.listTemplates({ blockchainType: 'stellar' });

            expect(query.eq).toHaveBeenCalledWith('blockchain_type', 'stellar');
        });

        it('applies search filter using ilike on name and description', async () => {
            const query = makeQuery().mockResolve({ data: [], error: null });
            mockFrom.mockReturnValue(query);

            await service.listTemplates({ search: 'dex' });

            expect(query.or).toHaveBeenCalledWith(
                'name.ilike.%dex%,description.ilike.%dex%'
            );
        });

        it('returns empty array when no templates match', async () => {
            const query = makeQuery().mockResolve({ data: null, error: null });
            mockFrom.mockReturnValue(query);

            const results = await service.listTemplates();
            expect(results).toEqual([]);
        });

        it('throws when supabase returns an error', async () => {
            const query = makeQuery().mockResolve({ data: null, error: { message: 'DB error' } });
            mockFrom.mockReturnValue(query);

            await expect(service.listTemplates()).rejects.toThrow('Failed to list templates: DB error');
        });
    });

    // ── getTemplate ────────────────────────────────────────────────────────────

    describe('getTemplate', () => {
        it('returns a mapped template for a valid ID', async () => {
            const query = makeQuery();
            mockFrom.mockReturnValue(query);
            mockSingle.mockResolvedValue({ data: dbTemplate(), error: null });

            const result = await service.getTemplate('tpl-1');

            expect(result.id).toBe('tpl-1');
            expect(result.name).toBe('Stellar DEX');
            expect(result.features).toHaveLength(2);
        });

        it('maps features correctly from customization schema', async () => {
            const query = makeQuery();
            mockFrom.mockReturnValue(query);
            mockSingle.mockResolvedValue({ data: dbTemplate(), error: null });

            const result = await service.getTemplate('tpl-1');
            const charts = result.features.find((f) => f.id === 'enableCharts');
            const analytics = result.features.find((f) => f.id === 'enableAnalytics');

            expect(charts?.enabled).toBe(true);
            expect(analytics?.enabled).toBe(false);
        });

        it('handles template with no features in schema', async () => {
            const query = makeQuery();
            mockFrom.mockReturnValue(query);
            mockSingle.mockResolvedValue({
                data: dbTemplate({ customization_schema: {} }),
                error: null,
            });

            const result = await service.getTemplate('tpl-1');
            expect(result.features).toEqual([]);
        });

        it('throws when template is not found (supabase error)', async () => {
            const query = makeQuery();
            mockFrom.mockReturnValue(query);
            mockSingle.mockResolvedValue({ data: null, error: { message: 'No rows' } });

            await expect(service.getTemplate('missing')).rejects.toThrow('Failed to get template');
        });

        it('throws when data is null with no error', async () => {
            const query = makeQuery();
            mockFrom.mockReturnValue(query);
            mockSingle.mockResolvedValue({ data: null, error: null });

            await expect(service.getTemplate('missing')).rejects.toThrow('Template not found');
        });
    });

    // ── getTemplateMetadata ────────────────────────────────────────────────────

    describe('getTemplateMetadata', () => {
        const dbMeta = {
            id: 'tpl-1',
            name: 'Stellar DEX',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-06-01T00:00:00Z',
        };

        it('returns metadata with deployment count', async () => {
            let callCount = 0;
            mockFrom.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // templates query
                    return makeQuery({ single: vi.fn().mockResolvedValue({ data: dbMeta, error: null }) });
                }
                // deployments count query
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ count: 7, error: null }),
                };
            });

            const meta = await service.getTemplateMetadata('tpl-1');

            expect(meta.id).toBe('tpl-1');
            expect(meta.name).toBe('Stellar DEX');
            expect(meta.version).toBe('1.0.0');
            expect(meta.totalDeployments).toBe(7);
            expect(meta.lastUpdated).toEqual(new Date('2024-06-01T00:00:00Z'));
        });

        it('returns 0 deployments when count is null', async () => {
            let callCount = 0;
            mockFrom.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return makeQuery({ single: vi.fn().mockResolvedValue({ data: dbMeta, error: null }) });
                }
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ count: null, error: null }),
                };
            });

            const meta = await service.getTemplateMetadata('tpl-1');
            expect(meta.totalDeployments).toBe(0);
        });

        it('throws when template is not found', async () => {
            mockFrom.mockReturnValue(
                makeQuery({ single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) })
            );

            await expect(service.getTemplateMetadata('missing')).rejects.toThrow('Template not found');
        });
    });
});
