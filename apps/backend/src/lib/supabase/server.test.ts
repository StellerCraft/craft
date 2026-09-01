import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from './server';

vi.mock('@supabase/ssr', () => ({
    createServerClient: vi.fn(() => ({})),
}));

vi.mock('next/headers', () => ({
    cookies: vi.fn(() => ({
        get: vi.fn(),
        set: vi.fn(),
    })),
}));

import { createServerClient } from '@supabase/ssr';

describe('server', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    });

    afterEach(() => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    });

    it('creates a Supabase client using environment variables', () => {
        createClient();

        expect(createServerClient).toHaveBeenCalledWith(
            'https://test.supabase.co',
            'test-anon-key',
            expect.objectContaining({
                cookies: expect.objectContaining({
                    get: expect.any(Function),
                    set: expect.any(Function),
                }),
            })
        );
    });

    it('throws when NEXT_PUBLIC_SUPABASE_URL is missing', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;

        expect(() => createClient()).toThrow();
    });

    it('throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing', () => {
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        expect(() => createClient()).toThrow();
    });
});
