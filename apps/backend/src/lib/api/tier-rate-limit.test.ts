import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { withTierRateLimit } from './tier-rate-limit';
import { createClient } from '@/lib/supabase/server';
import { createLogger } from './logger';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('./logger', () => ({
    createLogger: vi.fn(() => ({ warn: vi.fn() })),
    resolveCorrelationId: vi.fn(() => 'test-correlation-id'),
}));

describe('withTierRateLimit tier lookup failures', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.RATE_LIMIT_DISABLED;
    });

    it('logs a lookup error with route context and keeps the free-tier limit', async () => {
        const warning = vi.fn();
        vi.mocked(createLogger).mockReturnValue({ warn: warning } as any);
        vi.mocked(createClient).mockReturnValue({
            auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('database unavailable') }) },
        } as any);

        const handler = withTierRateLimit('api/deployments')(async () => NextResponse.json({ ok: true }));
        const response = await handler(new NextRequest('http://localhost/api/deployments'), { params: {} });

        expect(response.status).toBe(200);
        expect(response.headers.get('x-ratelimit-tier')).toBe('free');
        expect(warning).toHaveBeenCalledWith(
            'Subscription tier lookup failed; defaulting to free tier',
            expect.objectContaining({ route: 'api/deployments', error: 'database unavailable' }),
        );
    });
});