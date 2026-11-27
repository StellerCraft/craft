import { assertValidStellarAssetCode, type StellarAsset, type StellarAssetType } from '@craft/types';

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

  assertValidStellarAssetCode(type, code);

  return { type, code, issuer };
}