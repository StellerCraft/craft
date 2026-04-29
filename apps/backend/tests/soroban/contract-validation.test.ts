import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateContractAddress,
  validateContractAddresses,
} from '../../src/lib/stellar/contract-validation';
import {
  SorobanContractValidator,
} from '../../src/services/soroban-contract-validator.service';

/**
 * Soroban Contract Validation Tests
 *
 * Covers:
 * - validateContractAddress pure function (all rule branches)
 * - validateContractAddresses batch helper
 * - SorobanContractValidator.validateFormat (structured errors + guidance)
 * - SorobanContractValidator.checkExistence (RPC integration)
 * - Property-based tests for random strings
 * - Edge cases: empty, whitespace-only, G-prefix, bad checksum
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

/**
 * A real Soroban contract address with a valid CRC-16/XMODEM checksum.
 * Version byte 0x10, 32 zero-byte payload, correct checksum appended.
 */
const VALID_ADDRESS = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

// ── validateContractAddress ───────────────────────────────────────────────────

describe('validateContractAddress', () => {
  describe('valid address', () => {
    it('accepts a well-formed contract address', () => {
      expect(validateContractAddress(VALID_ADDRESS)).toEqual({ valid: true });
    });
  });

  describe('whitespace checks', () => {
    it('rejects address with leading whitespace', () => {
      const result = validateContractAddress(' ' + VALID_ADDRESS);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_WHITESPACE' });
    });

    it('rejects address with trailing whitespace', () => {
      const result = validateContractAddress(VALID_ADDRESS + ' ');
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_WHITESPACE' });
    });

    it('rejects whitespace-only string', () => {
      const result = validateContractAddress('   ');
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_WHITESPACE' });
    });

    it('rejects address with internal tab', () => {
      const mid = Math.floor(VALID_ADDRESS.length / 2);
      const withTab = VALID_ADDRESS.slice(0, mid) + '\t' + VALID_ADDRESS.slice(mid);
      const result = validateContractAddress(withTab);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_WHITESPACE' });
    });

    it('rejects address with newline', () => {
      const result = validateContractAddress(VALID_ADDRESS + '\n');
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_WHITESPACE' });
    });
  });

  describe('empty check', () => {
    it('rejects empty string', () => {
      const result = validateContractAddress('');
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_EMPTY' });
    });
  });

  describe('length check', () => {
    it('rejects address that is too short', () => {
      const result = validateContractAddress(VALID_ADDRESS.slice(0, 55));
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_LENGTH' });
    });

    it('rejects address that is too long', () => {
      const result = validateContractAddress(VALID_ADDRESS + 'A');
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_LENGTH' });
    });

    it('includes actual length in the reason message', () => {
      const result = validateContractAddress('C'.repeat(10));
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_LENGTH' });
      if (!result.valid) expect(result.reason).toContain('10');
    });
  });

  describe('prefix check', () => {
    it('rejects G-prefix (Stellar account address)', () => {
      const gAddress = 'G' + VALID_ADDRESS.slice(1);
      const result = validateContractAddress(gAddress);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_PREFIX' });
    });

    it('rejects lowercase c prefix', () => {
      const lower = 'c' + VALID_ADDRESS.slice(1);
      const result = validateContractAddress(lower);
      // lowercase 'c' is not in base32 alphabet, so charset error fires first
      expect(result.valid).toBe(false);
    });

    it('rejects S-prefix', () => {
      const sAddress = 'S' + VALID_ADDRESS.slice(1);
      const result = validateContractAddress(sAddress);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_PREFIX' });
    });
  });

  describe('charset check', () => {
    it('rejects address with digit 0', () => {
      const bad = 'C' + '0'.repeat(55);
      const result = validateContractAddress(bad);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_CHARSET' });
    });

    it('rejects address with digit 1', () => {
      const bad = 'C' + '1'.repeat(55);
      const result = validateContractAddress(bad);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_CHARSET' });
    });

    it('rejects address with digit 8', () => {
      const bad = 'C' + '8'.repeat(55);
      const result = validateContractAddress(bad);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_CHARSET' });
    });

    it('rejects address with special character', () => {
      const bad = 'C' + VALID_ADDRESS.slice(1, 55) + '!';
      const result = validateContractAddress(bad);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_CHARSET' });
    });
  });

  describe('checksum check', () => {
    it('rejects address with corrupted last character', () => {
      // Flip the last character to break the checksum
      const lastChar = VALID_ADDRESS[55]!;
      const replacement = lastChar === 'A' ? 'B' : 'A';
      const corrupted = VALID_ADDRESS.slice(0, 55) + replacement;
      const result = validateContractAddress(corrupted);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_CHECKSUM' });
    });

    it('rejects address with corrupted middle character', () => {
      const chars = VALID_ADDRESS.split('');
      chars[28] = chars[28] === 'A' ? 'B' : 'A';
      const corrupted = chars.join('');
      const result = validateContractAddress(corrupted);
      expect(result).toMatchObject({ valid: false, code: 'CONTRACT_ADDRESS_INVALID_CHECKSUM' });
    });
  });
});

// ── validateContractAddresses ─────────────────────────────────────────────────

describe('validateContractAddresses', () => {
  it('returns valid for empty object', () => {
    expect(validateContractAddresses({})).toEqual({ valid: true });
  });

  it('returns valid for undefined', () => {
    expect(validateContractAddresses(undefined)).toEqual({ valid: true });
  });

  it('returns valid when all addresses are valid', () => {
    expect(validateContractAddresses({ token: VALID_ADDRESS })).toEqual({ valid: true });
  });

  it('returns field path and code on first invalid address', () => {
    const result = validateContractAddresses({ token: '' });
    expect(result).toMatchObject({
      valid: false,
      field: 'stellar.contractAddresses.token',
      code: 'CONTRACT_ADDRESS_EMPTY',
    });
  });
});

