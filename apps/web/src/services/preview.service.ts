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
    private templateCategory?: TemplateCategory;

    /**
     * Set template category for context-specific mock data generation.
     */
    setTemplateCategory(category?: TemplateCategory): void {
        this.templateCategory = category;
    }

    /**
     * Generate a full preview config for a template, optionally overlaying a
     * saved customization. No network access is required — all data is passed in.
     */
    generatePreview(
        template: Template,
        savedConfig?: Partial<CustomizationConfig> | null
    ): PreviewConfig {
        const base = buildDefaultConfigFromTemplate(template);
        const merged = normalizeDraftConfig(
            savedConfig
                ? {
                      branding: { ...base.branding, ...(savedConfig.branding ?? {}) },
                      features: { ...base.features, ...(savedConfig.features ?? {}) },
                      stellar: { ...base.stellar, ...(savedConfig.stellar ?? {}) },
                  }
                : base
        );

        const validation = validateCustomizationConfig(merged);

        const enabledFeatures: string[] = [];
        const disabledFeatures: string[] = [];
        for (const key of Object.keys(merged.features)) {
            const val = (merged.features as unknown as Record<string, boolean>)[key];
            if (val === true) {
                enabledFeatures.push(key);
            } else {
                disabledFeatures.push(key);
            }
        }
    }

    /**
     * Update preview with partial customization changes.
     * Detects changed fields and only regenerates mock data if network config changed.
     * Returns minimal update payload for efficient iframe updates.
     */
    updatePreview(
        currentCustomization: CustomizationConfig,
        changes: DeepPartial<CustomizationConfig>
    ): { customization: CustomizationConfig; mockData?: StellarMockData; changedFields: string[]; timestamp: string } {
        const updatedCustomization = this.mergeCustomization(currentCustomization, changes);
        const changedFields = this.detectChangedFields(currentCustomization, changes);
        const requiresMockDataRefresh = this.requiresMockDataRefresh(changedFields);

        const payload: any = {
            customization: updatedCustomization,
            changedFields,
            timestamp: new Date().toISOString(),
        };

        if (requiresMockDataRefresh) {
            payload.mockData = this.generateMockData(updatedCustomization);
        }

        return payload;
    }

    /**
     * Deep merge partial changes into current customization.
     */
    private mergeCustomization(
        current: CustomizationConfig,
        changes: DeepPartial<CustomizationConfig>
    ): CustomizationConfig {
        return {
            branding: { ...current.branding, ...(changes.branding ?? {}) },
            features: { ...current.features, ...(changes.features ?? {}) },
            stellar: { ...current.stellar, ...(changes.stellar ?? {}) },
        };
    }

    /**
     * Detect which fields changed by comparing current and changes.
     * Returns array of dot-notation field paths (e.g., "branding.appName").
     */
    private detectChangedFields(
        current: CustomizationConfig,
        changes: DeepPartial<CustomizationConfig>
    ): string[] {
        const fields: string[] = [];

        if (changes.branding) {
            Object.keys(changes.branding).forEach((key) => {
                const currentVal = (current.branding as any)[key];
                const changeVal = (changes.branding as any)[key];
                if (currentVal !== changeVal) {
                    fields.push(`branding.${key}`);
                }
            });
        }

        if (changes.features) {
            Object.keys(changes.features).forEach((key) => {
                const currentVal = (current.features as any)[key];
                const changeVal = (changes.features as any)[key];
                if (currentVal !== changeVal) {
                    fields.push(`features.${key}`);
                }
            });
        }

        if (changes.stellar) {
            Object.keys(changes.stellar).forEach((key) => {
                const currentVal = (current.stellar as any)[key];
                const changeVal = (changes.stellar as any)[key];
                if (currentVal !== changeVal) {
                    fields.push(`stellar.${key}`);
                }
            });
        }

        return fields;
    }

    /**
     * Determine if mock data needs to be regenerated.
     * Only network changes require mock data refresh.
     */
    private requiresMockDataRefresh(changedFields: string[]): boolean {
        return changedFields.some((field) => field.startsWith('stellar.network'));
    }

    /**
     * Apply a partial update to an existing config and return a diff-aware result.
     * Validates the resulting config and reports which fields changed.
     */
    applyUpdate(
        current: CustomizationConfig,
        patch: Partial<CustomizationConfig>
    ): PreviewUpdateResult {
        const updated = normalizeDraftConfig({
            branding: { ...current.branding, ...(patch.branding ?? {}) },
            features: { ...current.features, ...(patch.features ?? {}) },
            stellar: { ...current.stellar, ...(patch.stellar ?? {}) },
        });

        const validation = validateCustomizationConfig(updated);
        const changedFields = diffConfigs(current, updated);

        return {
            previous: current,
            updated,
            changedFields,
            isValid: validation.valid,
            validationErrors: validation.errors,
        };
    }
}

export const previewService = new PreviewService();
