import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after stubbing globals
const { completeOnboardingAction } = await import('./actions');

const idle = { status: 'idle' as const, message: '' };

function makeFormData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
}

const validFields = {
    displayName: 'Jane Doe',
    bio: 'Hello world',
    avatarUrl: '',
    website: '',
    connectionStatus: 'online',
};

describe('completeOnboardingAction', () => {
    beforeEach(() => vi.clearAllMocks());

    // ------------------------------------------------------------------
    // Validation — entry state errors
    // ------------------------------------------------------------------

    describe('Validation (entry state)', () => {
        it('returns field error when displayName is missing', async () => {
            const result = await completeOnboardingAction(
                idle,
                makeFormData({ ...validFields, displayName: '' }),
            );
            expect(result.status).toBe('error');
            expect(result.fieldErrors?.displayName).toBeDefined();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('returns field error when displayName is too short', async () => {
            const result = await completeOnboardingAction(
                idle,
                makeFormData({ ...validFields, displayName: 'A' }),
            );
            expect(result.status).toBe('error');
            expect(result.fieldErrors?.displayName).toMatch(/at least 2/i);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('returns field error when bio exceeds 160 characters', async () => {
            const result = await completeOnboardingAction(
                idle,
                makeFormData({ ...validFields, bio: 'x'.repeat(161) }),
            );
            expect(result.status).toBe('error');
            expect(result.fieldErrors?.bio).toMatch(/160/);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('returns field error when website is not a valid URL', async () => {
            const result = await completeOnboardingAction(
                idle,
                makeFormData({ ...validFields, website: 'not-a-url' }),
            );
            expect(result.status).toBe('error');
            expect(result.fieldErrors?.website).toMatch(/valid URL/i);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('passes when website is empty (optional)', async () => {
            mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
            const result = await completeOnboardingAction(
                idle,
                makeFormData({ ...validFields, website: '' }),
            );
            expect(result.status).toBe('success');
        });

        it('passes when website is a valid URL', async () => {
            mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
            const result = await completeOnboardingAction(
                idle,
                makeFormData({ ...validFields, website: 'https://example.com' }),
            );
            expect(result.status).toBe('success');
        });

        it('returns field error for invalid connectionStatus', async () => {
            const result = await completeOnboardingAction(
                idle,
                makeFormData({ ...validFields, connectionStatus: 'invisible' }),
            );
            expect(result.status).toBe('error');
            expect(result.fieldErrors?.connectionStatus).toBeDefined();
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('accepts all valid connectionStatus values', async () => {
            for (const status of ['online', 'offline', 'busy', 'away']) {
                mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
                const result = await completeOnboardingAction(
                    idle,
                    makeFormData({ ...validFields, connectionStatus: status }),
                );
                expect(result.status).toBe('success');
            }
        });
    });

    // ------------------------------------------------------------------
    // Completion state — success
    // ------------------------------------------------------------------

    describe('Completion state', () => {
        it('returns success on valid submission', async () => {
            mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
            const result = await completeOnboardingAction(idle, makeFormData(validFields));
            expect(result.status).toBe('success');
            expect(result.message).toMatch(/welcome/i);
        });

        it('calls PUT /api/profile with the validated data', async () => {
            mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
            await completeOnboardingAction(idle, makeFormData(validFields));
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/profile'),
                expect.objectContaining({ method: 'PUT' }),
            );
        });
    });

    // ------------------------------------------------------------------
    // Network / API errors
    // ------------------------------------------------------------------

    it('returns network error when fetch throws', async () => {
        mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
        const result = await completeOnboardingAction(idle, makeFormData(validFields));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/network error/i);
    });

    it('returns API error on non-200 response', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Internal server error' }),
        });
        const result = await completeOnboardingAction(idle, makeFormData(validFields));
        expect(result.status).toBe('error');
        expect(result.message).toBe('Internal server error');
    });
});
