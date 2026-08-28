import { describe, it, expect } from 'vitest';
import { CodeGeneratorService, type TemplateFamilyId } from './code-generator.service';
import type { CustomizationConfig } from '@craft/types';

describe('Code Generator Snapshot Tests', () => {
  const codeGenerator = new CodeGeneratorService();

  const templates = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'];

  const baseConfig = {
    branding: {
      primaryColor: '#000000',
      secondaryColor: '#FFFFFF',
      logo: 'https://example.com/logo.png',
    },
    features: {
      enableCharts: true,
      enableHistory: true,
    },
  };

  describe('Generated File Structure', () => {
    templates.forEach((template) => {
      it(`should generate consistent file structure for ${template}`, async () => {
        const result = await codeGenerator.generateCode(template, baseConfig);

        expect(result).toMatchSnapshot(`${template}-file-structure`);
      });

      it(`should generate valid package.json for ${template}`, async () => {
        const result = await codeGenerator.generateCode(template, baseConfig);
        const packageJson = result.files?.['package.json'];

        expect(packageJson).toBeDefined();
        expect(packageJson).toMatchSnapshot(`${template}-package-json`);

        if (packageJson) {
          const parsed = JSON.parse(packageJson);
          expect(parsed.name).toBeDefined();
          expect(parsed.version).toBeDefined();
          expect(parsed.dependencies).toBeDefined();
        }
      });

      it(`should generate complete environment template for ${template}`, async () => {
        const result = await codeGenerator.generateCode(template, baseConfig);
        const envTemplate = result.files?.['.env.example'];

        expect(envTemplate).toBeDefined();
        expect(envTemplate).toMatchSnapshot(`${template}-env-template`);
      });
    });
  });

  describe('Customization Variations', () => {
    it('should produce different output for different branding configs', async () => {
      const config1 = {
        ...baseConfig,
        branding: { primaryColor: '#FF0000', secondaryColor: '#00FF00' },
      };

      const config2 = {
        ...baseConfig,
        branding: { primaryColor: '#0000FF', secondaryColor: '#FFFF00' },
      };

      const result1 = await codeGenerator.generateCode('stellar-dex', config1);
      const result2 = await codeGenerator.generateCode('stellar-dex', config2);

      expect(result1).not.toEqual(result2);
      expect(result1).toMatchSnapshot('stellar-dex-branding-variant-1');
      expect(result2).toMatchSnapshot('stellar-dex-branding-variant-2');
    });

    it('should produce different output for different feature configs', async () => {
      const config1 = {
        ...baseConfig,
        features: { enableCharts: true, enableHistory: false },
      };

      const config2 = {
        ...baseConfig,
        features: { enableCharts: false, enableHistory: true },
      };

      const result1 = await codeGenerator.generateCode('stellar-dex', config1);
      const result2 = await codeGenerator.generateCode('stellar-dex', config2);

      expect(result1).not.toEqual(result2);
      expect(result1).toMatchSnapshot('stellar-dex-features-variant-1');
      expect(result2).toMatchSnapshot('stellar-dex-features-variant-2');
    });
  });

  describe('Breaking Changes Detection', () => {
    it('should detect changes in generated TypeScript types', async () => {
      const result = await codeGenerator.generateCode('stellar-dex', baseConfig);
      const typesFile = result.files?.['src/types/index.ts'];

      expect(typesFile).toBeDefined();
      expect(typesFile).toMatchSnapshot('stellar-dex-types');
    });

    it('should detect changes in API route structure', async () => {
      const result = await codeGenerator.generateCode('payment-gateway', baseConfig);
      const apiRoutes = Object.keys(result.files || {}).filter((f) =>
        f.includes('api/')
      );

      expect(apiRoutes.length).toBeGreaterThan(0);
      expect(apiRoutes).toMatchSnapshot('payment-gateway-api-routes');
    });

    it('should detect changes in component structure', async () => {
      const result = await codeGenerator.generateCode('stellar-dex', baseConfig);
      const components = Object.keys(result.files || {}).filter((f) =>
        f.includes('components/')
      );

      expect(components.length).toBeGreaterThan(0);
      expect(components).toMatchSnapshot('stellar-dex-components');
    });
  });

  describe('Dependency Consistency', () => {
    it('should maintain consistent dependencies across templates', async () => {
      const results = await Promise.all(
        templates.map((template) =>
          codeGenerator.generateCode(template, baseConfig)
        )
      );

      const packageJsons = results.map((r) => {
        const pkg = r.files?.['package.json'];
        return pkg ? JSON.parse(pkg) : null;
      });

      packageJsons.forEach((pkg) => {
        expect(pkg).toMatchSnapshot(`package-json-${pkg?.name}`);
      });
    });

    it('should include required dependencies', async () => {
      const result = await codeGenerator.generateCode('stellar-dex', baseConfig);
      const packageJson = result.files?.['package.json'];

      if (packageJson) {
        const parsed = JSON.parse(packageJson);
        expect(parsed.dependencies).toHaveProperty('next');
        expect(parsed.dependencies).toHaveProperty('react');
        expect(parsed.dependencies).toHaveProperty('typescript');
      }
    });
  });

  describe('Environment Variables', () => {
    it('should generate complete .env.example for all templates', async () => {
      for (const template of templates) {
        const result = await codeGenerator.generateCode(template, baseConfig);
        const envTemplate = result.files?.['.env.example'];

        expect(envTemplate).toBeDefined();
        expect(envTemplate?.length).toBeGreaterThan(0);
        expect(envTemplate).toMatchSnapshot(`${template}-env-vars`);
      }
    });

    it('should include Stellar-specific environment variables', async () => {
      const result = await codeGenerator.generateCode('stellar-dex', baseConfig);
      const envTemplate = result.files?.['.env.example'];

      expect(envTemplate).toContain('STELLAR');
      expect(envTemplate).toMatchSnapshot('stellar-dex-stellar-env-vars');
    });
  });

  describe('Snapshot Update Workflow', () => {
    it('should allow snapshot updates when intentional changes are made', async () => {
      const updatedConfig = {
        ...baseConfig,
        branding: {
          ...baseConfig.branding,
          fontFamily: 'Roboto',
        },
      };

      const result = await codeGenerator.generateCode('stellar-dex', updatedConfig);

      expect(result).toMatchSnapshot('stellar-dex-with-font-family');
    });
  });

  describe('Code Quality Snapshots', () => {
    it('should maintain consistent code formatting', async () => {
      const result = await codeGenerator.generateCode('stellar-dex', baseConfig);
      const mainFile = result.files?.['src/app/page.tsx'];

      expect(mainFile).toBeDefined();
      expect(mainFile).toMatchSnapshot('stellar-dex-main-page-formatting');
    });

    it('should maintain consistent import organization', async () => {
      const result = await codeGenerator.generateCode('soroban-defi', baseConfig);
      const files = Object.entries(result.files || {})
        .filter(([name]) => name.endsWith('.ts') || name.endsWith('.tsx'))
        .slice(0, 3);

      files.forEach(([name, content]) => {
        expect(content).toMatchSnapshot(`soroban-defi-imports-${name}`);
      });
    });
  });
});

