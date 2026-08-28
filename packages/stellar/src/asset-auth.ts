/**
 * Stellar Asset Issuance Authorization Flag Validation
 *
 * Validates authorization flag combinations for Stellar asset issuance,
 * ensuring that authorization settings are consistent and valid.
 *
 * Authorization Flags:
 * - AUTH_REQUIRED: Requires authorization for accounts to hold the asset
 * - AUTH_REVOCABLE: Allows issuer to revoke authorization
 * - AUTH_IMMUTABLE: Makes authorization settings permanent (cannot be changed)
 *
 * Flag Rules:
 * - AUTH_IMMUTABLE conflicts with AUTH_REVOCABLE (cannot be both immutable and revocable)
 * - AUTH_REVOCABLE requires AUTH_REQUIRED (cannot revoke if authorization not required)
 * - Once AUTH_IMMUTABLE is set, no flags can be changed
 *
 * @see https://developers.stellar.org/docs/learn/glossary#authorization-flags
 */

/** AUTH_REQUIRED flag bitmask (bit 0). Requires authorization to hold the asset. */
export const AUTH_REQUIRED_FLAG = 1;

/** AUTH_REVOCABLE flag bitmask (bit 1). Allows revoking authorization. */
export const AUTH_REVOCABLE_FLAG = 2;

/** AUTH_IMMUTABLE flag bitmask (bit 2). Makes flags permanent and unchangeable. */
export const AUTH_IMMUTABLE_FLAG = 4;

export interface AssetAuthorizationFlags {
  authRequired?: boolean;
  authRevocable?: boolean;
  authImmutable?: boolean;
}

export interface AuthorizationValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

/**
 * Validates asset authorization flag combinations.
 *
 * @param flags - Authorization flags to validate
 * @returns Validation result with errors and warnings
 *
 * @example
 * ```typescript
 * const result = validateAuthorizationFlags({
 *   authRequired: true,
 *   authRevocable: true,
 *   authImmutable: false
 * });
 * if (!result.valid) {
 *   console.error('Invalid flags:', result.errors);
 * }
 * ```
 */