// ── SorobanContractValidator.validateFormat ───────────────────────────────────

describe('SorobanContractValidator.validateFormat', () => {
  let validator: SorobanContractValidator;

  beforeEach(() => {
    validator = new SorobanContractValidator();
    vi.useFakeTimers();
  });

  afterEach(() => {
    validator.clearCache();
    vi.useRealTimers();
  });

  it('returns valid: true for a well-formed address', () => {
    expect(validator.validateFormat(VALID_ADDRESS)).toEqual({ valid: true });
  });

  it('returns structured error for non-string input', () => {
    const result = validator.validateFormat(null);
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBeDefined();
    expect(result.error?.guidance).toBeDefined();
    expect(result.error?.guidance.template.title).toBeTruthy();
  });

  it('returns guidance aligned with catalogue for empty string', () => {
    const result = validator.validateFormat('');
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('CONTRACT_ADDRESS_EMPTY');
    expect(result.error?.guidance.template.title).toBeTruthy();
    expect(result.error?.guidance.steps.length).toBeGreaterThan(0);
  });

  it('returns guidance for whitespace-only input', () => {
    const result = validator.validateFormat('   ');
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('CONTRACT_ADDRESS_WHITESPACE');
    expect(result.error?.guidance).toBeDefined();
  });

  it('returns guidance for wrong-length address', () => {
    const result = validator.validateFormat('CAAA');
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('CONTRACT_ADDRESS_INVALID_LENGTH');
    expect(result.error?.guidance.steps.length).toBeGreaterThan(0);
  });

  it('returns guidance for G-prefix (mainnet vs testnet prefix mismatch)', () => {
    const result = validator.validateFormat('G' + VALID_ADDRESS.slice(1));
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('CONTRACT_ADDRESS_INVALID_PREFIX');
    expect(result.error?.guidance.template.message).toContain('"C"');
  });

  it('returns guidance for invalid charset', () => {
    const result = validator.validateFormat('C' + '0'.repeat(55));
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('CONTRACT_ADDRESS_INVALID_CHARSET');
  });

  it('returns guidance for bad checksum', () => {
    const corrupted = VALID_ADDRESS.slice(0, 55) + (VALID_ADDRESS[55] === 'A' ? 'B' : 'A');
    const result = validator.validateFormat(corrupted);
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('CONTRACT_ADDRESS_INVALID_CHECKSUM');
    expect(result.error?.guidance.links.length).toBeGreaterThan(0);
  });
});

// ── SorobanContractValidator.checkExistence ───────────────────────────────────

describe('SorobanContractValidator.checkExistence', () => {
  it('returns exists: false with error when format is invalid', async () => {
    const validator = new SorobanContractValidator();
    const result = await validator.checkExistence('INVALID', 'http://rpc.example.com');
    expect(result.exists).toBe(false);
    expect(result.callable).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns exists: true when RPC returns entries', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { entries: [{}] } }),
    });
    const validator = new SorobanContractValidator(mockFetch as any);
    const result = await validator.checkExistence(VALID_ADDRESS, 'http://rpc.example.com');
    expect(result.exists).toBe(true);
    expect(result.callable).toBe(true);
  });

  it('returns exists: false when RPC returns empty entries', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { entries: [] } }),
    });
    const validator = new SorobanContractValidator(mockFetch as any);
    const result = await validator.checkExistence(VALID_ADDRESS, 'http://rpc.example.com');
    expect(result.exists).toBe(false);
    expect(result.callable).toBe(false);
  });

  it('returns exists: false on HTTP error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const validator = new SorobanContractValidator(mockFetch as any);
    const result = await validator.checkExistence(VALID_ADDRESS, 'http://rpc.example.com');
    expect(result.exists).toBe(false);
    expect(result.error).toContain('503');
  });

  it('returns exists: false on network error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const validator = new SorobanContractValidator(mockFetch as any);
    const result = await validator.checkExistence(VALID_ADDRESS, 'http://rpc.example.com');
    expect(result.exists).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('handles RPC not-found error code', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: -32600, message: 'not found' } }),
    });
    const validator = new SorobanContractValidator(mockFetch as any);
    const result = await validator.checkExistence(VALID_ADDRESS, 'http://rpc.example.com');
    expect(result.exists).toBe(false);
  });
});

// ── Property-based tests ──────────────────────────────────────────────────────

describe('property-based: random strings always produce a structured result', () => {
  const randomStrings = [
    '',
    ' ',
    '\t\n',
    'abc',
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    'C'.repeat(56),
    'C' + 'A'.repeat(54) + '!',
    'C' + '0'.repeat(55),
    Array.from({ length: 56 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 94))).join(''),
    Array.from({ length: 100 }, () => 'A').join(''),
  ];

  for (const input of randomStrings) {
    it(`validateContractAddress("${input.slice(0, 20)}…") returns a typed result`, () => {
      const result = validateContractAddress(input);
      expect(typeof result.valid).toBe('boolean');
      if (!result.valid) {
        expect(typeof result.code).toBe('string');
        expect(typeof result.reason).toBe('string');
      }
    });
  }

  it('validateFormat never throws for arbitrary inputs', () => {
    const validator = new SorobanContractValidator();
    const inputs: unknown[] = [null, undefined, 42, {}, [], true, '', ' ', VALID_ADDRESS];
    for (const input of inputs) {
      expect(() => validator.validateFormat(input)).not.toThrow();
    }
  });
});

// Export TTL constant so the test assertions above stay in sync with the cache
// implementation without magic numbers.
export { INVOCATION_CACHE_TTL_MS };
