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

// ── Issue #1126 – malformed env var parsing and override precedence ──────────

describe('loadComplianceConfig — independent malformed env var handling (#1126)', () => {
  const originalBlocklist = process.env.COMPLIANCE_BLOCKLIST_JSON;
  const originalJurisdiction = process.env.COMPLIANCE_JURISDICTION_JSON;

  afterEach(() => {
    if (originalBlocklist === undefined) delete process.env.COMPLIANCE_BLOCKLIST_JSON;
    else process.env.COMPLIANCE_BLOCKLIST_JSON = originalBlocklist;
    if (originalJurisdiction === undefined) delete process.env.COMPLIANCE_JURISDICTION_JSON;
    else process.env.COMPLIANCE_JURISDICTION_JSON = originalJurisdiction;
    vi.restoreAllMocks();
  });

  it('returns empty blocklist for malformed COMPLIANCE_BLOCKLIST_JSON while preserving valid COMPLIANCE_JURISDICTION_JSON', () => {
    process.env.COMPLIANCE_BLOCKLIST_JSON = '[{ invalid json }]';
    process.env.COMPLIANCE_JURISDICTION_JSON = '[{"jurisdiction":"US","blockedAssets":["TOKEN"]}]';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = loadComplianceConfig();

    expect(config.blocklist).toEqual([]);
    expect(config.jurisdictionRules).toHaveLength(1);
    expect(config.jurisdictionRules[0].jurisdiction).toBe('US');
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('COMPLIANCE_BLOCKLIST_JSON');
  });

  it('returns empty jurisdictionRules for malformed COMPLIANCE_JURISDICTION_JSON while preserving valid COMPLIANCE_BLOCKLIST_JSON', () => {
    process.env.COMPLIANCE_BLOCKLIST_JSON = '[{"issuer":"GABC","reason":"Test"}]';
    process.env.COMPLIANCE_JURISDICTION_JSON = 'not a json array at all';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = loadComplianceConfig();

    expect(config.blocklist).toHaveLength(1);
    expect(config.blocklist[0].issuer).toBe('GABC');
    expect(config.jurisdictionRules).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('COMPLIANCE_JURISDICTION_JSON');
  });

  it('returns empty lists when both env vars are malformed', () => {
    process.env.COMPLIANCE_BLOCKLIST_JSON = '[{ malformed }]';
    process.env.COMPLIANCE_JURISDICTION_JSON = '{ also malformed }';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = loadComplianceConfig();

    expect(config.blocklist).toEqual([]);
    expect(config.jurisdictionRules).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('logs separate warnings for each malformed variable', () => {
    process.env.COMPLIANCE_BLOCKLIST_JSON = '[{ bad }]';
    process.env.COMPLIANCE_JURISDICTION_JSON = '{ bad }';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const config = loadComplianceConfig();

    expect(warnSpy).toHaveBeenCalledTimes(2);
    const calls = warnSpy.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain('COMPLIANCE_BLOCKLIST_JSON');
    expect(calls[1]).toContain('COMPLIANCE_JURISDICTION_JSON');
  });
});

describe('loadComplianceConfig — override precedence (#1126)', () => {
  const originalBlocklist = process.env.COMPLIANCE_BLOCKLIST_JSON;
  const originalJurisdiction = process.env.COMPLIANCE_JURISDICTION_JSON;

  afterEach(() => {
    if (originalBlocklist === undefined) delete process.env.COMPLIANCE_BLOCKLIST_JSON;
    else process.env.COMPLIANCE_BLOCKLIST_JSON = originalBlocklist;
    if (originalJurisdiction === undefined) delete process.env.COMPLIANCE_JURISDICTION_JSON;
    else process.env.COMPLIANCE_JURISDICTION_JSON = originalJurisdiction;
    vi.restoreAllMocks();
  });

  it('override parameter takes complete precedence over env vars for blocklist', () => {
    process.env.COMPLIANCE_BLOCKLIST_JSON = '[{"issuer":"GENV","reason":"From env"}]';
    const overriddenBlocklist = [{ issuer: 'GOVERIDE', reason: 'From override' }];

    const config = loadComplianceConfig({ blocklist: overriddenBlocklist });

    expect(config.blocklist).toHaveLength(1);
    expect(config.blocklist[0].issuer).toBe('GOVERIDE');
    expect(config.blocklist[0].reason).toBe('From override');
  });

  it('override parameter takes complete precedence over env vars for jurisdictionRules', () => {
    process.env.COMPLIANCE_JURISDICTION_JSON = '[{"jurisdiction":"US","blockedAssets":["TOKEN1"]}]';
    const overriddenRules = [{ jurisdiction: 'CN', blockedAssets: ['TOKEN2', 'TOKEN3'] }];

    const config = loadComplianceConfig({ jurisdictionRules: overriddenRules });

    expect(config.jurisdictionRules).toHaveLength(1);
    expect(config.jurisdictionRules[0].jurisdiction).toBe('CN');
    expect(config.jurisdictionRules[0].blockedAssets).toEqual(['TOKEN2', 'TOKEN3']);
  });

  it('override blocklist with malformed COMPLIANCE_JURISDICTION_JSON still loads and warns', () => {
    process.env.COMPLIANCE_JURISDICTION_JSON = '[{ bad }]';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overriddenBlocklist = [{ issuer: 'GOVERIDE', reason: 'Test' }];

    const config = loadComplianceConfig({
      blocklist: overriddenBlocklist,
    });

    expect(config.blocklist).toEqual(overriddenBlocklist);
    expect(config.jurisdictionRules).toEqual([]);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('COMPLIANCE_JURISDICTION_JSON');
  });

  it('override jurisdictionRules with malformed COMPLIANCE_BLOCKLIST_JSON still loads and warns', () => {
    process.env.COMPLIANCE_BLOCKLIST_JSON = '{ bad }';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const overriddenRules = [{ jurisdiction: 'US', blockedAssets: ['TOKEN'] }];

    const config = loadComplianceConfig({
      jurisdictionRules: overriddenRules,
    });

    expect(config.blocklist).toEqual([]);
    expect(config.jurisdictionRules).toEqual(overriddenRules);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toContain('COMPLIANCE_BLOCKLIST_JSON');
  });

  it('override takes precedence even when all env vars are valid', () => {
    process.env.COMPLIANCE_BLOCKLIST_JSON = '[{"issuer":"GENV","reason":"Env"}]';
    process.env.COMPLIANCE_JURISDICTION_JSON = '[{"jurisdiction":"US","blockedAssets":["ENV_TOKEN"]}]';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const overriddenBlocklist = [{ issuer: 'GOVERIDE', reason: 'Override' }];
    const overriddenRules = [{ jurisdiction: 'CN', blockedAssets: ['OVERRIDE_TOKEN'] }];

    const config = loadComplianceConfig({
      blocklist: overriddenBlocklist,
      jurisdictionRules: overriddenRules,
    });

    expect(config.blocklist).toEqual(overriddenBlocklist);
    expect(config.jurisdictionRules).toEqual(overriddenRules);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
