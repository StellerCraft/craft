import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkAssetCompliance, loadComplianceConfig } from './asset-compliance';
import type { ComplianceConfig } from './asset-compliance';

const ISSUER_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const ISSUER_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBTFC';

const baseConfig: ComplianceConfig = {
  blocklist: [{ issuer: ISSUER_A, reason: 'Sanctioned entity' }],
  jurisdictionRules: [{ jurisdiction: 'US', blockedAssets: ['TOKEN'] }],
};

describe('checkAssetCompliance', () => {
  it('canDeploy is always true', () => {
    const result = checkAssetCompliance('TOKEN', ISSUER_A, baseConfig);
    expect(result.canDeploy).toBe(true);
  });

  it('returns no warnings for a clean asset', () => {
    const result = checkAssetCompliance('USDC', ISSUER_B, baseConfig);
    expect(result.warnings).toHaveLength(0);
    expect(result.envVars).toEqual({});
  });

  it('flags blocked issuer', () => {
    const result = checkAssetCompliance('USDC', ISSUER_A, baseConfig);
    expect(result.warnings.some((w) => w.flag === 'COMPLIANCE_ISSUER_BLOCKED')).toBe(true);
    expect(result.envVars.COMPLIANCE_ISSUER_BLOCKED).toBe('true');
  });

  it('flags KYC required when issuer is blocked', () => {
    const result = checkAssetCompliance('USDC', ISSUER_A, baseConfig);
    expect(result.envVars.COMPLIANCE_KYC_REQUIRED).toBe('true');
  });

  it('flags jurisdiction restriction for blocked asset code', () => {
    const result = checkAssetCompliance('TOKEN', ISSUER_B, baseConfig);
    expect(result.warnings.some((w) => w.flag === 'COMPLIANCE_JURISDICTION_RESTRICTED')).toBe(true);
    expect(result.envVars.COMPLIANCE_JURISDICTION_RESTRICTED).toBe('true');
    expect(result.envVars.COMPLIANCE_RESTRICTED_JURISDICTIONS).toBe('US');
  });

  it('lists all restricted jurisdictions comma-separated', () => {
    const config: ComplianceConfig = {
      blocklist: [],
      jurisdictionRules: [
        { jurisdiction: 'US', blockedAssets: ['TOKEN'] },
        { jurisdiction: 'CN', blockedAssets: ['TOKEN'] },
      ],
    };
    const result = checkAssetCompliance('TOKEN', ISSUER_B, config);
    const jurisdictions = result.envVars.COMPLIANCE_RESTRICTED_JURISDICTIONS!.split(',');
    expect(jurisdictions).toContain('US');
    expect(jurisdictions).toContain('CN');
  });

  it('is case-insensitive for asset code', () => {
    const result = checkAssetCompliance('token', ISSUER_B, baseConfig);
    expect(result.warnings.some((w) => w.flag === 'COMPLIANCE_JURISDICTION_RESTRICTED')).toBe(true);
  });

  it('is case-insensitive for issuer address', () => {
    const result = checkAssetCompliance('USDC', ISSUER_A.toLowerCase(), baseConfig);
    expect(result.envVars.COMPLIANCE_ISSUER_BLOCKED).toBe('true');
  });

  it('sets KYC required when jurisdiction restriction triggers', () => {
    const result = checkAssetCompliance('TOKEN', ISSUER_B, baseConfig);
    expect(result.envVars.COMPLIANCE_KYC_REQUIRED).toBe('true');
  });

  it('does not set KYC when no issues', () => {
    const result = checkAssetCompliance('USDC', ISSUER_B, baseConfig);
    expect(result.envVars.COMPLIANCE_KYC_REQUIRED).toBeUndefined();
  });

  it('accumulates both issuer and jurisdiction warnings', () => {
    const result = checkAssetCompliance('TOKEN', ISSUER_A, baseConfig);
    const flags = result.warnings.map((w) => w.flag);
    expect(flags).toContain('COMPLIANCE_ISSUER_BLOCKED');
    expect(flags).toContain('COMPLIANCE_JURISDICTION_RESTRICTED');
  });

  it('works with empty config (no blocklist, no rules)', () => {
    const result = checkAssetCompliance('TOKEN', ISSUER_A, { blocklist: [], jurisdictionRules: [] });
    expect(result.canDeploy).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('loadComplianceConfig', () => {
  it('returns empty lists when no override and no env vars', () => {
    const config = loadComplianceConfig({ blocklist: [], jurisdictionRules: [] });
    expect(config.blocklist).toEqual([]);
    expect(config.jurisdictionRules).toEqual([]);
  });

  it('uses provided override directly', () => {
    const config = loadComplianceConfig(baseConfig);
    expect(config.blocklist).toHaveLength(1);
    expect(config.jurisdictionRules).toHaveLength(1);
  });
});

describe('loadComplianceConfig — malformed env var diagnostics', () => {
  const originalBlocklist = process.env.COMPLIANCE_BLOCKLIST_JSON;
  const originalJurisdiction = process.env.COMPLIANCE_JURISDICTION_JSON;

  afterEach(() => {
    if (originalBlocklist === undefined) delete process.env.COMPLIANCE_BLOCKLIST_JSON;
    else process.env.COMPLIANCE_BLOCKLIST_JSON = originalBlocklist;
    if (originalJurisdiction === undefined) delete process.env.COMPLIANCE_JURISDICTION_JSON;
    else process.env.COMPLIANCE_JURISDICTION_JSON = originalJurisdiction;
    vi.restoreAllMocks();
  });

  it('logs a warning naming the offending variable while still returning an empty blocklist', () => {
    process.env.COMPLIANCE_BLOCKLIST_JSON = '[{ "issuer": "GABC", }]'; // trailing comma → invalid JSON
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = loadComplianceConfig();

    expect(config.blocklist).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('COMPLIANCE_BLOCKLIST_JSON');
  });

  it('logs a warning for a malformed COMPLIANCE_JURISDICTION_JSON and falls back to empty rules', () => {
    process.env.COMPLIANCE_JURISDICTION_JSON = '{ not valid json';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = loadComplianceConfig();

    expect(config.jurisdictionRules).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('COMPLIANCE_JURISDICTION_JSON');
  });

  it('does not log when the env vars are absent or valid', () => {
    delete process.env.COMPLIANCE_BLOCKLIST_JSON;
    process.env.COMPLIANCE_JURISDICTION_JSON = '[{"jurisdiction":"US","blockedAssets":["TOKEN"]}]';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = loadComplianceConfig();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(config.jurisdictionRules).toHaveLength(1);
  });
});
