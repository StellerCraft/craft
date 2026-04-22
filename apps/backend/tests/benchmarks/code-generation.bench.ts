import { bench, describe } from 'vitest';
import { CodeGeneratorService } from '../../src/services/code-generator.service';

describe('Code Generation Performance Benchmarks', () => {
  const codeGenerator = new CodeGeneratorService();

  const templates = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'];

  const simpleConfig = {
    branding: { primaryColor: '#000000', secondaryColor: '#FFFFFF' },
    features: { enableCharts: true },
  };

  const complexConfig = {
    branding: {
      primaryColor: '#000000',
      secondaryColor: '#FFFFFF',
      logo: 'https://example.com/logo.png',
      fontFamily: 'Inter',
    },
    features: {
      enableCharts: true,
      enableHistory: true,
      enableAnalytics: true,
      enableNotifications: true,
    },
    stellar: {
      network: 'testnet',
      assets: ['USDC', 'BRL', 'CNY'],
    },
  };

  templates.forEach((template) => {
    bench(`generate ${template} with simple config`, async () => {
      await codeGenerator.generateCode(template, simpleConfig);
    });

    bench(`generate ${template} with complex config`, async () => {
      await codeGenerator.generateCode(template, complexConfig);
    });
  });

  bench('generate all templates sequentially', async () => {
    for (const template of templates) {
      await codeGenerator.generateCode(template, simpleConfig);
    }
  });

  bench('generate all templates in parallel', async () => {
    await Promise.all(
      templates.map((template) => codeGenerator.generateCode(template, simpleConfig))
    );
  });
});