// ── Extended snapshot regression suite (Issue #703) ───────────────────────────
//
// Covers all four template types with varied customization inputs.
// Each describe block follows the same parametric shape so snapshots are
// grouped per-template and diff failures are easy to locate in CI.

const ALL_TEMPLATES: TemplateFamilyId[] = [
  'stellar-dex',
  'soroban-defi',
  'payment-gateway',
  'asset-issuance',
];

function makeCustomization(overrides: Partial<CustomizationConfig> = {}): CustomizationConfig {
  return {
    branding: {
      appName: 'Snapshot App',
      primaryColor: '#1a1a2e',
      secondaryColor: '#16213e',
      fontFamily: 'Inter',
      ...overrides.branding,
    },
    features: {
      enableCharts: true,
      enableTransactionHistory: true,
      enableAnalytics: false,
      enableNotifications: false,
      ...overrides.features,
    },
    stellar: {
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      ...overrides.stellar,
    },
  };
}

function makeRequest(template: TemplateFamilyId, cfg: CustomizationConfig) {
  return {
    templateId: template,
    templateFamily: template,
    customization: cfg,
    outputPath: '/tmp/snapshot-test',
  };
}

describe('Per-template snapshot regression — all four templates', () => {
  const svc = new CodeGeneratorService();
  const cfg = makeCustomization();

  ALL_TEMPLATES.forEach((template) => {
    describe(`Template: ${template}`, () => {
      it('full generation result matches snapshot', () => {
        const result = svc.generate(makeRequest(template, cfg));
        expect(result.success).toBe(true);
        expect(result).toMatchSnapshot(`${template}-full-result`);
      });

      it('package.json matches snapshot', () => {
        const result = svc.generate(makeRequest(template, cfg));
        const pkgFile = result.generatedFiles.find(f => f.path === 'package.json');
        expect(pkgFile).toBeDefined();
        expect(pkgFile?.content).toMatchSnapshot(`${template}-package-json`);

        const parsed = JSON.parse(pkgFile!.content);
        expect(parsed.name).toBe(`${template}-app`);
        expect(parsed.version).toBeDefined();
        expect(parsed.dependencies).toHaveProperty('stellar-sdk');
      });

      it('.env.example matches snapshot', () => {
        const result = svc.generate(makeRequest(template, cfg));
        const envFile = result.generatedFiles.find(f => f.path === '.env.example');
        expect(envFile).toBeDefined();
        expect(envFile?.content).toMatchSnapshot(`${template}-env-example`);
        expect(envFile?.content).toContain('STELLAR');
      });

      it('config.ts matches snapshot', () => {
        const result = svc.generate(makeRequest(template, cfg));
        const configFile = result.generatedFiles.find(f => f.path === 'src/lib/config.ts');
        expect(configFile).toBeDefined();
        expect(configFile?.content).toMatchSnapshot(`${template}-config-ts`);
      });

      it('feature-flags.ts matches snapshot', () => {
        const result = svc.generate(makeRequest(template, cfg));
        const flagsFile = result.generatedFiles.find(f => f.path === 'src/lib/feature-flags.ts');
        expect(flagsFile).toBeDefined();
        expect(flagsFile?.content).toMatchSnapshot(`${template}-feature-flags`);
      });

      it('generated file list is stable across runs (no drift)', () => {
        const result1 = svc.generate(makeRequest(template, cfg));
        const result2 = svc.generate(makeRequest(template, cfg));
        const paths1 = result1.generatedFiles.map(f => f.path).sort();
        const paths2 = result2.generatedFiles.map(f => f.path).sort();
        expect(paths1).toEqual(paths2);
        expect(paths1).toMatchSnapshot(`${template}-file-list`);
      });
    });
  });
});

