/**
 * GET /api/templates
 *
 * Lists or searches templates.
 *
 * Query parameters:
 *   q            — Full-text search query (keyword, phrase, prefix).
 *                  Uses Postgres tsvector + ts_rank for relevance ranking.
 *                  Example: ?q=decentralized+exchange
 *   search       — Legacy ilike search (kept for backward compatibility).
 *   category     — Filter by category: dex | lending | payment | asset-issuance
 *   blockchainType — Filter by blockchain: stellar
 *
 * When `q` is supplied it takes precedence over `search` and results are
 * ordered by relevance score rather than created_at.
 *
 * Issue: feat/template-full-text-search-index
 */

import { NextRequest, NextResponse } from 'next/server';
import { templateService } from '@/services/template.service';
import { handlePreflight } from '@/lib/api/cors';
import type { TemplateFilters } from '@craft/types';

export function OPTIONS(req: NextRequest) {
    return handlePreflight(req);
}

export async function GET(req: NextRequest) {
    try {
        const searchParams = req.nextUrl.searchParams;

        const filters: TemplateFilters = {
            // Full-text search query (new — takes precedence)
            q: searchParams.get('q') || undefined,
            // Legacy ilike search
            search: searchParams.get('search') || undefined,
            category: searchParams.get('category') as any,
            blockchainType: searchParams.get('blockchainType') as any,
        };

        // Remove undefined values so the service can detect which filters were set
        (Object.keys(filters) as (keyof TemplateFilters)[]).forEach((key) => {
            if (filters[key] === undefined || filters[key] === null) {
                delete filters[key];
            }
        });

        const templates = await templateService.listTemplates(filters);

        return NextResponse.json(templates);
    } catch (error: any) {
        console.error('Error listing templates:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to list templates' },
            { status: 500 }
        );
    }
}
