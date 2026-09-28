import type { StellarAsset, StellarAssetType } from '@craft/types';

/** Create a Stellar asset after enforcing its code/type length invariant. */
export function makeStellarAsset(
  type: StellarAssetType,
  code: string,
  issuer: string,
): StellarAsset {
  if (type !== 'native' && type !== 'credit_alphanum4' && type !== 'credit_alphanum12') {
    throw new Error('Stellar asset type must be native, credit_alphanum4, or credit_alphanum12.');
  }

  if (type === 'native') {
    if (code !== 'XLM' || issuer !== '') {
      throw new Error('A native Stellar asset must use code XLM and an empty issuer.');
    }
    return { type, code, issuer };
  }

  if (!/^[A-Z0-9]{1,12}$/.test(code)) {
    throw new Error('A credit Stellar asset code must be 1-12 uppercase alphanumeric characters.');
  }
  if (type === 'credit_alphanum4' && code.length > 4) {
    throw new Error('credit_alphanum4 asset codes must be 1-4 characters.');
  }
  if (type === 'credit_alphanum12' && code.length < 5) {
    throw new Error('credit_alphanum12 asset codes must be 5-12 characters.');
  }

  return { type, code, issuer };
}