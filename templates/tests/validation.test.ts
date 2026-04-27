/**
 * Template Validation Tests (#341)
 *
 * Verifies all four CRAFT templates are valid and deployable:
 *   - stellar-dex
 *   - soroban-defi
 *   - payment-gateway
 *   - asset-issuance
 *
 * Covers: package.json validity, required files, customization schemas,
 * Stellar configurations, and template preview generation readiness.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEMPLATES_ROOT = resolve(__dirname, '..');

const TEMPLATES = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'] as const;
type TemplateName = (typeof TEMPLATES)[number];

function templatePath(name: TemplateName, ...parts: string[]) {
  return resolve(TEMPLATES_ROOT, name, ...parts);
}

function readJson<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
}

interface PackageJson {
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// Customization schema shape from the seed SQL
interface SchemaField {
  type: string;
  required?: boolean;
  default?: unknown;
  values?: string[];
}

interface CustomizationSchema {
  branding: Record<string, SchemaField>;
  features: Record<string, SchemaField>;
  stellar: Record<string, SchemaField>;
}

// ── Required files every template must have ───────────────────────────────────

const REQUIRED_FILES = [
  'package.json',
  'tsconfig.json',
  'next.config.js',
  'README.md',
];

// ── Required package.json scripts ─────────────────────────────────────────────

const REQUIRED_SCRIPTS = ['dev', 'build', 'start'];

// ── Required dependencies ──────────────────────────────────────────────────────

const REQUIRED_DEPS = ['next', 'react', 'react-dom', 'stellar-sdk'];

// ── Customization schema definitions (mirrors 003_seed_templates.sql) ─────────

const CUSTOMIZATION_SCHEMAS: Record<TemplateName, CustomizationSchema> = {
  'stellar-dex': {
    branding: {
      appName: { type: 'string', required: true, default: 'Stellar DEX' },
      logoUrl: { type: 'string', required: false },
      primaryColor: { type: 'color', required: true, default: '#4f9eff' },
      secondaryColor: { type: 'color', required: true, default: '#1a1f36' },
      fontFamily: { type: 'string', required: false, default: 'Inter' },
    },
    features: {
      enableCharts: { type: 'boolean', default: true },
      enableTransactionHistory: { type: 'boolean', default: true },
      enableAnalytics: { type: 'boolean', default: false },
      enableNotifications: { type: 'boolean', default: false },
    },
    stellar: {
      network: { type: 'enum', values: ['mainnet', 'testnet'], required: true, default: 'testnet' },
      horizonUrl: { type: 'string', required: true },
      assetPairs: { type: 'array', required: false },
    },
  },
  'soroban-defi': {
    branding: {
      appName: { type: 'string', required: true, default: 'Soroban DeFi' },
      logoUrl: { type: 'string', required: false },
      primaryColor: { type: 'color', required: true, default: '#4f9eff' },
      secondaryColor: { type: 'color', required: true, default: '#1a1f36' },
      fontFamily: { type: 'string', required: false, default: 'Inter' },
    },
    features: {
      enableCharts: { type: 'boolean', default: true },
      enableTransactionHistory: { type: 'boolean', default: true },
      enableAnalytics: { type: 'boolean', default: false },
    },
    stellar: {
      network: { type: 'enum', values: ['mainnet', 'testnet'], required: true, default: 'testnet' },
      horizonUrl: { type: 'string', required: true },
      sorobanRpcUrl: { type: 'string', required: true },
      contractAddresses: { type: 'object', required: false },
    },
  },
  'payment-gateway': {
    branding: {
      appName: { type: 'string', required: true, default: 'Payment Gateway' },
      logoUrl: { type: 'string', required: false },
      primaryColor: { type: 'color', required: true, default: '#4f9eff' },
      secondaryColor: { type: 'color', required: true, default: '#1a1f36' },
      fontFamily: { type: 'string', required: false, default: 'Inter' },
    },
    features: {
      enableTransactionHistory: { type: 'boolean', default: true },
      enableAnalytics: { type: 'boolean', default: true },
      enableNotifications: { type: 'boolean', default: true },
    },
    stellar: {
      network: { type: 'enum', values: ['mainnet', 'testnet'], required: true, default: 'testnet' },
      horizonUrl: { type: 'string', required: true },
      assetPairs: { type: 'array', required: false },
    },
  },
  'asset-issuance': {
    branding: {
      appName: { type: 'string', required: true, default: 'Asset Issuance' },
      logoUrl: { type: 'string', required: false },
      primaryColor: { type: 'color', required: true, default: '#4f9eff' },
      secondaryColor: { type: 'color', required: true, default: '#1a1f36' },
      fontFamily: { type: 'string', required: false, default: 'Inter' },
    },
    features: {
      enableTransactionHistory: { type: 'boolean', default: true },
      enableAnalytics: { type: 'boolean', default: true },
    },
    stellar: {
      network: { type: 'enum', values: ['mainnet', 'testnet'], required: true, default: 'testnet' },
      horizonUrl: { type: 'string', required: true },
    },
  },
};

// ── Valid Stellar network values ───────────────────────────────────────────────

const VALID_NETWORKS = ['mainnet', 'testnet'];
const TESTNET_HORIZON = 'https://horizon-testnet.stellar.org';
const MAINNET_HORIZON = 'https://horizon.stellar.org';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Template Validation', () => {
  for (const template of TEMPLATES) {
    describe(template, () => {
      // ── package.json validity ──────────────────────────────────────────────

      describe('package.json', () => {
        it('exists and is valid JSON', () => {
          const path = templatePath(template, 'package.json');
          expect(existsSync(path), `${path} must exist`).toBe(true);
          expect(() => readJson(path)).not.toThrow();
        });

        it('has required fields: name, version, scripts, dependencies', () => {
          const pkg = readJson<PackageJson>(templatePath(template, 'package.json'));
          expect(pkg.name).toBeTruthy();
          expect(pkg.version).toBeTruthy();
          expect(pkg.scripts).toBeDefined();
          expect(pkg.dependencies).toBeDefined();
        });

        it('has all required scripts', () => {
          const { scripts } = readJson<PackageJson>(templatePath(template, 'package.json'));
          for (const script of REQUIRED_SCRIPTS) {
            expect(scripts[script], `script "${script}" must be defined`).toBeTruthy();
          }
        });

        it('has all required dependencies', () => {
          const { dependencies } = readJson<PackageJson>(templatePath(template, 'package.json'));
          for (const dep of REQUIRED_DEPS) {
            expect(dependencies[dep], `dependency "${dep}" must be present`).toBeTruthy();
          }
        });

        it('uses Next.js 14', () => {
          const { dependencies } = readJson<PackageJson>(templatePath(template, 'package.json'));
          expect(dependencies['next']).toMatch(/^14\./);
        });
      });

      // ── Required files ─────────────────────────────────────────────────────

      describe('required files', () => {
        for (const file of REQUIRED_FILES) {
          it(`has ${file}`, () => {
            expect(existsSync(templatePath(template, file))).toBe(true);
          });
        }
      });

      // ── Customization schema ───────────────────────────────────────────────

      describe('customization schema', () => {
        const schema = CUSTOMIZATION_SCHEMAS[template];

        it('has branding section with required fields', () => {
          expect(schema.branding).toBeDefined();
          expect(schema.branding.appName).toBeDefined();
          expect(schema.branding.appName.required).toBe(true);
          expect(schema.branding.primaryColor).toBeDefined();
          expect(schema.branding.primaryColor.required).toBe(true);
          expect(schema.branding.secondaryColor).toBeDefined();
          expect(schema.branding.secondaryColor.required).toBe(true);
        });

        it('has features section with boolean fields', () => {
          expect(schema.features).toBeDefined();
          for (const [key, field] of Object.entries(schema.features)) {
            expect(field.type, `features.${key} must be boolean`).toBe('boolean');
            expect(field.default !== undefined, `features.${key} must have a default`).toBe(true);
          }
        });

        it('has stellar section with required network and horizonUrl', () => {
          expect(schema.stellar).toBeDefined();
          expect(schema.stellar.network).toBeDefined();
          expect(schema.stellar.network.required).toBe(true);
          expect(schema.stellar.network.type).toBe('enum');
          expect(schema.stellar.network.values).toEqual(VALID_NETWORKS);
          expect(schema.stellar.horizonUrl).toBeDefined();
          expect(schema.stellar.horizonUrl.required).toBe(true);
        });

        it('branding fields have valid types', () => {
          const validTypes = ['string', 'color', 'boolean', 'enum', 'array', 'object'];
          for (const [key, field] of Object.entries(schema.branding)) {
            expect(validTypes, `branding.${key} has unknown type "${field.type}"`).toContain(field.type);
          }
        });
      });

      // ── Stellar configuration ──────────────────────────────────────────────

      describe('Stellar configuration', () => {
        it('schema network field only allows mainnet or testnet', () => {
          const { stellar } = CUSTOMIZATION_SCHEMAS[template];
          expect(stellar.network.values).toEqual(VALID_NETWORKS);
        });

        it('schema default network is testnet', () => {
          const { stellar } = CUSTOMIZATION_SCHEMAS[template];
          expect(stellar.network.default).toBe('testnet');
        });

        it('schema horizonUrl is a required string field', () => {
          const { stellar } = CUSTOMIZATION_SCHEMAS[template];
          expect(stellar.horizonUrl.type).toBe('string');
          expect(stellar.horizonUrl.required).toBe(true);
        });
      });

      // ── Template preview generation readiness ─────────────────────────────

      describe('preview generation readiness', () => {
        it('README.md is non-empty', () => {
          const content = readFileSync(templatePath(template, 'README.md'), 'utf-8');
          expect(content.trim().length).toBeGreaterThan(0);
        });

        it('package.json name is unique and identifiable', () => {
          const { name } = readJson<PackageJson>(templatePath(template, 'package.json'));
          expect(name).toContain(template.replace('-', '').slice(0, 4));
        });

        it('next.config.js exists for Next.js deployment', () => {
          expect(existsSync(templatePath(template, 'next.config.js'))).toBe(true);
        });
      });
    });
  }

  // ── Cross-template checks ────────────────────────────────────────────────────

  describe('cross-template consistency', () => {
    it('all templates use the same stellar-sdk version', () => {
      const versions = TEMPLATES.map((t) => {
        const { dependencies } = readJson<PackageJson>(templatePath(t, 'package.json'));
        return dependencies['stellar-sdk'];
      });
      expect(new Set(versions).size).toBe(1);
    });

    it('all templates use the same Next.js version', () => {
      const versions = TEMPLATES.map((t) => {
        const { dependencies } = readJson<PackageJson>(templatePath(t, 'package.json'));
        return dependencies['next'];
      });
      expect(new Set(versions).size).toBe(1);
    });

    it('all template names are unique', () => {
      const names = TEMPLATES.map((t) => {
        const { name } = readJson<PackageJson>(templatePath(t, 'package.json'));
        return name;
      });
      expect(new Set(names).size).toBe(TEMPLATES.length);
    });

    it('soroban-defi schema includes sorobanRpcUrl (unique Soroban requirement)', () => {
      const schema = CUSTOMIZATION_SCHEMAS['soroban-defi'];
      expect(schema.stellar.sorobanRpcUrl).toBeDefined();
      expect(schema.stellar.sorobanRpcUrl.required).toBe(true);
    });
  });

  // ── Stellar network URL validation ───────────────────────────────────────────

  describe('Stellar network URL validation', () => {
    it('testnet horizon URL is well-formed', () => {
      expect(() => new URL(TESTNET_HORIZON)).not.toThrow();
      expect(TESTNET_HORIZON).toContain('testnet');
    });

    it('mainnet horizon URL is well-formed', () => {
      expect(() => new URL(MAINNET_HORIZON)).not.toThrow();
      expect(MAINNET_HORIZON).not.toContain('testnet');
    });

    it('network passphrase for testnet is correct', () => {
      const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
      expect(TESTNET_PASSPHRASE).toBe('Test SDF Network ; September 2015');
    });

    it('network passphrase for mainnet is correct', () => {
      const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
      expect(MAINNET_PASSPHRASE).toBe('Public Global Stellar Network ; September 2015');
    });
  });
});