describe('Varied customization inputs — snapshot diff detection', () => {
  const svc = new CodeGeneratorService();

  it('different branding produces different config.ts snapshots per template', () => {
    const cfgA = makeCustomization({ branding: { appName: 'Alpha', primaryColor: '#ff0000', secondaryColor: '#ffffff', fontFamily: 'Roboto' } });
    const cfgB = makeCustomization({ branding: { appName: 'Beta',  primaryColor: '#0000ff', secondaryColor: '#000000', fontFamily: 'Lato' } });

    ALL_TEMPLATES.forEach((template) => {
      const resultA = svc.generate(makeRequest(template, cfgA));
      const resultB = svc.generate(makeRequest(template, cfgB));

      const configA = resultA.generatedFiles.find(f => f.path === 'src/lib/config.ts');
      const configB = resultB.generatedFiles.find(f => f.path === 'src/lib/config.ts');

      expect(configA?.content).not.toEqual(configB?.content);
      expect(configA?.content).toMatchSnapshot(`${template}-branding-a-config`);
      expect(configB?.content).toMatchSnapshot(`${template}-branding-b-config`);
    });
  });

  it('empty feature flag set produces stable snapshot', () => {
    const cfg = makeCustomization({
      features: {
        enableCharts: false,
        enableTransactionHistory: false,
        enableAnalytics: false,
        enableNotifications: false,
      },
    });

    ALL_TEMPLATES.forEach((template) => {
      const result = svc.generate(makeRequest(template, cfg));
      const flagsFile = result.generatedFiles.find(f => f.path === 'src/lib/feature-flags.ts');
      expect(flagsFile?.content).toMatchSnapshot(`${template}-all-flags-disabled`);
    });
  });

  it('mainnet vs testnet produces different .env.example snapshots', () => {
    const cfgTestnet = makeCustomization({ stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' } });
    const cfgMainnet = makeCustomization({ stellar: { network: 'mainnet', horizonUrl: 'https://horizon.stellar.org' } });

    const resultTestnet = svc.generate(makeRequest('stellar-dex', cfgTestnet));
    const resultMainnet = svc.generate(makeRequest('stellar-dex', cfgMainnet));

    const envTestnet = resultTestnet.generatedFiles.find(f => f.path === '.env.example');
    const envMainnet = resultMainnet.generatedFiles.find(f => f.path === '.env.example');

    expect(envTestnet?.content).not.toEqual(envMainnet?.content);
    expect(envTestnet?.content).toMatchSnapshot('stellar-dex-testnet-env');
    expect(envMainnet?.content).toMatchSnapshot('stellar-dex-mainnet-env');
  });
});

describe('Unicode and special characters in app name — snapshot stability', () => {
  const svc = new CodeGeneratorService();

  it('unicode characters in app name are preserved in config.ts', () => {
    const cfg = makeCustomization({
      branding: { appName: 'Ünïcödé Ápp 🚀', primaryColor: '#000000', secondaryColor: '#ffffff', fontFamily: 'Arial' },
    });

    const result = svc.generate(makeRequest('stellar-dex', cfg));
    expect(result.success).toBe(true);

    const configFile = result.generatedFiles.find(f => f.path === 'src/lib/config.ts');
    expect(configFile?.content).toMatchSnapshot('stellar-dex-unicode-app-name-config');
  });

  it('CJK characters in app name produce a stable snapshot', () => {
    const cfg = makeCustomization({
      branding: { appName: '星际交易所', primaryColor: '#ff6b35', secondaryColor: '#004e89', fontFamily: 'Noto Sans' },
    });

    const result = svc.generate(makeRequest('stellar-dex', cfg));
    expect(result.success).toBe(true);

    const configFile = result.generatedFiles.find(f => f.path === 'src/lib/config.ts');
    expect(configFile?.content).toMatchSnapshot('stellar-dex-cjk-app-name-config');
  });

  it('special characters (quotes, backslashes) in app name are escaped', () => {
    const cfg = makeCustomization({
      branding: { appName: `App "with" 'quotes' & \\ slashes`, primaryColor: '#333', secondaryColor: '#eee', fontFamily: 'Mono' },
    });

    const result = svc.generate(makeRequest('payment-gateway', cfg));
    expect(result.success).toBe(true);

    const configFile = result.generatedFiles.find(f => f.path === 'src/lib/config.ts');
    expect(configFile?.content).toMatchSnapshot('payment-gateway-special-chars-config');
  });
});
