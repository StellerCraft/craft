/**
 * Stellar Trustline Validation
 *
 * Validates that necessary Stellar trustlines exist or can be established
 * before deploying asset issuance templates.
 */

import { Asset, Horizon } from 'stellar-sdk';

export interface TrustlineValidationResult {
  valid: boolean;
  error?: string;
  missingTrustlines?: Array<{
    asset: string;
    issuer: string;
    reason: string;
  }>;
}

export interface TrustlineInfo {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit: string;
  is_authorized: boolean;
  is_authorized_to_maintain_liabilities: boolean;
}

/**
 * Maximum number of trustlines an account can have.
 * Based on Stellar protocol limits.
 */
export const MAX_TRUSTLINES_PER_ACCOUNT = 1000;

/**
 * Validates that required trustlines exist for an account.
 *
 * @param accountId - The Stellar account address
 * @param requiredAssets - Array of assets that require trustlines
 * @param accountData - Account data from Horizon (optional, will fetch if not provided)
 * @returns Validation result with details about missing trustlines
 *
 * @example
 * ```typescript
 * const result = await validateTrustlines(
 *   'GABC...',
 *   [{ code: 'USD', issuer: 'GDEF...' }]
 * );
 * if (!result.valid) {
 *   console.error('Missing trustlines:', result.missingTrustlines);
 * }
 * ```
 */
export async function validateTrustlines(
  accountId: string,
  requiredAssets: Array<{ code: string; issuer: string }>,
  accountData?: Horizon.ServerApi.AccountRecord
): Promise<TrustlineValidationResult> {
  // Validate account address format
  if (!accountId || accountId.length !== 56 || !accountId.startsWith('G')) {
    return {
      valid: false,
      error: 'Invalid account address format',
    };
  }

  // Native XLM doesn't require trustlines
  const nonNativeAssets = requiredAssets.filter(
    (asset) => asset.code !== 'XLM' && asset.code !== 'native'
  );

  if (nonNativeAssets.length === 0) {
    return { valid: true };
  }

  // Get account trustlines
  const trustlines = accountData?.balances || [];
  const missingTrustlines: Array<{
    asset: string;
    issuer: string;
    reason: string;
  }> = [];

  // Check each required asset
  for (const requiredAsset of nonNativeAssets) {
    const trustline = trustlines.find(
      (t) =>
        t.asset_type !== 'native' &&
        t.asset_code === requiredAsset.code &&
        t.asset_issuer === requiredAsset.issuer
    );

    if (!trustline) {
      missingTrustlines.push({
        asset: requiredAsset.code,
        issuer: requiredAsset.issuer,
        reason: 'Trustline does not exist',
      });
    } else {
      // Check if trustline is authorized
      if (!trustline.is_authorized && !trustline.is_authorized_to_maintain_liabilities) {
        missingTrustlines.push({
          asset: requiredAsset.code,
          issuer: requiredAsset.issuer,
          reason: 'Trustline exists but is not authorized',
        });
      }

      // Check if trustline limit is maxed out
      if (trustline.limit !== '0' && trustline.balance === trustline.limit) {
        missingTrustlines.push({
          asset: requiredAsset.code,
          issuer: requiredAsset.issuer,
          reason: 'Trustline limit is maxed out',
        });
      }
    }
  }

  if (missingTrustlines.length > 0) {
    return {
      valid: false,
      error: `Missing or invalid trustlines for ${missingTrustlines.length} asset(s)`,
      missingTrustlines,
    };
  }

  return { valid: true };
}

/**
 * Checks if an account can establish new trustlines.
 *
 * @param accountData - Account data from Horizon
 * @param additionalTrustlines - Number of additional trustlines needed
 * @returns Whether the account can establish the trustlines
 *
 * @example
 * ```typescript
 * const canEstablish = canEstablishTrustlines(accountData, 2);
 * if (!canEstablish) {
 *   console.error('Account has reached maximum trustline limit');
 * }
 * ```
 */
export function canEstablishTrustlines(
  accountData: Horizon.ServerApi.AccountRecord,
  additionalTrustlines: number
): boolean {
  const currentTrustlines = accountData.balances.filter(
    (b) => b.asset_type !== 'native'
  ).length;

  return currentTrustlines + additionalTrustlines <= MAX_TRUSTLINES_PER_ACCOUNT;
}

