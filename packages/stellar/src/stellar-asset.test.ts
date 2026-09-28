import { describe, expect, it } from 'vitest';
import { makeStellarAsset } from './stellar-asset';

describe('makeStellarAsset', () => {
  it('constructs valid native and credit assets', () => {
    expect(makeStellarAsset('native', 'XLM', '')).toEqual({ type: 'native', code: 'XLM', issuer: '' });
    expect(makeStellarAsset('credit_alphanum4', 'USDC', 'GISSUER')).toEqual({
      type: 'credit_alphanum4', code: 'USDC', issuer: 'GISSUER',
    });
    expect(makeStellarAsset('credit_alphanum12', 'LONGCOIN', 'GISSUER')).toEqual({
      type: 'credit_alphanum12', code: 'LONGCOIN', issuer: 'GISSUER',
    });
  });

  it('rejects a code/type length mismatch with a clear error', () => {
    expect(() => makeStellarAsset('credit_alphanum4', 'TOOLONG', 'GISSUER'))
      .toThrow('credit_alphanum4 asset codes must be 1-4 characters.');
    expect(() => makeStellarAsset('credit_alphanum12', 'USDC', 'GISSUER'))
      .toThrow('credit_alphanum12 asset codes must be 5-12 characters.');
  });
});