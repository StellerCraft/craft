import { describe, it, expect } from 'vitest';

/**
 * Template Customization Validation Tests (#372)
 *
 * Verifies that the customization validator catches invalid configurations,
 * produces helpful error messages, handles boundary conditions, enforces
 * type validation, and validates nested configuration objects.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrandingConfig {
  appName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string;
  fontFamily?: string;
}

interface StellarConfig {
  network: 'mainnet' | 'testnet';
  horizonUrl: string;
  assetCode?: string;
  assetIssuer?: string;
}

interface FeaturesConfig {
  enableSwap: boolean;
  enableHistory: boolean;
  maxTransactionsPerPage: number;
  supportedPairs?: string[];
}

interface CustomizationConfig {
  branding: BrandingConfig;
  stellar: StellarConfig;
  features: FeaturesConfig;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ValidationError {
  field: string;
  message: string;
  code: string;
}

// ── CustomizationValidator ────────────────────────────────────────────────────

class CustomizationValidator {
  private readonly HEX_COLOR = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  private readonly URL_RE = /^https?:\/\/.+/;
  private readonly ASSET_CODE_RE = /^[A-Z0-9]{1,12}$/;
  private readonly STELLAR_KEY_RE = /^G[A-Z2-7]{55}$/;

  validate(config: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof config !== 'object' || config === null) {
      return { valid: false, errors: [{ field: 'root', message: 'Configuration must be an object', code: 'INVALID_TYPE' }] };
    }

    const cfg = config as Partial<CustomizationConfig>;
    this.validateBranding(cfg.branding, errors);
    this.validateStellar(cfg.stellar, errors);
    this.validateFeatures(cfg.features, errors);

    return { valid: errors.length === 0, errors };
  }

  private validateBranding(branding: unknown, errors: ValidationError[]): void {
    if (!branding || typeof branding !== 'object') {
      errors.push({ field: 'branding', message: 'Branding configuration is required', code: 'REQUIRED' });
      return;
    }
    const b = branding as Partial<BrandingConfig>;

    if (!b.appName || b.appName.trim().length === 0) {
      errors.push({ field: 'branding.appName', message: 'App name is required', code: 'REQUIRED' });
    } else if (b.appName.length > 50) {
      errors.push({ field: 'branding.appName', message: 'App name must be 50 characters or fewer', code: 'MAX_LENGTH' });
    }

    if (!b.primaryColor) {
      errors.push({ field: 'branding.primaryColor', message: 'Primary color is required', code: 'REQUIRED' });
    } else if (!this.HEX_COLOR.test(b.primaryColor)) {
      errors.push({ field: 'branding.primaryColor', message: 'Primary color must be a valid hex color (e.g. #FF5733)', code: 'INVALID_FORMAT' });
    }

    if (!b.secondaryColor) {
      errors.push({ field: 'branding.secondaryColor', message: 'Secondary color is required', code: 'REQUIRED' });
    } else if (!this.HEX_COLOR.test(b.secondaryColor)) {
      errors.push({ field: 'branding.secondaryColor', message: 'Secondary color must be a valid hex color', code: 'INVALID_FORMAT' });
    }

    if (b.logoUrl !== undefined && !this.URL_RE.test(b.logoUrl)) {
      errors.push({ field: 'branding.logoUrl', message: 'Logo URL must be a valid http/https URL', code: 'INVALID_FORMAT' });
    }
  }

  private validateStellar(stellar: unknown, errors: ValidationError[]): void {
    if (!stellar || typeof stellar !== 'object') {
      errors.push({ field: 'stellar', message: 'Stellar configuration is required', code: 'REQUIRED' });
      return;
    }
    const s = stellar as Partial<StellarConfig>;

    if (!s.network) {
      errors.push({ field: 'stellar.network', message: 'Network is required', code: 'REQUIRED' });
    } else if (!['mainnet', 'testnet'].includes(s.network)) {
      errors.push({ field: 'stellar.network', message: 'Network must be "mainnet" or "testnet"', code: 'INVALID_ENUM' });
    }

    if (!s.horizonUrl) {
      errors.push({ field: 'stellar.horizonUrl', message: 'Horizon URL is required', code: 'REQUIRED' });
    } else if (!this.URL_RE.test(s.horizonUrl)) {
      errors.push({ field: 'stellar.horizonUrl', message: 'Horizon URL must be a valid http/https URL', code: 'INVALID_FORMAT' });
    }

    if (s.assetCode !== undefined && !this.ASSET_CODE_RE.test(s.assetCode)) {
      errors.push({ field: 'stellar.assetCode', message: 'Asset code must be 1–12 uppercase alphanumeric characters', code: 'INVALID_FORMAT' });
    }

    if (s.assetIssuer !== undefined && !this.STELLAR_KEY_RE.test(s.assetIssuer)) {
      errors.push({ field: 'stellar.assetIssuer', message: 'Asset issuer must be a valid Stellar public key', code: 'INVALID_FORMAT' });
    }
  }

  private validateFeatures(features: unknown, errors: ValidationError[]): void {
    if (!features || typeof features !== 'object') {
      errors.push({ field: 'features', message: 'Features configuration is required', code: 'REQUIRED' });
      return;
    }
    const f = features as Partial<FeaturesConfig>;

    if (typeof f.enableSwap !== 'boolean') {
      errors.push({ field: 'features.enableSwap', message: 'enableSwap must be a boolean', code: 'INVALID_TYPE' });
    }

    if (typeof f.enableHistory !== 'boolean') {
      errors.push({ field: 'features.enableHistory', message: 'enableHistory must be a boolean', code: 'INVALID_TYPE' });
    }

    if (f.maxTransactionsPerPage === undefined) {
      errors.push({ field: 'features.maxTransactionsPerPage', message: 'maxTransactionsPerPage is required', code: 'REQUIRED' });
    } else if (typeof f.maxTransactionsPerPage !== 'number' || !Number.isInteger(f.maxTransactionsPerPage)) {
      errors.push({ field: 'features.maxTransactionsPerPage', message: 'maxTransactionsPerPage must be an integer', code: 'INVALID_TYPE' });
    } else if (f.maxTransactionsPerPage < 1) {
      errors.push({ field: 'features.maxTransactionsPerPage', message: 'maxTransactionsPerPage must be at least 1', code: 'MIN_VALUE' });
    } else if (f.maxTransactionsPerPage > 500) {
      errors.push({ field: 'features.maxTransactionsPerPage', message: 'maxTransactionsPerPage must be 500 or fewer', code: 'MAX_VALUE' });
    }

    if (f.supportedPairs !== undefined) {
      if (!Array.isArray(f.supportedPairs)) {
        errors.push({ field: 'features.supportedPairs', message: 'supportedPairs must be an array', code: 'INVALID_TYPE' });
      } else if (f.supportedPairs.length === 0) {
        errors.push({ field: 'features.supportedPairs', message: 'supportedPairs must not be empty when provided', code: 'MIN_ITEMS' });
      }
    }
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function validConfig(): CustomizationConfig {
  return {
    branding: {
      appName: 'My DEX',
      primaryColor: '#FF5733',
      secondaryColor: '#33FF57',
    },
    stellar: {
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
    },
    features: {
      enableSwap: true,
      enableHistory: false,
      maxTransactionsPerPage: 25,
    },
  };
}

const validator = new CustomizationValidator();

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Valid configuration', () => {
  it('accepts a fully valid configuration', () => {
    const result = validator.validate(validConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts optional logoUrl when valid', () => {
    const cfg = validConfig();
    cfg.branding.logoUrl = 'https://example.com/logo.png';
    expect(validator.validate(cfg).valid).toBe(true);
  });

  it('accepts optional assetCode when valid', () => {
    const cfg = validConfig();
    cfg.stellar.assetCode = 'USDC';
    expect(validator.validate(cfg).valid).toBe(true);
  });

  it('accepts optional supportedPairs when non-empty', () => {
    const cfg = validConfig();
    cfg.features.supportedPairs = ['XLM/USDC'];
    expect(validator.validate(cfg).valid).toBe(true);
  });
});

describe('Branding field validation', () => {
  it('rejects missing branding section', () => {
    const cfg = { ...validConfig(), branding: undefined } as unknown as CustomizationConfig;
    const result = validator.validate(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'branding' && e.code === 'REQUIRED')).toBe(true);
  });

  it('rejects empty appName', () => {
    const cfg = validConfig();
    cfg.branding.appName = '';
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'branding.appName')).toBe(true);
  });

  it('rejects appName exceeding 50 characters', () => {
    const cfg = validConfig();
    cfg.branding.appName = 'A'.repeat(51);
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'branding.appName' && e.code === 'MAX_LENGTH')).toBe(true);
  });

  it('accepts appName of exactly 50 characters', () => {
    const cfg = validConfig();
    cfg.branding.appName = 'A'.repeat(50);
    expect(validator.validate(cfg).valid).toBe(true);
  });

  it('rejects invalid hex primary color', () => {
    const cfg = validConfig();
    cfg.branding.primaryColor = 'red';
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'branding.primaryColor' && e.code === 'INVALID_FORMAT')).toBe(true);
  });

  it('error message for invalid color mentions hex format', () => {
    const cfg = validConfig();
    cfg.branding.primaryColor = 'not-a-color';
    const result = validator.validate(cfg);
    const err = result.errors.find((e) => e.field === 'branding.primaryColor');
    expect(err?.message).toMatch(/hex/i);
  });

  it('rejects invalid logoUrl', () => {
    const cfg = validConfig();
    cfg.branding.logoUrl = 'ftp://bad-url';
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'branding.logoUrl')).toBe(true);
  });

  it('accepts 3-digit hex color', () => {
    const cfg = validConfig();
    cfg.branding.primaryColor = '#F53';
    expect(validator.validate(cfg).valid).toBe(true);
  });
});

describe('Stellar field validation', () => {
  it('rejects missing stellar section', () => {
    const cfg = { ...validConfig(), stellar: undefined } as unknown as CustomizationConfig;
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'stellar' && e.code === 'REQUIRED')).toBe(true);
  });

  it('rejects invalid network value', () => {
    const cfg = validConfig();
    (cfg.stellar as unknown as Record<string, unknown>).network = 'devnet';
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'stellar.network' && e.code === 'INVALID_ENUM')).toBe(true);
  });

  it('error message for invalid network lists valid options', () => {
    const cfg = validConfig();
    (cfg.stellar as unknown as Record<string, unknown>).network = 'staging';
    const result = validator.validate(cfg);
    const err = result.errors.find((e) => e.field === 'stellar.network');
    expect(err?.message).toMatch(/mainnet|testnet/);
  });

  it('rejects non-URL horizonUrl', () => {
    const cfg = validConfig();
    cfg.stellar.horizonUrl = 'horizon.stellar.org'; // missing scheme
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'stellar.horizonUrl')).toBe(true);
  });

  it('rejects asset code with lowercase letters', () => {
    const cfg = validConfig();
    cfg.stellar.assetCode = 'usdc';
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'stellar.assetCode')).toBe(true);
  });

  it('rejects asset code longer than 12 characters', () => {
    const cfg = validConfig();
    cfg.stellar.assetCode = 'TOOLONGASSETCODE';
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'stellar.assetCode')).toBe(true);
  });

  it('rejects invalid Stellar public key as assetIssuer', () => {
    const cfg = validConfig();
    cfg.stellar.assetIssuer = 'NOTAVALIDKEY';
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'stellar.assetIssuer')).toBe(true);
  });
});

describe('Features field validation', () => {
  it('rejects missing features section', () => {
    const cfg = { ...validConfig(), features: undefined } as unknown as CustomizationConfig;
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'features' && e.code === 'REQUIRED')).toBe(true);
  });

  it('rejects non-boolean enableSwap', () => {
    const cfg = validConfig();
    (cfg.features as unknown as Record<string, unknown>).enableSwap = 'yes';
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'features.enableSwap' && e.code === 'INVALID_TYPE')).toBe(true);
  });

  it('rejects maxTransactionsPerPage below 1', () => {
    const cfg = validConfig();
    cfg.features.maxTransactionsPerPage = 0;
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'features.maxTransactionsPerPage' && e.code === 'MIN_VALUE')).toBe(true);
  });

  it('rejects maxTransactionsPerPage above 500', () => {
    const cfg = validConfig();
    cfg.features.maxTransactionsPerPage = 501;
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'features.maxTransactionsPerPage' && e.code === 'MAX_VALUE')).toBe(true);
  });

  it('accepts maxTransactionsPerPage at boundary value 1', () => {
    const cfg = validConfig();
    cfg.features.maxTransactionsPerPage = 1;
    expect(validator.validate(cfg).valid).toBe(true);
  });

  it('accepts maxTransactionsPerPage at boundary value 500', () => {
    const cfg = validConfig();
    cfg.features.maxTransactionsPerPage = 500;
    expect(validator.validate(cfg).valid).toBe(true);
  });

  it('rejects non-integer maxTransactionsPerPage', () => {
    const cfg = validConfig();
    cfg.features.maxTransactionsPerPage = 10.5;
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'features.maxTransactionsPerPage')).toBe(true);
  });

  it('rejects empty supportedPairs array', () => {
    const cfg = validConfig();
    cfg.features.supportedPairs = [];
    const result = validator.validate(cfg);
    expect(result.errors.some((e) => e.field === 'features.supportedPairs' && e.code === 'MIN_ITEMS')).toBe(true);
  });
});

describe('Type validation', () => {
  it('rejects null as configuration', () => {
    const result = validator.validate(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_TYPE');
  });

  it('rejects string as configuration', () => {
    const result = validator.validate('not-an-object');
    expect(result.valid).toBe(false);
  });

  it('rejects array as configuration', () => {
    const result = validator.validate([]);
    expect(result.valid).toBe(false);
  });

  it('collects multiple errors from multiple invalid fields', () => {
    const cfg = validConfig();
    cfg.branding.primaryColor = 'bad';
    cfg.stellar.horizonUrl = 'bad-url';
    cfg.features.maxTransactionsPerPage = -1;
    const result = validator.validate(cfg);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Nested configuration validation', () => {
  it('reports field path for nested branding errors', () => {
    const cfg = validConfig();
    cfg.branding.primaryColor = 'invalid';
    const result = validator.validate(cfg);
    expect(result.errors[0].field).toContain('branding.');
  });

  it('reports field path for nested stellar errors', () => {
    const cfg = validConfig();
    cfg.stellar.horizonUrl = 'bad';
    const result = validator.validate(cfg);
    expect(result.errors[0].field).toContain('stellar.');
  });

  it('reports field path for nested features errors', () => {
    const cfg = validConfig();
    cfg.features.maxTransactionsPerPage = 0;
    const result = validator.validate(cfg);
    expect(result.errors[0].field).toContain('features.');
  });

  it('each error has a non-empty message', () => {
    const cfg = validConfig();
    cfg.branding.appName = '';
    cfg.stellar.horizonUrl = 'bad';
    const result = validator.validate(cfg);
    for (const err of result.errors) {
      expect(err.message.length).toBeGreaterThan(0);
    }
  });

  it('each error has a non-empty code', () => {
    const cfg = validConfig();
    cfg.branding.appName = '';
    const result = validator.validate(cfg);
    for (const err of result.errors) {
      expect(err.code.length).toBeGreaterThan(0);
    }
  });
});
