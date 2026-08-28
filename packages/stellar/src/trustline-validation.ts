/**
 * Stellar Trustline Validation
 *
 * Validates that necessary Stellar trustlines exist or can be established
 * before deploying asset issuance templates.
 */

import { Asset, Horizon } from 'stellar-sdk';

// ── Issuer existence verification (#789) ─────────────────────────────────────

/** Cache TTL: 5 minutes in milliseconds. */
const ISSUER_CACHE_TTL_MS = 5 * 60 * 1000;

/** Maximum number of entries held at once. Older entries are evicted first. */
const MAX_ISSUER_CACHE_ENTRIES = 1_000;

interface CacheEntry {
  result: IssuerVerificationResult;
  expiresAt: number;
}

const issuerCache = new Map<string, CacheEntry>();

/** Evict the oldest entry from the issuer cache. Used when at capacity. */
function evictOldestIssuerEntry(): void {
  const firstKey = issuerCache.keys().next().value;
  if (firstKey !== undefined) {
    issuerCache.delete(firstKey);
  }
}

export type IssuerFailureReason = 'issuer_not_found' | 'auth_required' | 'account_merged';

export interface IssuerVerificationResult {
  valid: boolean;
  reason?: IssuerFailureReason;
}

/**
 * Verifies that an issuer account exists on the Stellar network and checks
 * whether AUTH_REQUIRED_FLAG is set. Results are cached for 5 minutes.
 *
 * @param issuer - The issuer account public key
 * @param horizonUrl - Horizon base URL for the target network
 * @param requiresKyc - When true, fail if AUTH_REQUIRED_FLAG is not set
 */
export async function verifyIssuerExists(
  issuer: string,
  horizonUrl: string,
  requiresKyc = false,
): Promise<IssuerVerificationResult> {
  const cacheKey = `${horizonUrl}:${issuer}:${requiresKyc}`;
  const cached = issuerCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  const server = new Horizon.Server(horizonUrl);
  let result: IssuerVerificationResult;

  try {
    const account = await server.loadAccount(issuer);

    // AUTH_REQUIRED_FLAG = 1 on the Horizon flags object
    const authRequired = (account.flags as { auth_required?: boolean }).auth_required === true;
    if (requiresKyc && !authRequired) {
      result = { valid: false, reason: 'auth_required' };
    } else {
      result = { valid: true };
    }
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number }; name?: string })?.response?.status;
    if (status === 404) {
      result = { valid: false, reason: 'issuer_not_found' };
    } else if (status === 410) {
      // Horizon returns 410 Gone for merged accounts
      result = { valid: false, reason: 'account_merged' };
    } else {
      // Re-throw unexpected errors (network timeouts, etc.)
      throw err;
    }
  }

  // Evict the oldest entry first if we are at capacity.
  if (issuerCache.size >= MAX_ISSUER_CACHE_ENTRIES) {
    evictOldestIssuerEntry();
  }

  issuerCache.set(cacheKey, { result, expiresAt: Date.now() + ISSUER_CACHE_TTL_MS });
  return result;
}

/** Clears the issuer existence cache. Useful in tests. */
export function clearIssuerCache(): void {
  issuerCache.clear();
}

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
 * @param horizonUrl - Horizon base URL (required only if accountData is omitted; used to fetch account details)
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
  accountData?: Horizon.ServerApi.AccountRecord,
  horizonUrl?: string,
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

  // Fetch account data if not provided
  let resolvedAccountData = accountData;
  if (!resolvedAccountData && horizonUrl) {
    try {
      const server = new Horizon.Server(horizonUrl);
      resolvedAccountData = await server.loadAccount(accountId);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        return {
          valid: false,
          error: 'Account not found on Horizon',
        };
      }
      throw err;
    }
  }

  // Get account trustlines
  const trustlines = resolvedAccountData?.balances || [];
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
 * @param accountData - Account data from Horizon (optional, will fetch if not provided)
 * @param horizonUrl - Horizon base URL (required only if accountData is omitted)
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
  accountData?: Horizon.ServerApi.AccountRecord,
  horizonUrl?: string,
): Promise<TrustlineValidationResult> {
  // Fetch account data if not provided
  let resolvedAccountData = accountData;
  if (!resolvedAccountData && horizonUrl) {
    try {
      const server = new Horizon.Server(horizonUrl);
      resolvedAccountData = await server.loadAccount(accountId);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        return {
          valid: false,
          error: 'Account not found on Horizon',
        };
      }
      throw err;
    }
  }

  // Check capacity before validating existing trustlines so the capacity
  // error takes precedence when the account is at max and missing trustlines.
  if (resolvedAccountData) {
    const nonNative = assets.filter((a) => a.code !== 'XLM' && a.code !== 'native');
    const missingAssets = nonNative.filter(
      (asset) =>
        !(resolvedAccountData.balances as Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>).some(
          (b) => b.asset_type !== 'native' && b.asset_code === asset.code && b.asset_issuer === asset.issuer,
        ),
    );
    if (missingAssets.length > 0 && !canEstablishTrustlines(resolvedAccountData, missingAssets.length)) {
      return {
        valid: false,
        error: `Account has reached maximum trustline limit (${MAX_TRUSTLINES_PER_ACCOUNT})`,
        missingTrustlines: missingAssets.map((a) => ({
          asset: a.code,
          issuer: a.issuer,
          reason: 'Trustline does not exist',
        })),
      };
    }
  }

  const trustlineResult = await validateTrustlines(accountId, assets, resolvedAccountData, horizonUrl);
  return trustlineResult;
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
