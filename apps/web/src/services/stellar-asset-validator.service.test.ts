import { describe, it, expect, vi } from 'vitest';
import { StellarAssetValidator, validateAssetCode, validateAssetIssuer } from './stellar-asset-validator.service';

// Valid 56-char base32 Stellar address (A-Z, 2-7 only)
const VALID_ISSUER = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGSNFHEYVXM3XOJMDS674JZ';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';

describe('validateAssetCode', () => {
    it('accepts valid 1-12 char alphanumeric codes', () => {
        expect(validateAssetCode('XLM').valid).toBe(true);
        expect(validateAssetCode('USDC').valid).toBe(true);
        expect(validateAssetCode('LONGASSET12').valid).toBe(true);
    });

    it('rejects empty string', () => {
        expect(validateAssetCode('').valid).toBe(false);
    });

    it('rejects code longer than 12 chars', () => {
        expect(validateAssetCode('TOOLONGASSET1').valid).toBe(false);
    });

    it('rejects non-alphanumeric characters', () => {
        expect(validateAssetCode('XL-M').valid).toBe(false);
    });

    it('rejects non-string', () => {
        expect(validateAssetCode(null).valid).toBe(false);
    });
});

describe('validateAssetIssuer', () => {
    it('accepts a valid Stellar account address', () => {
        expect(validateAssetIssuer(VALID_ISSUER).valid).toBe(true);
    });

    it('rejects empty string', () => {
        expect(validateAssetIssuer('').valid).toBe(false);
    });

    it('rejects address not starting with G', () => {
        expect(validateAssetIssuer('C' + VALID_ISSUER.slice(1)).valid).toBe(false);
    });

    it('rejects non-string', () => {
        expect(validateAssetIssuer(42).valid).toBe(false);
    });
});

describe('StellarAssetValidator.checkExistence', () => {
    it('returns exists: false for invalid asset code', async () => {
        const v = new StellarAssetValidator();
        const r = await v.checkExistence('', VALID_ISSUER, HORIZON_URL);
        expect(r.exists).toBe(false);
        expect(r.error).toBeDefined();
    });

    it('returns exists: false for invalid issuer', async () => {
        const v = new StellarAssetValidator();
        const r = await v.checkExistence('USDC', 'INVALID', HORIZON_URL);
        expect(r.exists).toBe(false);
        expect(r.error).toBeDefined();
    });

    it('returns exists: true with supply when Horizon returns records', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                _embedded: { records: [{ amount: '1000000.0000000' }] },
            }),
        });
        const v = new StellarAssetValidator(mockFetch as any);
        const r = await v.checkExistence('USDC', VALID_ISSUER, HORIZON_URL);
        expect(r.exists).toBe(true);
        expect(r.supply).toBe('1000000.0000000');
    });

    it('returns exists: false when Horizon returns empty records', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ _embedded: { records: [] } }),
        });
        const v = new StellarAssetValidator(mockFetch as any);
        const r = await v.checkExistence('USDC', VALID_ISSUER, HORIZON_URL);
        expect(r.exists).toBe(false);
    });

    it('returns error on HTTP failure', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
        const v = new StellarAssetValidator(mockFetch as any);
        const r = await v.checkExistence('USDC', VALID_ISSUER, HORIZON_URL);
        expect(r.exists).toBe(false);
        expect(r.error).toContain('500');
    });

    it('returns error on network exception', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        const v = new StellarAssetValidator(mockFetch as any);
        const r = await v.checkExistence('USDC', VALID_ISSUER, HORIZON_URL);
        expect(r.exists).toBe(false);
        expect(r.error).toContain('ECONNREFUSED');
    });
});