export function validateAuthorizationFlags(
  flags: AssetAuthorizationFlags
): AuthorizationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const { authRequired, authRevocable, authImmutable } = flags;

  // Rule 1: AUTH_IMMUTABLE conflicts with AUTH_REVOCABLE
  if (authImmutable && authRevocable) {
    errors.push(
      'AUTH_IMMUTABLE and AUTH_REVOCABLE cannot both be enabled. ' +
      'An immutable asset cannot have revocable authorization.'
    );
  }

  // Rule 2: AUTH_REVOCABLE requires AUTH_REQUIRED
  if (authRevocable && !authRequired) {
    errors.push(
      'AUTH_REVOCABLE requires AUTH_REQUIRED to be enabled. ' +
      'Cannot revoke authorization if authorization is not required.'
    );
  }

  // Warning: AUTH_IMMUTABLE makes settings permanent
  if (authImmutable) {
    warnings.push(
      'AUTH_IMMUTABLE makes authorization settings permanent. ' +
      'Once set, flags cannot be changed. Ensure this is intended.'
    );
  }

  // Warning: AUTH_REQUIRED without AUTH_REVOCABLE
  if (authRequired && !authRevocable && !authImmutable) {
    warnings.push(
      'AUTH_REQUIRED is enabled without AUTH_REVOCABLE. ' +
      'Consider if you need the ability to revoke authorization in the future.'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Validates authorization flags and throws if invalid.
 *
 * @param flags - Authorization flags to validate
 * @throws Error if flags are invalid
 *
 * @example
 * ```typescript
 * try {
 *   assertValidAuthorizationFlags({ authImmutable: true, authRevocable: true });
 * } catch (error) {
 *   console.error('Invalid configuration:', error.message);
 * }
 * ```
 */
export function assertValidAuthorizationFlags(
  flags: AssetAuthorizationFlags
): void {
  const result = validateAuthorizationFlags(flags);
  
  if (!result.valid) {
    throw new Error(
      `Invalid asset authorization flags:\n${result.errors.join('\n')}`
    );
  }
}

/**
 * Gets a human-readable description of authorization flag combination.
 *
 * @param flags - Authorization flags to describe
 * @returns Description of the authorization configuration
 *
 * @example
 * ```typescript
 * const desc = describeAuthorizationFlags({
 *   authRequired: true,
 *   authRevocable: false,
 *   authImmutable: true
 * });
 * console.log(desc);
 * // "Authorization required, not revocable, immutable (permanent)"
 * ```
 */
export function describeAuthorizationFlags(
  flags: AssetAuthorizationFlags
): string {
  const parts: string[] = [];

  if (flags.authRequired) {
    parts.push('authorization required');
  } else {
    parts.push('no authorization required');
  }

  if (flags.authRevocable) {
    parts.push('revocable');
  } else if (flags.authRequired) {
    parts.push('not revocable');
  }

  if (flags.authImmutable) {
    parts.push('immutable (permanent)');
  }

  return parts.join(', ').replace(/^./, str => str.toUpperCase());
}

/**
 * Checks if authorization flags represent a locked/immutable configuration.
 *
 * @param flags - Authorization flags to check
 * @returns True if configuration is immutable
 */
export function isImmutableConfiguration(
  flags: AssetAuthorizationFlags
): boolean {
  return flags.authImmutable === true;
}

/**
 * Checks if authorization flags allow the issuer to control access.
 *
 * @param flags - Authorization flags to check
 * @returns True if issuer has control over who can hold the asset
 */
export function hasIssuerControl(
  flags: AssetAuthorizationFlags
): boolean {
  return flags.authRequired === true;
}

/**
 * Checks if authorization flags allow the issuer to revoke access.
 *
 * @param flags - Authorization flags to check
 * @returns True if issuer can revoke authorization
 */
export function canRevokeAuthorization(
  flags: AssetAuthorizationFlags
): boolean {
  return flags.authRequired === true && flags.authRevocable === true;
}

/**
 * Converts AssetAuthorizationFlags to a numeric bitmask for Stellar operations.
 *
 * The bitmask is used in Operation.setOptions({ setFlags / clearFlags }) and
 * corresponds to the numeric flags returned by Horizon's account flags object.
 *
 * @param flags - Authorization flags to convert
 * @returns Numeric bitmask combining AUTH_REQUIRED_FLAG, AUTH_REVOCABLE_FLAG, and AUTH_IMMUTABLE_FLAG
 *
 * @example
 * ```typescript
 * const flags = { authRequired: true, authRevocable: true };
 * const bitmask = toAuthFlagsBitmask(flags); // 3
 * ```
 */
export function toAuthFlagsBitmask(flags: AssetAuthorizationFlags): number {
  let bitmask = 0;
  if (flags.authRequired) bitmask |= AUTH_REQUIRED_FLAG;
  if (flags.authRevocable) bitmask |= AUTH_REVOCABLE_FLAG;
  if (flags.authImmutable) bitmask |= AUTH_IMMUTABLE_FLAG;
  return bitmask;
}

/**
 * Converts a numeric bitmask back to AssetAuthorizationFlags.
 *
 * This is the inverse of toAuthFlagsBitmask and is used to parse account flags
 * from Horizon responses into the boolean shape used by this module.
 *
 * @param bitmask - Numeric flag bitmask from Horizon or Operation.setOptions
 * @returns Authorization flags object with boolean fields
 *
 * @example
 * ```typescript
 * const flags = fromAuthFlagsBitmask(3); // { authRequired: true, authRevocable: true }
 * ```
 */
export function fromAuthFlagsBitmask(bitmask: number): AssetAuthorizationFlags {
  return {
    authRequired: (bitmask & AUTH_REQUIRED_FLAG) !== 0,
    authRevocable: (bitmask & AUTH_REVOCABLE_FLAG) !== 0,
    authImmutable: (bitmask & AUTH_IMMUTABLE_FLAG) !== 0,
  };
}
