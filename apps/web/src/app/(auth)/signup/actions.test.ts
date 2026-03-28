import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after stubbing globals
const { signUpAction } = await import('./actions');

const idle = { status: 'idle' as const, message: '' };

function makeFormData(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
}

describe('signUpAction', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns error when passwords do not match', async () => {
        const result = await signUpAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'password123',
            confirmPassword: 'different',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/passwords do not match/i);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns success on 201 response', async () => {
        mockFetch.mockResolvedValue({ ok: true, status: 201 });
        const result = await signUpAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'password123',
            confirmPassword: 'password123',
        }));
        expect(result.status).toBe('success');
        expect(result.message).toBeTruthy();
    });

    it('returns 409 message when email already exists', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({ error: 'duplicate key' }),
        });
        const result = await signUpAction(idle, makeFormData({
            email: 'existing@example.com',
            password: 'password123',
            confirmPassword: 'password123',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/already exists/i);
    });

    it('returns API error message on non-409 failure', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 400,
            json: async () => ({ error: 'Invalid input' }),
        });
        const result = await signUpAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'password123',
            confirmPassword: 'password123',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toBe('Invalid input');
    });

    it('returns network error message when fetch throws', async () => {
        mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
        const result = await signUpAction(idle, makeFormData({
            email: 'user@example.com',
            password: 'password123',
            confirmPassword: 'password123',
        }));
        expect(result.status).toBe('error');
        expect(result.message).toMatch(/network error/i);
    });
});
