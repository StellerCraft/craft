/**
 * Snapshot Tests for TemplateGeneratorService (Issue #716)
 *
 * Verifies that template generator output for all four template types
 * (stellar-dex, soroban-defi, payment-gateway, asset-issuance) remains
 * consistent across code changes. Silent regressions in generated file
 * content are caught by snapshot comparison.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateGeneratorService } from './template-generator.service';
import type { Template, GeneratedFile } from '@craft/types';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const validCustomization = {
  branding: {
    appName: 'Test App',
    primaryColor: '#4f9eff',
    secondaryColor: '#1a1f36',
    fontFamily: 'Inter',
  },
  features: {
    enableCharts: true,
    enableTransactionHistory: true,
    enableAnalytics: false,
  },
  stellar: {
    network: 'testnet' as const,
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
};

const templatesByFamily: Record<string, Template> = {
  'stellar-dex': {
    id: 'tmpl-dex-001',
    name: 'Stellar DEX',
    description: 'Decentralized exchange for Stellar assets',
    category: 'dex',
    blockchainType: 'stellar',
    baseRepositoryUrl: 'https://github.com/example/stellar-dex',
    previewImageUrl: 'https://example.com/dex.png',
    features: ['swapping', 'charts', 'history'],
    customizationSchema: {},
    isActive: true,
    createdAt: new Date('2024-01-01'),
  },
  'soroban-defi': {
    id: 'tmpl-defi-001',
    name: 'Soroban DeFi',
    description: 'DeFi platform built on Soroban',
    category: 'lending',
    blockchainType: 'stellar',
    baseRepositoryUrl: 'https://github.com/example/soroban-defi',
    previewImageUrl: 'https://example.com/defi.png',
    features: ['lending', 'farming', 'governance'],
    customizationSchema: {},
    isActive: true,
    createdAt: new Date('2024-01-01'),
  },
  'payment-gateway': {
    id: 'tmpl-payment-001',
    name: 'Payment Gateway',
    description: 'Accept Stellar payments',
    category: 'payment',
    blockchainType: 'stellar',
    baseRepositoryUrl: 'https://github.com/example/payment-gateway',
    previewImageUrl: 'https://example.com/payment.png',
    features: ['invoices', 'refunds', 'webhooks'],
    customizationSchema: {},
    isActive: true,
    createdAt: new Date('2024-01-01'),
  },
  'asset-issuance': {
    id: 'tmpl-asset-001',
    name: 'Asset Issuance',
    description: 'Create and manage Stellar assets',
    category: 'asset-issuance',
    blockchainType: 'stellar',
    baseRepositoryUrl: 'https://github.com/example/asset-issuance',
    previewImageUrl: 'https://example.com/asset.png',
    features: ['creation', 'distribution', 'management'],
    customizationSchema: {},
    isActive: true,
    createdAt: new Date('2024-01-01'),
  },
};

// Generated files consistent across all template types
const mockGeneratedFiles: GeneratedFile[] = [
  {
    path: 'src/config.ts',
    content: `export const config = {
  appName: 'Test App',
  primaryColor: '#4f9eff',
  network: 'testnet',
};`,
    type: 'code',
  },
  {
    path: '.env',
    content: 'NEXT_PUBLIC_NETWORK=testnet\nNEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org\n',
    type: 'config',
  },
  {
    path: 'package.json',
    content: JSON.stringify(
      {
        name: 'test-app',
        version: '1.0.0',
        scripts: {
          dev: 'next dev',
          build: 'next build',
        },
      },
      null,
      2
    ),
    type: 'config',
  },
];

// ── Snapshot tests ────────────────────────────────────────────────────────────

describe('TemplateGeneratorService snapshot tests', () => {
  let service: TemplateGeneratorService;

  beforeEach(() => {
    // Mock dependencies
    const templateServiceMock = {
      getTemplate: vi.fn((id: string) => {
        // Map template ID to family
        if (id === 'tmpl-dex-001') return Promise.resolve(templatesByFamily['stellar-dex']);
        if (id === 'tmpl-defi-001') return Promise.resolve(templatesByFamily['soroban-defi']);
        if (id === 'tmpl-payment-001') return Promise.resolve(templatesByFamily['payment-gateway']);
        if (id === 'tmpl-asset-001') return Promise.resolve(templatesByFamily['asset-issuance']);
        return Promise.reject(new Error(`Template not found: ${id}`));
      }),
    };

    const codeGenMock = {
      generate: vi.fn().mockReturnValue({
        success: true,
        generatedFiles: mockGeneratedFiles,
        errors: [],
      }),
    };

    const cloningMock = {
      clone: vi.fn().mockResolvedValue({
        success: true,
        workspacePath: '/tmp/output',
        errors: [],
      }),
    };

    const syntaxValidatorMock = {
      validate: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    };

    service = new TemplateGeneratorService(
      templateServiceMock as any,
      codeGenMock as any,
      cloningMock as any,
      syntaxValidatorMock as any
    );
  });

  it(
    'matches snapshot for stellar-dex template generation',
    async () => {
      const result = await service.generate({
        templateId: 'tmpl-dex-001',
        customization: validCustomization,
        outputPath: '/tmp/output',
      });

      expect(result).toMatchSnapshot('stellar-dex-generation');
    }
  );

  it(
    'matches snapshot for soroban-defi template generation',
    async () => {
      const result = await service.generate({
        templateId: 'tmpl-defi-001',
        customization: validCustomization,
        outputPath: '/tmp/output',
      });

      expect(result).toMatchSnapshot('soroban-defi-generation');
    }
  );

  it(
    'matches snapshot for payment-gateway template generation',
    async () => {
      const result = await service.generate({
        templateId: 'tmpl-payment-001',
        customization: validCustomization,
        outputPath: '/tmp/output',
      });

      expect(result).toMatchSnapshot('payment-gateway-generation');
    }
  );

  it(
    'matches snapshot for asset-issuance template generation',
    async () => {
      const result = await service.generate({
        templateId: 'tmpl-asset-001',
        customization: validCustomization,
        outputPath: '/tmp/output',
      });

      expect(result).toMatchSnapshot('asset-issuance-generation');
    }
  );

  it(
    'generated files content matches snapshot across all templates',
    async () => {
      const templates = ['tmpl-dex-001', 'tmpl-defi-001', 'tmpl-payment-001', 'tmpl-asset-001'];

      for (const templateId of templates) {
        const result = await service.generate({
          templateId,
          customization: validCustomization,
          outputPath: '/tmp/output',
        });

        if (result.success) {
          expect({
            templateId,
            files: result.generatedFiles.map((f) => ({ path: f.path, type: f.type })),
          }).toMatchSnapshot(`${templateId}-files`);
        }
      }
    }
  );

  it(
    'artifact metadata structure matches snapshot',
    async () => {
      const result = await service.generate({
        templateId: 'tmpl-dex-001',
        customization: validCustomization,
        outputPath: '/tmp/output',
      });

      if (result.success && result.artifactMetadata) {
        // Exclude dynamic timestamp for deterministic snapshots
        const metadata = {
          templateId: result.artifactMetadata.templateId,
          templateFamily: result.artifactMetadata.templateFamily,
          fileCount: result.artifactMetadata.fileCount,
          outputPath: result.artifactMetadata.outputPath,
        };
        expect(metadata).toMatchSnapshot('artifact-metadata');
      }
    }
  );

  it(
    'ensures all four template types produce consistent file structure',
    async () => {
      const templates = [
        { id: 'tmpl-dex-001', family: 'stellar-dex' },
        { id: 'tmpl-defi-001', family: 'soroban-defi' },
        { id: 'tmpl-payment-001', family: 'payment-gateway' },
        { id: 'tmpl-asset-001', family: 'asset-issuance' },
      ];

      const results = await Promise.all(
        templates.map((t) =>
          service.generate({
            templateId: t.id,
            customization: validCustomization,
            outputPath: '/tmp/output',
          })
        )
      );

      // All should succeed
      results.forEach((r) => {
        expect(r.success).toBe(true);
      });

      // All should have same number of files
      const fileCounts = results
        .filter((r) => r.success)
        .map((r) => r.generatedFiles.length);
      const firstCount = fileCounts[0];
      fileCounts.forEach((count) => {
        expect(count).toBe(firstCount);
      });

      // Compare structure across all
      expect({
        templates: templates.map((t, i) => ({
          family: t.family,
          success: results[i].success,
          fileCount: results[i].generatedFiles.length,
          hasMetadata: !!results[i].artifactMetadata,
        })),
      }).toMatchSnapshot('all-templates-structure');
    }
  );
});
