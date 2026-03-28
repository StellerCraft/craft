import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after stubbing globals
const { updateProfileAction } = await import('./actions');

const idle = { status: 'idle' as const, message: '' };

function makeFormData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
}

describe('updateProfileAction', () => {
    beforeEach(() => vi.clearAllMocks());

    // ------------------------------------------------------------------
    // Validation errors (Zod)
    // ------------------------------------------------------------------

    it('returns field error when displayName is missing', async () => {
        const result = await updateProfileAction(
            idle,
            makeFormData({ displayName: '', bio: '', avatarUrl: '' }),
        );
        expect(result.status).toBe('error');
        expect(result.fieldErrors?.displayName).toBeDefined();
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns field error when displayName is too short', async () => {
        const result = await updateProfileAction(
            idle,
            makeFormData({ displayName: 'A', bio: '', avatarUrl: '' }),
        );
        expect(result.status).toBe('error');
        expect(result.fieldErrors?.displayName).toMatch(/at least 2/i);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns field error when avatarUrl is invalid', async () => {
        const result = await updateProfileAction(
            idle,
            makeFormData({
                displayName: 'Jane Doe',
                bio: '',
                avatarUrl: 'not-a-url',
            }),
        );
        expect(result.status).toBe('error');
        expect(result.fieldErrors?.avatarUrl).toMatch(/valid URL/i);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // Success
    // ------------------------------------------------------------------

    it('returns success on valid profile update', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ displayName: 'Jane Doe' }),
        });

        const result = await updateProfileAction(
            idle,
            makeFormData({
                displayName: 'Jane Doe',
                bio: 'Hello world',
                avatarUrl: '',
            }),
        );
        expect(result.status).toBe('success');
        expect(result.message).toMatch(/updated/i);
    });

    // ------------------------------------------------------------------
    // Network error
    // ------------------------------------------------------------------

    it('returns network error when fetch throws', async () => {
        mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await updateProfileAction(
            idle,
            makeFormData({
                displayName: 'Jane Doe',
                bio: '',
                avatarUrl: '',
            }),
        );
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/network error/i);
    });

    // ------------------------------------------------------------------
    // API error (non-200)
    // ------------------------------------------------------------------

    it('returns API error on non-200 response', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' }),
        });

        const result = await updateProfileAction(
            idle,
            makeFormData({
                displayName: 'Jane Doe',
                bio: '',
                avatarUrl: '',
            }),
        );
        expect(result.status).toBe('error');
        expect(result.message).toBe('Internal server error');
    });
});
