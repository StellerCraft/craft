/**
 * Tests for TemplateService
 *
 * Covers:
 *   - listTemplates: category, blockchainType, legacy ilike search, ordering
 *   - searchTemplates: keyword match, phrase search, prefix search,
 *                      category + text combination, empty query, error handling
 *   - listTemplates with `q` filter: delegates to searchTemplates
 *   - getTemplate: happy path, missing template, errors
 *   - getTemplateMetadata: deployment count, missing template
 *   - mapDatabaseToTemplate: tags field, features extraction
 *
 * Branch: feat/template-full-text-search-index
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService } from './template.service';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockSingle = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
    createClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

// Chainable query builder
const makeQuery = (overrides: Record<string, any> = {}) => {
    let resolvedValue: any = { data: [], error: null };
    const q: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        single: mockSingle,
        then: (resolve: any, reject: any) =>
            Promise.resolve(resolvedValue).then(resolve, reject),
        mockResolve: (val: any) => { resolvedValue = val; return q; },
        ...overrides,
    };
    return q;
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const dbTemplate = (overrides: Record<string, any> = {}) => ({
    id: 'tpl-1',
    name: 'Stellar DEX',
    description: 'A decentralized exchange for trading Stellar assets.',
    category: 'dex',
    is_active: true,
    base_repository_url: 'https://github.com/org/stellar-dex',
    preview_image_url: 'https://example.com/thumb.jpg',
    tags: ['dex', 'trading', 'stellar', 'assets'],
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

    // ── searchTemplates ────────────────────────────────────────────────────────

    describe('searchTemplates', () => {
        it('calls the search_templates RPC with the query and returns mapped results', async () => {
            mockRpc.mockResolvedValue({ data: [dbTemplate()], error: null });

            const results = await service.searchTemplates('stellar exchange');

            expect(mockRpc).toHaveBeenCalledWith('search_templates', {
                p_query:    'stellar exchange',
                p_category: null,
                p_limit:    20,
                p_offset:   0,
            });
            expect(results).toHaveLength(1);
            expect(results[0].id).toBe('tpl-1');
            expect(results[0].name).toBe('Stellar DEX');
        });

        it('maps tags from the database row', async () => {
            mockRpc.mockResolvedValue({
                data: [dbTemplate({ tags: ['dex', 'trading', 'stellar'] })],
                error: null,
            });

            const [result] = await service.searchTemplates('stellar');

            expect(result.tags).toEqual(['dex', 'trading', 'stellar']);
        });

        it('defaults tags to [] when the DB row has no tags column', async () => {
            const rowWithoutTags = dbTemplate();
            delete rowWithoutTags.tags;
            mockRpc.mockResolvedValue({ data: [rowWithoutTags], error: null });

            const [result] = await service.searchTemplates('dex');

            expect(result.tags).toEqual([]);
        });

        it('passes category to the RPC for combined text + category filter', async () => {
            mockRpc.mockResolvedValue({ data: [], error: null });

            await service.searchTemplates('soroban', 'lending');

            expect(mockRpc).toHaveBeenCalledWith('search_templates', expect.objectContaining({
                p_query:    'soroban',
                p_category: 'lending',
            }));
        });

        it('uses null for p_category when no category provided', async () => {
            mockRpc.mockResolvedValue({ data: [], error: null });

            await service.searchTemplates('payment');

            expect(mockRpc).toHaveBeenCalledWith('search_templates', expect.objectContaining({
                p_category: null,
            }));
        });

        it('passes custom limit and offset to the RPC', async () => {
            mockRpc.mockResolvedValue({ data: [], error: null });

            await service.searchTemplates('dex', undefined, 5, 10);

            expect(mockRpc).toHaveBeenCalledWith('search_templates', expect.objectContaining({
                p_limit:  5,
                p_offset: 10,
            }));
        });

        it('returns empty array when RPC returns null data', async () => {
            mockRpc.mockResolvedValue({ data: null, error: null });

            const results = await service.searchTemplates('nothing');

            expect(results).toEqual([]);
        });

        it('throws when the RPC returns an error', async () => {
            mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC error' } });

            await expect(service.searchTemplates('dex')).rejects.toThrow(
                'Failed to search templates: RPC error'
            );
        });

        it('maps multiple search results in order', async () => {
            mockRpc.mockResolvedValue({
                data: [
                    dbTemplate({ id: 'tpl-1', name: 'Stellar DEX' }),
                    dbTemplate({ id: 'tpl-2', name: 'Soroban DeFi', category: 'lending' }),
                ],
                error: null,
            });

            const results = await service.searchTemplates('stellar defi');

            expect(results).toHaveLength(2);
            expect(results[0].id).toBe('tpl-1');
            expect(results[1].id).toBe('tpl-2');
        });

        // ── Phrase search ──────────────────────────────────────────────────────

        it('passes quoted phrase queries as-is to the RPC (server handles phraseto_tsquery)', async () => {
            mockRpc.mockResolvedValue({ data: [dbTemplate()], error: null });

            await service.searchTemplates('"liquidity pool"');

            expect(mockRpc).toHaveBeenCalledWith('search_templates', expect.objectContaining({
                p_query: '"liquidity pool"',
            }));
        });

        it('passes prefix queries as-is to the RPC (server handles prefix:*)', async () => {
            mockRpc.mockResolvedValue({ data: [dbTemplate()], error: null });

            await service.searchTemplates('decentral:*');

            expect(mockRpc).toHaveBeenCalledWith('search_templates', expect.objectContaining({
                p_query: 'decentral:*',
            }));
        });

        // ── Category + text combination ────────────────────────────────────────

        it('handles all valid category values with text search', async () => {
            const categories = ['dex', 'lending', 'payment', 'asset-issuance'] as const;

            for (const cat of categories) {
                vi.clearAllMocks();
                mockRpc.mockResolvedValue({ data: [], error: null });

                await service.searchTemplates('stellar', cat);

                expect(mockRpc).toHaveBeenCalledWith('search_templates', expect.objectContaining({
                    p_query:    'stellar',
                    p_category: cat,
                }));
            }
        });
    });

    // ── listTemplates with `q` param ───────────────────────────────────────────

    describe('listTemplates — full-text search path (q filter)', () => {
        it('delegates to searchTemplates when q is provided', async () => {
            mockRpc.mockResolvedValue({ data: [dbTemplate()], error: null });

            const results = await service.listTemplates({ q: 'decentralized exchange' });

            expect(mockRpc).toHaveBeenCalledWith('search_templates', expect.objectContaining({
                p_query: 'decentralized exchange',
            }));
            expect(results).toHaveLength(1);
        });

        it('passes category alongside q when both are provided', async () => {
            mockRpc.mockResolvedValue({ data: [], error: null });

            await service.listTemplates({ q: 'yield', category: 'lending' });

            expect(mockRpc).toHaveBeenCalledWith('search_templates', expect.objectContaining({
                p_query:    'yield',
                p_category: 'lending',
            }));
        });

        it('does NOT call rpc when q is absent — uses supabase query builder', async () => {
            const query = makeQuery().mockResolve({ data: [dbTemplate()], error: null });
            mockFrom.mockReturnValue(query);

            await service.listTemplates({ search: 'stellar' });

            expect(mockRpc).not.toHaveBeenCalled();
            expect(mockFrom).toHaveBeenCalledWith('templates');
        });
    });

    // ── listTemplates (existing paths) ────────────────────────────────────────

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

        it('includes tags in the mapped template', async () => {
            const query = makeQuery().mockResolve({
                data: [dbTemplate({ tags: ['dex', 'trading'] })],
                error: null,
            });
            mockFrom.mockReturnValue(query);

            const [result] = await service.listTemplates();

            expect(result.tags).toEqual(['dex', 'trading']);
        });

        it('defaults tags to [] when column is missing', async () => {
            const rowWithoutTags = dbTemplate();
            delete rowWithoutTags.tags;
            const query = makeQuery().mockResolve({ data: [rowWithoutTags], error: null });
            mockFrom.mockReturnValue(query);

            const [result] = await service.listTemplates();

            expect(result.tags).toEqual([]);
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

        it('applies legacy ilike search filter using .or()', async () => {
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

        it('applies category and legacy search filters together', async () => {
            const query = makeQuery().mockResolve({ data: [], error: null });
            mockFrom.mockReturnValue(query);

            await service.listTemplates({ category: 'dex', search: 'stellar' });

            expect(query.eq).toHaveBeenCalledWith('category', 'dex');
            expect(query.or).toHaveBeenCalledWith('name.ilike.%stellar%,description.ilike.%stellar%');
        });

        it('orders results by created_at descending', async () => {
            const query = makeQuery().mockResolve({ data: [], error: null });
            mockFrom.mockReturnValue(query);

            await service.listTemplates();

            expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false });
        });

        it('maps multiple templates correctly', async () => {
            const query = makeQuery().mockResolve({
                data: [dbTemplate({ id: 'tpl-1' }), dbTemplate({ id: 'tpl-2', category: 'payment' })],
                error: null,
            });
            mockFrom.mockReturnValue(query);

            const results = await service.listTemplates();

            expect(results).toHaveLength(2);
            expect(results[0].id).toBe('tpl-1');
            expect(results[1].id).toBe('tpl-2');
            expect(results[1].category).toBe('payment');
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

        it('includes tags in the mapped result', async () => {
            const query = makeQuery();
            mockFrom.mockReturnValue(query);
            mockSingle.mockResolvedValue({ data: dbTemplate({ tags: ['dex', 'stellar'] }), error: null });

            const result = await service.getTemplate('tpl-1');

            expect(result.tags).toEqual(['dex', 'stellar']);
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

        it('throws when supabase returns an error', async () => {
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
                    return makeQuery({ single: vi.fn().mockResolvedValue({ data: dbMeta, error: null }) });
                }
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