/**
 * Validates trustlines before asset issuance template deployment.
 *
 * @param accountId - The account that will issue the asset
 * @param assets - Assets to be issued
 * @param accountData - Account data from Horizon (optional)
 * @returns Validation result with actionable error messages
 *
 * @example
 * ```typescript
 * const result = await validateAssetIssuanceDeployment(
 *   'GABC...',
 *   [{ code: 'USD', issuer: 'GDEF...' }]
 * );
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 * ```
 */
export async function validateAssetIssuanceDeployment(
  accountId: string,
  assets: Array<{ code: string; issuer: string }>,
  accountData?: Horizon.ServerApi.AccountRecord
): Promise<TrustlineValidationResult> {
  const trustlineResult = await validateTrustlines(accountId, assets, accountData);

  // Check capacity even when trustlines are missing — a full account can't add any
  if (accountData) {
    const missingCount = trustlineResult.missingTrustlines?.length || 0;
    if (missingCount > 0 && !canEstablishTrustlines(accountData, missingCount)) {
      return {
        valid: false,
        error: `Account has reached maximum trustline limit (${MAX_TRUSTLINES_PER_ACCOUNT})`,
        missingTrustlines: trustlineResult.missingTrustlines,
      };
    }
  }

  if (!trustlineResult.valid) {
    return trustlineResult;
  }

  return { valid: true };
}

export interface AccountSigner {
  key: string;
  weight: number;
}

export interface SignerCombination {
  signers: string[];
  totalWeight: number;
}

export interface MultiSigAuthorizationResult {
  multisigRequired: boolean;
  threshold: number;
  signerCombinations: SignerCombination[];
  canMeetThreshold: boolean;
}

/**
 * Returns all minimal combinations of signers whose combined weight meets the threshold.
 *
 * @param signers - List of signers with their weights
 * @param threshold - Required signing threshold for SET_TRUST_LINE_FLAGS
 * @returns MultiSigAuthorizationResult
 */
export function getRequiredSigners(
  signers: AccountSigner[],
  threshold: number
): MultiSigAuthorizationResult {
  if (threshold <= 1) {
    return {
      multisigRequired: false,
      threshold,
      signerCombinations: [],
      canMeetThreshold: signers.some((s) => s.weight >= threshold),
    };
  }

  const combinations: SignerCombination[] = [];

  // Enumerate subsets and collect those that meet the threshold
  const n = signers.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset: AccountSigner[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(signers[i]);
    }
    const total = subset.reduce((sum, s) => sum + s.weight, 0);
    if (total >= threshold) {
      // Only include minimal combinations (no proper subset also qualifies)
      const isMinimal = subset.every((_, idx) => {
        const reduced = subset.filter((__, j) => j !== idx);
        return reduced.reduce((sum, s) => sum + s.weight, 0) < threshold;
      });
      if (isMinimal) {
        combinations.push({ signers: subset.map((s) => s.key), totalWeight: total });
      }
    }
  }

  return {
    multisigRequired: true,
    threshold,
    signerCombinations: combinations,
    canMeetThreshold: combinations.length > 0,
  };
}

/**
 * Detects whether the issuer account requires multi-sig authorization for SET_TRUST_LINE_FLAGS
 * and returns the required signer combinations.
 *
 * @param issuerSigners - Signers on the issuer account
 * @param medThreshold - The medium threshold of the issuer account (governs SET_TRUST_LINE_FLAGS)
 * @returns MultiSigAuthorizationResult
 */
export function detectMultiSigTrustlineRequirement(
  issuerSigners: AccountSigner[],
  medThreshold: number
): MultiSigAuthorizationResult {
  return getRequiredSigners(issuerSigners, medThreshold);
}

/**
 * Formats trustline validation errors into user-friendly messages.
 *
 * @param result - Trustline validation result
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * const result = await validateTrustlines(...);
 * if (!result.valid) {
 *   console.error(formatTrustlineError(result));
 * }
 * ```
 */
export function formatTrustlineError(result: TrustlineValidationResult): string {
  if (result.valid) {
    return '';
  }

  let message = result.error || 'Trustline validation failed';

  if (result.missingTrustlines && result.missingTrustlines.length > 0) {
    message += '\n\nMissing trustlines:';
    result.missingTrustlines.forEach((missing) => {
      message += `\n- ${missing.asset} (${missing.issuer}): ${missing.reason}`;
    });

    message += '\n\nTo fix this:';
    message += '\n1. Establish trustlines for the missing assets';
    message += '\n2. Ensure trustlines are authorized by the issuer';
    message += '\n3. Verify trustline limits are not maxed out';
  }

  return message;
}
