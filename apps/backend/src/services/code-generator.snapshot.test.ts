import { describe, it, expect } from 'vitest';
import { CodeGeneratorService } from './code-generator.service';

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
