import type { CustomizationConfig, Template } from '@craft/types';
import { normalizeDraftConfig } from './customization-draft.service';
import { validateCustomizationConfig } from '@/lib/customization/validate';

export interface PreviewConfig {
    templateId: string;
    templateName: string;
    previewImageUrl: string;
    customization: CustomizationConfig;
    enabledFeatures: string[];
    disabledFeatures: string[];
    isValid: boolean;
    validationErrors: Array<{ field: string; message: string; code: string }>;
}

export interface PreviewUpdateResult {
    previous: CustomizationConfig;
    updated: CustomizationConfig;
    changedFields: string[];
    isValid: boolean;
    validationErrors: Array<{ field: string; message: string; code: string }>;
}

/**
 * Derive the default CustomizationConfig from a template's customization schema.
 * Falls back to safe defaults for any missing schema fields.
 */
export function buildDefaultConfigFromTemplate(template: Template): CustomizationConfig {
    const schema = (template.customizationSchema ?? {}) as Record<string, any>;
    const rawFeatures = (schema.features ?? {}) as Record<string, any>;
    const featureDefaults: Record<string, boolean> = {};

    for (const key of Object.keys(rawFeatures)) {
        featureDefaults[key] = rawFeatures[key]?.default ?? false;
    }

    return normalizeDraftConfig({
        features: {
            enableCharts: featureDefaults['enableCharts'] ?? true,
            enableTransactionHistory: featureDefaults['enableTransactionHistory'] ?? true,
            enableAnalytics: featureDefaults['enableAnalytics'] ?? false,
            enableNotifications: featureDefaults['enableNotifications'] ?? false,
        },
    });
}

/**
 * Collect the flat dot-notation paths that differ between two configs.
 * Only inspects the three top-level sections: branding, features, stellar.
 */
export function diffConfigs(
    previous: CustomizationConfig,
    updated: CustomizationConfig
): string[] {
    const changed: string[] = [];

    const sections = ['branding', 'features', 'stellar'] as const;
    for (const section of sections) {
        const prev = previous[section] as unknown as Record<string, unknown>;
        const next = updated[section] as unknown as Record<string, unknown>;
        const seen: Record<string, true> = {};
        const keys: string[] = [];
        for (const k of [...Object.keys(prev), ...Object.keys(next)]) {
            if (!seen[k]) { seen[k] = true; keys.push(k); }
        }
        for (const key of keys) {
            if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
                changed.push(`${section}.${key}`);
            }
        }
    }

    return changed;
}

export class PreviewService {
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

        return {
            templateId: template.id,
            templateName: template.name,
            previewImageUrl: template.previewImageUrl,
            customization: merged,
            enabledFeatures,
            disabledFeatures,
            isValid: validation.valid,
            validationErrors: validation.errors,
        };
    }
    /**
     * Update preview with partial customization changes.
     * Detects changed fields and only regenerates mock data if network config changed.
     * Returns minimal update payload for efficient iframe updates.
     */
    updatePreview(
        currentCustomization: CustomizationConfig,
        changes: Partial<CustomizationConfig>
    ): { customization: CustomizationConfig; mockData?: StellarMockData; changedFields: string[]; timestamp: string } {
        // Merge changes into current config
        const updatedCustomization = this.mergeCustomization(currentCustomization, changes);

        // Detect which fields changed
        const changedFields = this.detectChangedFields(currentCustomization, changes);

        // Determine if mock data needs refresh (network config changed)
        const requiresMockDataRefresh = this.requiresMockDataRefresh(changedFields);

        const payload: any = {
            customization: updatedCustomization,
            changedFields,
            timestamp: new Date().toISOString(),
        };

        // Only regenerate mock data if network config changed
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
        changes: Partial<CustomizationConfig>
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
        changes: Partial<CustomizationConfig>
    ): string[] {
        const fields: string[] = [];

        // Check branding changes
        if (changes.branding) {
            Object.keys(changes.branding).forEach((key) => {
                const currentVal = (current.branding as any)[key];
                const changeVal = (changes.branding as any)[key];
                if (currentVal !== changeVal) {
                    fields.push(`branding.${key}`);
                }
            });
        }

        // Check feature changes
        if (changes.features) {
            Object.keys(changes.features).forEach((key) => {
                const currentVal = (current.features as any)[key];
                const changeVal = (changes.features as any)[key];
                if (currentVal !== changeVal) {
                    fields.push(`features.${key}`);
                }
            });
        }

        // Check stellar changes
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
