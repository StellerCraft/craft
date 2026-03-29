import { describe, it, expect, vi } from 'vitest';
import { SorobanContractValidator } from './soroban-contract-validator.service';

const VALID_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_RPC_URL = 'https://soroban-testnet.stellar.org';

describe('SorobanContractValidator.validateFormat', () => {
    const validator = new SorobanContractValidator();

    it('accepts a valid 56-char contract address starting with C', () => {
        expect(validator.validateFormat(VALID_CONTRACT).valid).toBe(true);
    });

    it('rejects empty string', () => {
        const r = validator.validateFormat('');
        expect(r.valid).toBe(false);
    });

    it('rejects address not starting with C', () => {
        const r = validator.validateFormat('G' + VALID_CONTRACT.slice(1));
        expect(r.valid).toBe(false);
    });

    it('rejects address with wrong length', () => {
        const r = validator.validateFormat('CAAA');
        expect(r.valid).toBe(false);
    });

    it('rejects non-string input', () => {
        const r = validator.validateFormat(12345);
        expect(r.valid).toBe(false);
    });

    it('rejects address with invalid characters', () => {
        const r = validator.validateFormat('C' + '1'.repeat(55));
        expect(r.valid).toBe(false);
    });
});

describe('SorobanContractValidator.checkExistence', () => {
    it('returns exists: false for invalid format', async () => {
        const validator = new SorobanContractValidator();
        const result = await validator.checkExistence('INVALID', VALID_RPC_URL);
        expect(result.exists).toBe(false);
        expect(result.error).toBeDefined();
    });

    it('returns exists: true and callable: true when RPC returns entries', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: { entries: [{ xdr: 'abc' }] } }),
        });
        const validator = new SorobanContractValidator(mockFetch as any);
        const result = await validator.checkExistence(VALID_CONTRACT, VALID_RPC_URL);
        expect(result.exists).toBe(true);
        expect(result.callable).toBe(true);
    });

    it('returns exists: false when RPC returns empty entries', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ result: { entries: [] } }),
        });
        const validator = new SorobanContractValidator(mockFetch as any);
        const result = await validator.checkExistence(VALID_CONTRACT, VALID_RPC_URL);
        expect(result.exists).toBe(false);
    });

    it('returns exists: false with error when RPC returns error', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ error: { code: -32600, message: 'Contract not found' } }),
        });
        const validator = new SorobanContractValidator(mockFetch as any);
        const result = await validator.checkExistence(VALID_CONTRACT, VALID_RPC_URL);
        expect(result.exists).toBe(false);
        expect(result.error).toContain('not found');
    });

    it('returns exists: false with error on HTTP failure', async () => {
        const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
        const validator = new SorobanContractValidator(mockFetch as any);
        const result = await validator.checkExistence(VALID_CONTRACT, VALID_RPC_URL);
        expect(result.exists).toBe(false);
        expect(result.error).toContain('503');
    });

    it('returns exists: false with error on network exception', async () => {
        const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        const validator = new SorobanContractValidator(mockFetch as any);
        const result = await validator.checkExistence(VALID_CONTRACT, VALID_RPC_URL);
        expect(result.exists).toBe(false);
        expect(result.error).toContain('ECONNREFUSED');
    });
});
