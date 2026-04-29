import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

interface VisualScenario {
  category: 'dex' | 'defi' | 'payment' | 'asset';
  templateId: string;
  customization: Record<string, unknown>;
  viewport: { width: number; height: number };
}

interface PixelDiff {
  totalPixels: number;
  changedPixels: number;
  percentageChanged: number;
}

interface BaselineSnapshot extends VisualScenario {
  screenshotBase64: string;
}

class VisualRegressionTester {
  private diffThreshold = 0.02;

  constructor(private readonly baselineRootDir: string) {}

  generateMockScreenshot(
    templateId: string,
    customization: Record<string, unknown>,
    viewport: { width: number; height: number }
  ): Buffer {
    const payload = JSON.stringify({ templateId, customization, viewport });
    const hash = this.simpleHash(payload);
    const screenshot = Buffer.alloc(512, 0);

    screenshot.writeUInt32BE(hash, 0);
    screenshot.write(templateId, 4, 'utf8');
    screenshot.write(payload, 32, 'utf8');

    return screenshot;
  }

  storeBaseline(scenario: VisualScenario): string {
    const screenshot = this.generateMockScreenshot(
      scenario.templateId,
      scenario.customization,
      scenario.viewport
    );

    const snapshot: BaselineSnapshot = {
      ...scenario,
      screenshotBase64: screenshot.toString('base64'),
    };

    const baselinePath = this.getBaselinePath(scenario.category);
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    return baselinePath;
  }

  compareWithBaseline(scenario: VisualScenario, currentScreenshot: Buffer): PixelDiff {
    const baselinePath = this.getBaselinePath(scenario.category);

    if (!fs.existsSync(baselinePath)) {
      throw new Error(
        [
          `Visual baseline missing for category \"${scenario.category}\".`,
          `Expected file: ${baselinePath}`,
          'Run VISUAL_BASELINE_MODE=store npm run --workspace @craft/backend test -- tests/visual/preview.visual.test.ts',
        ].join(' ')
      );
    }

    const stored = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as BaselineSnapshot;
    const baselineScreenshot = Buffer.from(stored.screenshotBase64, 'base64');

    return this.calculateDiff(baselineScreenshot, currentScreenshot);
  }

  isWithinThreshold(diff: PixelDiff): boolean {
    return diff.percentageChanged <= this.diffThreshold * 100;
  }

  setDiffThreshold(threshold: number): void {
    this.diffThreshold = threshold;
  }

  private getBaselinePath(category: VisualScenario['category']): string {
    return path.join(this.baselineRootDir, `${category}.baseline.json`);
  }

  private calculateDiff(baseline: Buffer, current: Buffer): PixelDiff {
    const totalPixels = Math.min(baseline.length, current.length);
    let changedPixels = 0;

    for (let i = 0; i < totalPixels; i++) {
      if (baseline[i] !== current[i]) {
        changedPixels++;
      }
    }

    return {
      totalPixels,
      changedPixels,
      percentageChanged: (changedPixels / totalPixels) * 100,
    };
  }

  private simpleHash(str: string): number {
    let hash = 0;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }

    return Math.abs(hash);
  }
}

const scenarios: VisualScenario[] = [
  {
    category: 'dex',
    templateId: 'stellar-dex',
    customization: {
      branding: { primaryColor: '#000000', secondaryColor: '#FFFFFF' },
      features: { enableCharts: true, enableHistory: true },
    },
    viewport: { width: 1920, height: 1080 },
  },
  {
    category: 'defi',
    templateId: 'soroban-defi',
    customization: {
      branding: { logo: 'https://example.com/logo.png' },
      features: { enableLiquidityPools: true },
    },
    viewport: { width: 1920, height: 1080 },
  },
  {
    category: 'payment',
    templateId: 'payment-gateway',
    customization: {
      branding: { primaryColor: '#007AFF' },
      features: { enableInvoicing: true },
    },
    viewport: { width: 1920, height: 1080 },
  },
  {
    category: 'asset',
    templateId: 'asset-issuance',
    customization: {
      branding: { primaryColor: '#34C759' },
      features: { enableClawback: false },
    },
    viewport: { width: 1920, height: 1080 },
  },
];

const baselineRootDir = path.join(__dirname, 'baselines', 'deployment-preview');
const shouldStoreBaselines = process.env.VISUAL_BASELINE_MODE === 'store';

describe('Visual Regression: Deployment Preview Baselines', () => {
  it('stores baseline outputs for each template category', () => {
    if (!shouldStoreBaselines) {
      return;
    }

    const visualTester = new VisualRegressionTester(baselineRootDir);

    scenarios.forEach((scenario) => {
      const baselinePath = visualTester.storeBaseline(scenario);
      expect(fs.existsSync(baselinePath)).toBe(true);
    });
  });

  it('compares current screenshots against baselines within threshold', () => {
    if (shouldStoreBaselines) {
      return;
    }

    const visualTester = new VisualRegressionTester(baselineRootDir);

    scenarios.forEach((scenario) => {
      const screenshot = visualTester.generateMockScreenshot(
        scenario.templateId,
        scenario.customization,
        scenario.viewport
      );

      const diff = visualTester.compareWithBaseline(scenario, screenshot);
      expect(diff.percentageChanged).toBe(0);
      expect(visualTester.isWithinThreshold(diff)).toBe(true);
    });
  });

  it('fails when diff exceeds threshold', () => {
    if (shouldStoreBaselines) {
      return;
    }

    const visualTester = new VisualRegressionTester(baselineRootDir);
    visualTester.setDiffThreshold(0.01);

    const targetScenario = scenarios[0];
    const changedScreenshot = visualTester.generateMockScreenshot(
      targetScenario.templateId,
      {
        ...targetScenario.customization,
        branding: { primaryColor: '#FF0000', secondaryColor: '#FFFFFF' },
      },
      targetScenario.viewport
    );

    const diff = visualTester.compareWithBaseline(targetScenario, changedScreenshot);

    expect(diff.changedPixels).toBeGreaterThan(0);
    expect(visualTester.isWithinThreshold(diff)).toBe(false);
  });

  it('fails with a clear error if a baseline file is missing', () => {
    if (shouldStoreBaselines) {
      return;
    }

    const missingCategoryScenario = scenarios[0];
    const uniqueMissingDir = path.join(
      baselineRootDir,
      `missing-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    const visualTester = new VisualRegressionTester(uniqueMissingDir);

    const screenshot = visualTester.generateMockScreenshot(
      missingCategoryScenario.templateId,
      missingCategoryScenario.customization,
      missingCategoryScenario.viewport
    );

    expect(() => visualTester.compareWithBaseline(missingCategoryScenario, screenshot)).toThrow(
      /Visual baseline missing for category "dex"/i
    );
  });
});
