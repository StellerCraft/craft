/**
 * Stellar Asset Compliance Checking Service (#777)
 *
 * Verifies assets against a configurable blocklist and propagates compliance
 * flags (KYC required, restricted jurisdiction) to generated template
 * environment variables.
 *
 * Flag propagation never blocks deployment — violations are recorded as
 * deployment log warnings only.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlocklistEntry {
  /** Stellar account ID (G...) of the asset issuer. */
  issuer: string;
  reason: string;
}

export interface JurisdictionRule {
  /** ISO 3166-1 alpha-2 country code, e.g. "US", "CN". */
  jurisdiction: string;
  /** Asset codes blocked in this jurisdiction, e.g. ["TOKEN", "XYZ"]. */
  blockedAssets: string[];
}

export interface ComplianceConfig {
  blocklist: BlocklistEntry[];
  jurisdictionRules: JurisdictionRule[];
}

export type ComplianceFlagKey =
  | 'COMPLIANCE_KYC_REQUIRED'
  | 'COMPLIANCE_ISSUER_BLOCKED'
  | 'COMPLIANCE_JURISDICTION_RESTRICTED'
  | 'COMPLIANCE_RESTRICTED_JURISDICTIONS';

/** Environment variables propagated to the generated template configuration. */
export type ComplianceEnvVars = Partial<Record<ComplianceFlagKey, string>>;

export interface ComplianceWarning {
  flag: ComplianceFlagKey;
  message: string;
}

export interface ComplianceCheckResult {
  /** Always true — compliance issues are warnings, not deployment blockers. */
  canDeploy: boolean;
  warnings: ComplianceWarning[];
  /** Variables to merge into the deployment environment. */
  envVars: ComplianceEnvVars;
}

// ---------------------------------------------------------------------------
// Default config loader (override in tests or provide your own)
// ---------------------------------------------------------------------------

/**
 * Load compliance config from the environment or a provided source.
 *
 * In production the blocklist and jurisdiction rules live in Supabase and
 * are injected via `COMPLIANCE_BLOCKLIST_JSON` / `COMPLIANCE_JURISDICTION_JSON`
 * environment variables (serialised JSON arrays).
 */
/**
 * Emit a warning-level log identifying a compliance env var that failed to
 * parse. The caller still falls back to an empty list, so this is the only
 * signal that compliance checks have been silently degraded by a bad config.
 */
function warnMalformedConfig(envVar: string, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(
    `[asset-compliance] Failed to parse ${envVar}: ${reason}. ` +
      `Falling back to an empty list — compliance checks relying on this ` +
      `variable are now disabled until the configuration is fixed.`,
  );
}

export function loadComplianceConfig(override?: Partial<ComplianceConfig>): ComplianceConfig {
  let blocklist: BlocklistEntry[] = override?.blocklist ?? [];
  let jurisdictionRules: JurisdictionRule[] = override?.jurisdictionRules ?? [];

  if (!override?.blocklist) {
    try {
      const raw = process.env.COMPLIANCE_BLOCKLIST_JSON;
      if (raw) blocklist = JSON.parse(raw) as BlocklistEntry[];
    } catch (error) {
      // Malformed env var — fall back to an empty blocklist so a config typo
      // does not block deployments, but make the failure observable: a silent
      // fallback here disables issuer compliance checks platform-wide with no
      // diagnostic signal.
      warnMalformedConfig('COMPLIANCE_BLOCKLIST_JSON', error);
    }
  }

  if (!override?.jurisdictionRules) {
    try {
      const raw = process.env.COMPLIANCE_JURISDICTION_JSON;
      if (raw) jurisdictionRules = JSON.parse(raw) as JurisdictionRule[];
    } catch (error) {
      // Malformed env var — fall back to empty rules (see note above).
      warnMalformedConfig('COMPLIANCE_JURISDICTION_JSON', error);
    }
  }

  return { blocklist, jurisdictionRules };
}

// ---------------------------------------------------------------------------
// Core compliance check
// ---------------------------------------------------------------------------

/**
 * Run compliance checks for a Stellar asset before template generation.
 *
 * Checks performed:
 * 1. Issuer blocklist — flags `COMPLIANCE_ISSUER_BLOCKED`
 * 2. Jurisdiction restrictions — flags `COMPLIANCE_JURISDICTION_RESTRICTED`
 *    and `COMPLIANCE_RESTRICTED_JURISDICTIONS`
 * 3. KYC requirement — flags `COMPLIANCE_KYC_REQUIRED` when either of the
 *    above triggers (i.e. a restricted asset always requires KYC)
 *
 * All flags are propagated as environment variables and recorded as deployment
 * log warnings. Deployment is never blocked.
 *
 * @param assetCode   - Stellar asset code, e.g. "USDC"
 * @param issuer      - Issuer G-address
 * @param config      - Compliance config (defaults to env-loaded config)
 * @returns           Check result with `canDeploy: true`, warnings, and envVars
 *
 * @example
 * ```typescript
 * const result = checkAssetCompliance('TOKEN', 'GABC...', config);
 * // Merge envVars into deployment environment
 * Object.assign(deploymentEnv, result.envVars);
 * // Write warnings to deployment log
 * result.warnings.forEach(w => log.warn(w.message));
 * ```
 */
export function checkAssetCompliance(
  assetCode: string,
  issuer: string,
  config?: Partial<ComplianceConfig>,
): ComplianceCheckResult {
  const { blocklist, jurisdictionRules } = loadComplianceConfig(config);

  const warnings: ComplianceWarning[] = [];
  const envVars: ComplianceEnvVars = {};

  // 1. Issuer blocklist check
  const blockEntry = blocklist.find(
    (e) => e.issuer.toLowerCase() === issuer.toLowerCase(),
  );
  if (blockEntry) {
    warnings.push({
      flag: 'COMPLIANCE_ISSUER_BLOCKED',
      message: `Asset issuer ${issuer} is on the compliance blocklist: ${blockEntry.reason}`,
    });
    envVars.COMPLIANCE_ISSUER_BLOCKED = 'true';
  }

  // 2. Jurisdiction restriction check
  const restrictedIn: string[] = [];
  for (const rule of jurisdictionRules) {
    if (rule.blockedAssets.some((a) => a.toUpperCase() === assetCode.toUpperCase())) {
      restrictedIn.push(rule.jurisdiction);
    }
  }
  if (restrictedIn.length > 0) {
    warnings.push({
      flag: 'COMPLIANCE_JURISDICTION_RESTRICTED',
      message: `Asset ${assetCode} is restricted in jurisdictions: ${restrictedIn.join(', ')}`,
    });
    envVars.COMPLIANCE_JURISDICTION_RESTRICTED = 'true';
    envVars.COMPLIANCE_RESTRICTED_JURISDICTIONS = restrictedIn.join(',');
  }

  // 3. KYC flag — required whenever any compliance issue is present
  if (warnings.length > 0) {
    envVars.COMPLIANCE_KYC_REQUIRED = 'true';
  }

  return {
    canDeploy: true, // never blocks deployment
    warnings,
    envVars,
  };
}
