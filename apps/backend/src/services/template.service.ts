/**
 * TemplateService
 *
 * Handles template listing, lookup, and full-text search.
 *
 * Full-text search (searchTemplates / listTemplates with `q` filter):
 *   - Backed by a Postgres tsvector column on name (weight A), tags (weight B),
 *     and description (weight C) — see migration 016_template_fulltext_search.sql.
 *   - Results are ranked by ts_rank (most relevant first).
 *   - Supports: keyword search, phrase search ("liquidity pool"),
 *     prefix search (decentral:*), and category filter combined with text search.
 *   - Falls back to ilike when the `search` legacy filter is used and `q` is absent.
 *
 * Issue: feat/template-full-text-search-index
 */

import { createClient } from '@/lib/supabase/server';
import type {
    Template,
    TemplateFilters,
    TemplateMetadata,
    TemplateCategory,
} from '@craft/types';

// ── Search result ─────────────────────────────────────────────────────────────

export interface TemplateSearchResult extends Template {
    relevanceScore: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class TemplateService {
    /**
     * Full-text search across template name, description, and tags.
     *
     * Uses the `search_templates` Postgres RPC which:
     *   - Converts the raw query via websearch_to_tsquery (handles phrases + prefixes)
     *   - Filters by category when provided
     *   - Ranks results by ts_rank descending (name hits > tag hits > description hits)
     *
     * Examples:
     *   searchTemplates('decentralized exchange')      → keyword AND search
     *   searchTemplates('"liquidity pool"')             → phrase search
     *   searchTemplates('decentral:*')                  → prefix search
     *   searchTemplates('soroban', 'lending')           → text + category filter
     */
    async searchTemplates(
        query: string,
        category?: TemplateCategory,
        limit = 20,
        offset = 0,
    ): Promise<TemplateSearchResult[]> {
        const supabase = createClient();

        const { data, error } = await supabase.rpc('search_templates', {
            p_query:    query,
            p_category: category ?? null,
            p_limit:    limit,
            p_offset:   offset,
        });

        if (error) {
            throw new Error(`Failed to search templates: ${error.message}`);
        }

        return (data ?? []).map((row: any) =>
            this.mapDatabaseToTemplate(row) as TemplateSearchResult,
        );
    }

    /**
     * List all templates with optional filtering.
     *
     * When `filters.q` is provided, delegates to `searchTemplates()` for
     * relevance-ranked full-text results.
     *
     * When only `filters.search` is provided, falls back to the legacy
     * ilike path for backward compatibility.
     */
    async listTemplates(filters?: TemplateFilters): Promise<Template[]> {
        // Delegate to full-text search when the `q` filter is present
        if (filters?.q) {
            return this.searchTemplates(filters.q, filters.category);
        }

        const supabase = createClient();

        let query = supabase
            .from('templates')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        // Apply category filter
        if (filters?.category) {
            query = query.eq('category', filters.category);
        }

        // Apply blockchain type filter
        if (filters?.blockchainType) {
            query = query.eq('blockchain_type', filters.blockchainType);
        }

        // Apply legacy ilike search filter
        if (filters?.search) {
            query = query.or(
                `name.ilike.%${filters.search}%,description.ilike.%${filters.search}%`
            );
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Failed to list templates: ${error.message}`);
        }

        return (data || []).map((row) => this.mapDatabaseToTemplate(row));
    }

    /**
     * Get a single template by ID
     */
    async getTemplate(templateId: string): Promise<Template> {
        const supabase = createClient();

        const { data, error } = await supabase
            .from('templates')
            .select('*')
            .eq('id', templateId)
            .eq('is_active', true)
            .single();

        if (error) {
            throw new Error(`Failed to get template: ${error.message}`);
        }

        if (!data) {
            throw new Error('Template not found');
        }

        return this.mapDatabaseToTemplate(data);
    }

    /**
     * Get template metadata including usage statistics
     */
    async getTemplateMetadata(templateId: string): Promise<TemplateMetadata> {
        const supabase = createClient();

        // Get template
        const { data: template, error: templateError } = await supabase
            .from('templates')
            .select('id, name, created_at, updated_at')
            .eq('id', templateId)
            .single();

        if (templateError || !template) {
            throw new Error('Template not found');
        }

        // Get deployment count
        const { count } = await supabase
            .from('deployments')
            .select('*', { count: 'exact', head: true })
            .eq('template_id', templateId);

        return {
            id: template.id,
            name: template.name,
            version: '1.0.0', // TODO: Add versioning
            lastUpdated: new Date(template.updated_at),
            totalDeployments: count || 0,
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Map database row to Template type
     */
    private mapDatabaseToTemplate(data: any): Template {
        const schema = data.customization_schema;

        return {
            id: data.id,
            name: data.name,
            description: data.description || '',
            category: data.category as TemplateCategory,
            blockchainType: 'stellar',
            baseRepositoryUrl: data.base_repository_url,
            previewImageUrl: data.preview_image_url || '',
            tags: Array.isArray(data.tags) ? data.tags : [],
            features: this.extractFeatures(schema),
            customizationSchema: schema,
            isActive: data.is_active,
            createdAt: new Date(data.created_at),
        };
    }

    /**
     * Extract features from customization schema
     */
    private extractFeatures(schema: any): Array<{
        id: string;
        name: string;
        description: string;
        enabled: boolean;
        configurable: boolean;
    }> {
        const features: any[] = [];

        if (schema?.features) {
            Object.entries(schema.features).forEach(([key, value]: [string, any]) => {
                features.push({
                    id: key,
                    name: this.formatFeatureName(key),
                    description: `Enable ${this.formatFeatureName(key).toLowerCase()}`,
                    enabled: value.default || false,
                    configurable: true,
                });
            });
        }

        return features;
    }

    /**
     * Format feature key to readable name
     */
    private formatFeatureName(key: string): string {
        return key
            .replace(/^enable/, '')
            .replace(/([A-Z])/g, ' $1')
            .trim();
    }
}

// Export singleton instance
export const templateService = new TemplateService();
