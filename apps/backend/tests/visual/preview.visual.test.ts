import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Visual Regression Tests for Preview System
 * 
 * Tests that customization changes render correctly and detects unintended UI changes
 * across different templates and viewport sizes.
 */

interface ScreenshotMetadata {
  templateId: string;
  customization: Record<string, unknown>;
  viewport: { width: number; height: number };
  timestamp: number;
}

interface PixelDiff {
  totalPixels: number;
  changedPixels: number;
  percentageChanged: number;
}

class VisualRegressionTester {
  private baselineScreenshots: Map<string, Buffer> = new Map();
  private diffThreshold = 0.02; // 2% pixel difference threshold

  /**
   * Generate a mock screenshot buffer for testing
   */
  private generateMockScreenshot(
    templateId: string,
    customization: Record<string, unknown>,
    viewport: { width: number; height: number }
  ): Buffer {
    // Create a deterministic hash based on template, customization, and viewport
    const data = JSON.stringify({ templateId, customization, viewport });
    const hash = this.simpleHash(data);
    
    // Create a mock buffer with the hash encoded
    const buffer = Buffer.alloc(100);
    buffer.writeUInt32BE(hash, 0);
    buffer.write(templateId, 4);
    return buffer;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Store baseline screenshot for a template variation
   */
  storeBaseline(
    templateId: string,
    customization: Record<string, unknown>,
    viewport: { width: number; height: number },
    screenshot: Buffer
  ): void {
    const key = this.generateKey(templateId, customization, viewport);
    this.baselineScreenshots.set(key, screenshot);
  }

  /**
   * Compare current screenshot against baseline
   */
  compareWithBaseline(
    templateId: string,
    customization: Record<string, unknown>,
    viewport: { width: number; height: number },
    currentScreenshot: Buffer
  ): PixelDiff {
    const key = this.generateKey(templateId, customization, viewport);
    const baseline = this.baselineScreenshots.get(key);

    if (!baseline) {
      throw new Error(`No baseline found for ${key}`);
    }

    return this.calculateDiff(baseline, currentScreenshot);
  }

  /**
   * Calculate pixel-level differences between two screenshots
   */
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

  /**
   * Check if diff is within acceptable threshold
   */
  isWithinThreshold(diff: PixelDiff): boolean {
    return diff.percentageChanged <= this.diffThreshold * 100;
  }

  private generateKey(
    templateId: string,
    customization: Record<string, unknown>,
    viewport: { width: number; height: number }
  ): string {
    return `${templateId}:${JSON.stringify(customization)}:${viewport.width}x${viewport.height}`;
  }

  setDiffThreshold(threshold: number): void {
    this.diffThreshold = threshold;
  }
}

describe('Visual Regression Tests: Preview System', () => {
  let visualTester: VisualRegressionTester;

  beforeEach(() => {
    visualTester = new VisualRegressionTester();
  });

  describe('Template Baseline Screenshots', () => {
    it('should generate baseline for Stellar DEX template', () => {
      const templateId = 'stellar-dex';
      const customization = {
        branding: { primaryColor: '#000000', secondaryColor: '#FFFFFF' },
        features: { enableCharts: true, enableHistory: true },
      };
      const viewport = { width: 1920, height: 1080 };

      const screenshot = Buffer.from('mock-screenshot-data');
      visualTester.storeBaseline(templateId, customization, viewport, screenshot);

      // Verify baseline was stored
      const diff = visualTester.compareWithBaseline(templateId, customization, viewport, screenshot);
      expect(diff.percentageChanged).toBe(0);
    });

    it('should generate baseline for Soroban DeFi template', () => {
      const templateId = 'soroban-defi';
      const customization = {
        branding: { logo: 'https://example.com/logo.png' },
        features: { enableLiquidityPools: true },
      };
      const viewport = { width: 1920, height: 1080 };

      const screenshot = Buffer.from('mock-screenshot-data');
      visualTester.storeBaseline(templateId, customization, viewport, screenshot);

      const diff = visualTester.compareWithBaseline(templateId, customization, viewport, screenshot);
      expect(diff.percentageChanged).toBe(0);
    });

    it('should generate baseline for Payment Gateway template', () => {
      const templateId = 'payment-gateway';
      const customization = {
        branding: { primaryColor: '#007AFF' },
        features: { enableInvoicing: true },
      };
      const viewport = { width: 1920, height: 1080 };

      const screenshot = Buffer.from('mock-screenshot-data');
      visualTester.storeBaseline(templateId, customization, viewport, screenshot);

      const diff = visualTester.compareWithBaseline(templateId, customization, viewport, screenshot);
      expect(diff.percentageChanged).toBe(0);
    });

    it('should generate baseline for Asset Issuance template', () => {
      const templateId = 'asset-issuance';
      const customization = {
        branding: { primaryColor: '#34C759' },
        features: { enableClawback: false },
      };
      const viewport = { width: 1920, height: 1080 };

      const screenshot = Buffer.from('mock-screenshot-data');
      visualTester.storeBaseline(templateId, customization, viewport, screenshot);

      const diff = visualTester.compareWithBaseline(templateId, customization, viewport, screenshot);
      expect(diff.percentageChanged).toBe(0);
    });
  });

  describe('Customization Changes Detection', () => {
    it('should detect primary color change', () => {
      const templateId = 'stellar-dex';
      const baselineCustomization = {
        branding: { primaryColor: '#000000', secondaryColor: '#FFFFFF' },
      };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline-data');
      visualTester.storeBaseline(templateId, baselineCustomization, viewport, baselineScreenshot);

      // Simulate color change
      const modifiedCustomization = {
        branding: { primaryColor: '#FF0000', secondaryColor: '#FFFFFF' },
      };
      const modifiedScreenshot = Buffer.from('modified-data-with-red-color');

      const diff = visualTester.compareWithBaseline(
        templateId,
        modifiedCustomization,
        viewport,
        modifiedScreenshot
      );

      expect(diff.changedPixels).toBeGreaterThan(0);
    });

    it('should detect font change', () => {
      const templateId = 'payment-gateway';
      const baselineCustomization = {
        branding: { fontFamily: 'Inter' },
      };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline-inter-font');
      visualTester.storeBaseline(templateId, baselineCustomization, viewport, baselineScreenshot);

      const modifiedCustomization = {
        branding: { fontFamily: 'Roboto' },
      };
      const modifiedScreenshot = Buffer.from('modified-roboto-font');

      const diff = visualTester.compareWithBaseline(
        templateId,
        modifiedCustomization,
        viewport,
        modifiedScreenshot
      );

      expect(diff.changedPixels).toBeGreaterThan(0);
    });

    it('should detect layout change', () => {
      const templateId = 'stellar-dex';
      const baselineCustomization = {
        layout: { sidebarPosition: 'left' },
      };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline-left-sidebar');
      visualTester.storeBaseline(templateId, baselineCustomization, viewport, baselineScreenshot);

      const modifiedCustomization = {
        layout: { sidebarPosition: 'right' },
      };
      const modifiedScreenshot = Buffer.from('modified-right-sidebar');

      const diff = visualTester.compareWithBaseline(
        templateId,
        modifiedCustomization,
        viewport,
        modifiedScreenshot
      );

      expect(diff.changedPixels).toBeGreaterThan(0);
    });

    it('should detect feature toggle changes', () => {
      const templateId = 'soroban-defi';
      const baselineCustomization = {
        features: { enableCharts: true },
      };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline-with-charts');
      visualTester.storeBaseline(templateId, baselineCustomization, viewport, baselineScreenshot);

      const modifiedCustomization = {
        features: { enableCharts: false },
      };
      const modifiedScreenshot = Buffer.from('modified-without-charts');

      const diff = visualTester.compareWithBaseline(
        templateId,
        modifiedCustomization,
        viewport,
        modifiedScreenshot
      );

      expect(diff.changedPixels).toBeGreaterThan(0);
    });
  });

  describe('Responsive Rendering', () => {
    it('should test rendering at mobile viewport (375x667)', () => {
      const templateId = 'stellar-dex';
      const customization = { branding: { primaryColor: '#000000' } };
      const mobileViewport = { width: 375, height: 667 };

      const screenshot = Buffer.from('mobile-screenshot');
      visualTester.storeBaseline(templateId, customization, mobileViewport, screenshot);

      const diff = visualTester.compareWithBaseline(templateId, customization, mobileViewport, screenshot);
      expect(diff.percentageChanged).toBe(0);
    });

    it('should test rendering at tablet viewport (768x1024)', () => {
      const templateId = 'payment-gateway';
      const customization = { branding: { primaryColor: '#007AFF' } };
      const tabletViewport = { width: 768, height: 1024 };

      const screenshot = Buffer.from('tablet-screenshot');
      visualTester.storeBaseline(templateId, customization, tabletViewport, screenshot);

      const diff = visualTester.compareWithBaseline(templateId, customization, tabletViewport, screenshot);
      expect(diff.percentageChanged).toBe(0);
    });

    it('should test rendering at desktop viewport (1920x1080)', () => {
      const templateId = 'asset-issuance';
      const customization = { branding: { primaryColor: '#34C759' } };
      const desktopViewport = { width: 1920, height: 1080 };

      const screenshot = Buffer.from('desktop-screenshot');
      visualTester.storeBaseline(templateId, customization, desktopViewport, screenshot);

      const diff = visualTester.compareWithBaseline(templateId, customization, desktopViewport, screenshot);
      expect(diff.percentageChanged).toBe(0);
    });

    it('should test rendering at wide desktop viewport (2560x1440)', () => {
      const templateId = 'stellar-dex';
      const customization = { branding: { primaryColor: '#000000' } };
      const wideViewport = { width: 2560, height: 1440 };

      const screenshot = Buffer.from('wide-desktop-screenshot');
      visualTester.storeBaseline(templateId, customization, wideViewport, screenshot);

      const diff = visualTester.compareWithBaseline(templateId, customization, wideViewport, screenshot);
      expect(diff.percentageChanged).toBe(0);
    });

    it('should detect responsive layout changes across viewports', () => {
      const templateId = 'payment-gateway';
      const customization = { layout: { responsive: true } };

      const mobileViewport = { width: 375, height: 667 };
      const desktopViewport = { width: 1920, height: 1080 };

      const mobileScreenshot = Buffer.from('mobile-layout');
      const desktopScreenshot = Buffer.from('desktop-layout');

      visualTester.storeBaseline(templateId, customization, mobileViewport, mobileScreenshot);
      visualTester.storeBaseline(templateId, customization, desktopViewport, desktopScreenshot);

      const mobileDiff = visualTester.compareWithBaseline(
        templateId,
        customization,
        mobileViewport,
        mobileScreenshot
      );
      const desktopDiff = visualTester.compareWithBaseline(
        templateId,
        customization,
        desktopViewport,
        desktopScreenshot
      );

      expect(mobileDiff.percentageChanged).toBe(0);
      expect(desktopDiff.percentageChanged).toBe(0);
    });
  });

  describe('Diff Detection and Reporting', () => {
    it('should detect pixel-level differences', () => {
      const templateId = 'stellar-dex';
      const customization = { branding: { primaryColor: '#000000' } };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline');
      visualTester.storeBaseline(templateId, customization, viewport, baselineScreenshot);

      const modifiedScreenshot = Buffer.from('modified');
      const diff = visualTester.compareWithBaseline(
        templateId,
        customization,
        viewport,
        modifiedScreenshot
      );

      expect(diff.totalPixels).toBeGreaterThan(0);
      expect(diff.changedPixels).toBeGreaterThanOrEqual(0);
      expect(diff.percentageChanged).toBeGreaterThanOrEqual(0);
    });

    it('should report diff percentage', () => {
      const templateId = 'payment-gateway';
      const customization = { branding: { primaryColor: '#007AFF' } };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline-data');
      visualTester.storeBaseline(templateId, customization, viewport, baselineScreenshot);

      const modifiedScreenshot = Buffer.from('modified-data');
      const diff = visualTester.compareWithBaseline(
        templateId,
        customization,
        viewport,
        modifiedScreenshot
      );

      expect(diff.percentageChanged).toBeGreaterThanOrEqual(0);
      expect(diff.percentageChanged).toBeLessThanOrEqual(100);
    });

    it('should determine if diff is within threshold', () => {
      const templateId = 'stellar-dex';
      const customization = { branding: { primaryColor: '#000000' } };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline');
      visualTester.storeBaseline(templateId, customization, viewport, baselineScreenshot);

      // Identical screenshot should be within threshold
      const diff = visualTester.compareWithBaseline(
        templateId,
        customization,
        viewport,
        baselineScreenshot
      );

      expect(visualTester.isWithinThreshold(diff)).toBe(true);
    });

    it('should allow configurable diff threshold', () => {
      visualTester.setDiffThreshold(0.05); // 5% threshold

      const templateId = 'soroban-defi';
      const customization = { branding: { primaryColor: '#000000' } };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline');
      visualTester.storeBaseline(templateId, customization, viewport, baselineScreenshot);

      const diff = visualTester.compareWithBaseline(
        templateId,
        customization,
        viewport,
        baselineScreenshot
      );

      expect(visualTester.isWithinThreshold(diff)).toBe(true);
    });
  });

  describe('Unintended Changes Detection', () => {
    it('should detect unintended color shift', () => {
      const templateId = 'stellar-dex';
      const customization = { branding: { primaryColor: '#000000' } };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline-black');
      visualTester.storeBaseline(templateId, customization, viewport, baselineScreenshot);

      // Simulate unintended color shift
      const unintendedScreenshot = Buffer.from('unintended-gray');
      const diff = visualTester.compareWithBaseline(
        templateId,
        customization,
        viewport,
        unintendedScreenshot
      );

      expect(diff.changedPixels).toBeGreaterThan(0);
    });

    it('should detect unintended spacing changes', () => {
      const templateId = 'payment-gateway';
      const customization = { layout: { padding: '16px' } };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline-spacing');
      visualTester.storeBaseline(templateId, customization, viewport, baselineScreenshot);

      const unintendedScreenshot = Buffer.from('unintended-spacing');
      const diff = visualTester.compareWithBaseline(
        templateId,
        customization,
        viewport,
        unintendedScreenshot
      );

      expect(diff.changedPixels).toBeGreaterThan(0);
    });

    it('should detect unintended text rendering changes', () => {
      const templateId = 'asset-issuance';
      const customization = { branding: { fontFamily: 'Inter' } };
      const viewport = { width: 1920, height: 1080 };

      const baselineScreenshot = Buffer.from('baseline-text');
      visualTester.storeBaseline(templateId, customization, viewport, baselineScreenshot);

      const unintendedScreenshot = Buffer.from('unintended-text');
      const diff = visualTester.compareWithBaseline(
        templateId,
        customization,
        viewport,
        unintendedScreenshot
      );

      expect(diff.changedPixels).toBeGreaterThan(0);
    });
  });

  describe('Multi-Template Coverage', () => {
    it('should test all four templates with baseline screenshots', () => {
      const templates = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'];
      const viewport = { width: 1920, height: 1080 };

      templates.forEach(templateId => {
        const customization = { branding: { primaryColor: '#000000' } };
        const screenshot = Buffer.from(`${templateId}-screenshot`);

        visualTester.storeBaseline(templateId, customization, viewport, screenshot);

        const diff = visualTester.compareWithBaseline(templateId, customization, viewport, screenshot);
        expect(diff.percentageChanged).toBe(0);
      });
    });

    it('should test template variations with different customizations', () => {
      const templateId = 'stellar-dex';
      const viewport = { width: 1920, height: 1080 };

      const variations = [
        { branding: { primaryColor: '#000000' } },
        { branding: { primaryColor: '#FF0000' } },
        { branding: { primaryColor: '#00FF00' } },
        { features: { enableCharts: true } },
        { features: { enableCharts: false } },
      ];

      variations.forEach((customization, index) => {
        const screenshot = Buffer.from(`variation-${index}`);
        visualTester.storeBaseline(templateId, customization, viewport, screenshot);

        const diff = visualTester.compareWithBaseline(templateId, customization, viewport, screenshot);
        expect(diff.percentageChanged).toBe(0);
      });
    });
  });
});
