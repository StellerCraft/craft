import type { SupabaseClient } from '@supabase/supabase-js';
import type {
    LogsQueryParams,
    LogLevel,
    DeploymentLogResponse,
    PaginatedLogsResponse,
} from '@craft/types';

const MAX_LIMIT = 200;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const DEFAULT_ORDER = 'asc' as const;
const VALID_LEVELS: LogLevel[] = ['info', 'warn', 'error'];
const VALID_ORDERS = ['asc', 'desc'] as const;

export type ParseResult =
    | { valid: true; params: LogsQueryParams }
    | { valid: false };

/**
 * Validates and normalises the five query parameters for the logs route.
 * Returns { valid: false } on any validation failure — no DB query should
 * be executed in that case.
 */
export function parseLogsQueryParams(searchParams: URLSearchParams): ParseResult {
    // page
    const rawPage = searchParams.get('page');
    let page = DEFAULT_PAGE;
    if (rawPage !== null) {
        const n = Number(rawPage);
        if (!Number.isInteger(n) || n < 1) return { valid: false };
        page = n;
    }

    // limit
    const rawLimit = searchParams.get('limit');
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== null) {
        const n = Number(rawLimit);
        if (!Number.isInteger(n) || n < 1) return { valid: false };
        limit = Math.min(n, MAX_LIMIT);
    }

    // order
    const rawOrder = searchParams.get('order');
    let order: 'asc' | 'desc' = DEFAULT_ORDER;
    if (rawOrder !== null) {
        if (!VALID_ORDERS.includes(rawOrder as 'asc' | 'desc')) return { valid: false };
        order = rawOrder as 'asc' | 'desc';
    }

    // since
    const rawSince = searchParams.get('since');
    let since: string | undefined;
    if (rawSince !== null) {
        const d = new Date(rawSince);
        if (isNaN(d.getTime())) return { valid: false };
        since = rawSince;
    }

    // level
    const rawLevel = searchParams.get('level');
    let level: LogLevel | undefined;
    if (rawLevel !== null) {
        if (!VALID_LEVELS.includes(rawLevel as LogLevel)) return { valid: false };
        level = rawLevel as LogLevel;
    }

    return { valid: true, params: { page, limit, order, since, level } };
}

export const deploymentLogsService = {
    async getLogs(
        deploymentId: string,
        params: LogsQueryParams,
        supabase: SupabaseClient,
    ): Promise<PaginatedLogsResponse> {
        const { page, limit, order, since, level } = params;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('deployment_logs')
            .select('id, deployment_id, created_at, level, message', { count: 'exact' })
            .eq('deployment_id', deploymentId);

        if (since) query = query.gt('created_at', since);
        if (level) query = query.eq('level', level);

        query = query
            .order('created_at', { ascending: order === 'asc' })
            .range(offset, offset + limit - 1);

        const { data, count, error } = await query;

        if (error) throw new Error(error.message ?? 'Failed to retrieve logs');

        const rows = (data ?? []) as Array<{
            id: string;
            deployment_id: string;
            created_at: string;
            level: LogLevel;
            message: string;
        }>;

        const total = count ?? 0;

        return {
            data: rows.map((row) => ({
                id: row.id,
                deploymentId: row.deployment_id,
                timestamp: row.created_at,
                level: row.level,
                message: row.message,
            })),
            pagination: {
                page,
                limit,
                total,
                hasNextPage: offset + limit < total,
            },
        };
    },
};
