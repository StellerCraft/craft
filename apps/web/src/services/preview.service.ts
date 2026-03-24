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
