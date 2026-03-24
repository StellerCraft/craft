/**
 * PreviewService
 *
 * Generates real-time previews of customised templates.
 * All blockchain data is sourced exclusively from static mock fixtures —
 * no Stellar network requests are ever made during preview rendering.
 *
 * Design spec: craft-platform, Properties 13 & 14
 */

import type { CustomizationConfig } from '@craft/types';
import type { StellarMockData, MockTransaction } from '@craft/types';

// ── Viewport definitions ──────────────────────────────────────────────────────

export type ViewportClass = 'desktop' | 'tablet' | 'mobile';

export interface ViewportDimensions {
  width: number;
  height: number;
}

export const VIEWPORT_DIMENSIONS: Record<ViewportClass, ViewportDimensions> = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

export const VIEWPORT_CLASSES: ViewportClass[] = [
  'desktop',
  'tablet',
  'mobile',
];

// ── Preview data types ────────────────────────────────────────────────────────

export interface PreviewData {
  /** Inline CSS derived from the customisation config. */
  css: string;
  /** Viewport metadata for the rendered frame. */
  viewport: ViewportDimensions;
  /** All blockchain data — always sourced from mocks, never the network. */
  mockData: StellarMockData;
  /** Branding values applied to the preview. */
  branding: {
    appName: string;
    primaryColor: string;
    secondaryColor: string;
    fontFamily: string;
    logoUrl?: string;
  };
  /** Feature flags reflected in the preview. */
  features: {
    enableCharts: boolean;
    enableTransactionHistory: boolean;
    enableAnalytics: boolean;
    enableNotifications: boolean;
  };
}

export interface LayoutMetadata {
  viewport: ViewportDimensions;
  viewportClass: ViewportClass;
  /** CSS max-width breakpoint applied at this viewport. */
  containerMaxWidth: number;
  /** Whether the sidebar is collapsed at this viewport. */
  sidebarCollapsed: boolean;
  /** Number of grid columns at this viewport. */
  gridColumns: number;
}

// ── Static mock data (never fetched from the network) ────────────────────────

const MOCK_ASSET = { code: 'XLM', issuer: '', type: 'native' as const };

const MOCK_TRANSACTIONS: MockTransaction[] = [
  {
    id: 'tx-001',
    type: 'payment',
    amount: '100.00',
    asset: MOCK_ASSET,
    timestamp: new Date('2024-01-15T10:00:00Z'),
  },
  {
    id: 'tx-002',
    type: 'swap',
    amount: '50.00',
    asset: MOCK_ASSET,
    timestamp: new Date('2024-01-14T09:00:00Z'),
  },
  {
    id: 'tx-003',
    type: 'payment',
    amount: '200.00',
    asset: MOCK_ASSET,
    timestamp: new Date('2024-01-13T08:00:00Z'),
  },
];

export const STATIC_MOCK_DATA: StellarMockData = {
  accountBalance: '1000.00',
  recentTransactions: MOCK_TRANSACTIONS,
  assetPrices: { XLM: 0.12, USDC: 1.0 },
};

// ── Layout metadata derivation ────────────────────────────────────────────────

/**
 * Derive layout metadata for a given viewport class.
 * Pure function — deterministic for any given input.
 */
export function deriveLayoutMetadata(
  viewportClass: ViewportClass
): LayoutMetadata {
  const viewport = VIEWPORT_DIMENSIONS[viewportClass];

  switch (viewportClass) {
    case 'desktop':
      return {
        viewport,
        viewportClass,
        containerMaxWidth: 1280,
        sidebarCollapsed: false,
        gridColumns: 12,
      };
    case 'tablet':
      return {
        viewport,
        viewportClass,
        containerMaxWidth: 720,
        sidebarCollapsed: true,
        gridColumns: 8,
      };
    case 'mobile':
      return {
        viewport,
        viewportClass,
        containerMaxWidth: 360,
        sidebarCollapsed: true,
        gridColumns: 4,
      };
  }
}

// ── CSS generation ────────────────────────────────────────────────────────────

/**
 * Generate preview CSS from a customisation config.
 * Pure function — same config always produces the same CSS string.
 */
export function generatePreviewCss(config: CustomizationConfig): string {
  const { primaryColor, secondaryColor, fontFamily } = config.branding;
  return [
    `:root {`,
    `  --color-primary: ${primaryColor};`,
    `  --color-secondary: ${secondaryColor};`,
    `  --font-family: ${fontFamily}, sans-serif;`,
    `}`,
  ].join('\n');
}

// ── PreviewService ────────────────────────────────────────────────────────────

export class PreviewService {
  /**
   * Generate preview data for a given customisation config and viewport.
   *
   * Invariants (Properties 13 & 14):
   *   - mockData is always STATIC_MOCK_DATA — no network I/O occurs.
   *   - The same (config, viewport) pair always produces structurally
   *     identical output (deterministic).
   *   - All three viewport classes produce valid, non-null PreviewData.
   */
  generatePreview(
    config: CustomizationConfig,
    viewportClass: ViewportClass = 'desktop'
  ): PreviewData {
    return {
      css: generatePreviewCss(config),
      viewport: VIEWPORT_DIMENSIONS[viewportClass],
      mockData: STATIC_MOCK_DATA,
      branding: {
        appName: config.branding.appName,
        primaryColor: config.branding.primaryColor,
        secondaryColor: config.branding.secondaryColor,
        fontFamily: config.branding.fontFamily,
        logoUrl: config.branding.logoUrl,
      },
      features: { ...config.features },
    };
  }

  /**
   * Generate preview data for all supported viewport classes at once.
   * Useful for responsive regression checks.
   */
  generateAllViewports(
    config: CustomizationConfig
  ): Record<ViewportClass, PreviewData> {
    return {
      desktop: this.generatePreview(config, 'desktop'),
      tablet: this.generatePreview(config, 'tablet'),
      mobile: this.generatePreview(config, 'mobile'),
    };
  }

  /**
   * Apply a partial update to an existing config and return a diff-aware result.
   * Reports which fields changed.
   */
  applyUpdate(
    current: CustomizationConfig,
    patch: Partial<CustomizationConfig>
  ): {
    previous: CustomizationConfig;
    updated: CustomizationConfig;
    changedFields: string[];
  } {
    const updated: CustomizationConfig = {
      branding: {
        ...current.branding,
        ...(patch.branding ?? {}),
      },
      features: {
        ...current.features,
        ...(patch.features ?? {}),
      },
      stellar: {
        ...current.stellar,
        ...(patch.stellar ?? {}),
      },
    };

    const changedFields: string[] = [];
    const sections = ['branding', 'features', 'stellar'] as const;
    for (const section of sections) {
      const prev = current[section] as unknown as Record<string, unknown>;
      const next = updated[section] as unknown as Record<string, unknown>;
      for (const key of [...Object.keys(prev), ...Object.keys(next)]) {
        if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
          changedFields.push(`${section}.${key}`);
        }
      }
    }

    return {
      previous: current,
      updated,
      changedFields,
    };
  }
}

export const previewService = new PreviewService();
