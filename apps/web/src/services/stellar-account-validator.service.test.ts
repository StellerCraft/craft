import { describe, it, expect, vi } from 'vitest';
import { StellarAccountValidator, validateAccountAddress } from './stellar-account-validator.service';

// Valid 56-char base32 Stellar address (A-Z, 2-7 only)
const VALID_ADDRESS = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

describe('validateAccountAddress', () => {
    it('accepts a valid Stellar account address', () => {
        expect(validateAccountAddress(VALID_ADDRESS).valid).toBe(true);
    });

    it('rejects empty string', () => {
        expect(validateAccountAddress('').valid).toBe(false);
    });

    it('rejects null', () => {
        expect(validateAccountAddress(null).valid).toBe(false);
    });

    it('rejects non-string', () => {
        expect(validateAccountAddress(12345).valid).toBe(false);
    });

    it('rejects address not starting with G', () => {
        const r = validateAccountAddress('C' + VALID_ADDRESS.slice(1));
        expect(r.valid).toBe(false);
        if (!r.valid) expect(r.error.code).toBe('ACCOUNT_ADDRESS_INVALID_PREFIX');
    });

    it('rejects address with wrong length', () => {
        expect(validateAccountAddress('GAAA').valid).toBe(false);
    });

    it('rejects address with invalid characters', () => {
        expect(validateAccountAddress('G' + '1'.repeat(55)).valid).toBe(false);
    });

    it('returns the address on success', () => {
        const r = validateAccountAddress(VALID_ADDRESS);
        if (r.valid) expect(r.address).toBe(VALID_ADDRESS);
    });
});

describe('StellarAccountValidator.checkExistence', () => {
    it('returns exists: false for invalid format', async () => {
        const v = new StellarAccountValidator();
        const r = await v.checkExistence('INVALID', HORIZON_URL);
        expect(r.exists).toBe(false);
        expect(r.error).toBeDefined();
    });

    it('returns exists: false and funded: false for 404', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
        const v = new StellarAccountValidator(mockFetch as any);
        const r = await v.checkExistence(VALID_ADDRESS, HORIZON_URL);
        expect(r.exists).toBe(false);
        expect(r.funded).toBe(false);
    });

    it('returns exists: true and funded: true when XLM balance > 0', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                balances: [{ asset_type: 'native', balance: '100.0000000' }],
            }),
        });
        const v = new StellarAccountValidator(mockFetch as any);
        const r = await v.checkExistence(VALID_ADDRESS, HORIZON_URL);
        expect(r.exists).toBe(true);
        expect(r.funded).toBe(true);
    });

    it('returns exists: true and funded: false when XLM balance is 0', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                balances: [{ asset_type: 'native', balance: '0.0000000' }],
            }),
        });
        const v = new StellarAccountValidator(mockFetch as any);
        const r = await v.checkExistence(VALID_ADDRESS, HORIZON_URL);
        expect(r.exists).toBe(true);
        expect(r.funded).toBe(false);
    });

    it('returns error on network exception', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('timeout'));
        const v = new StellarAccountValidator(mockFetch as any);
        const r = await v.checkExistence(VALID_ADDRESS, HORIZON_URL);
        expect(r.exists).toBe(false);
        expect(r.error).toContain('timeout');
    });
});
