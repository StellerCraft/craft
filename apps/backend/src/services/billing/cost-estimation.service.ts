/**
 * Deployment Cost Estimation Service
 *
 * Calculates infrastructure costs based on resource usage and pricing tiers.
 * Supports Basic, Standard, and Premium tiers with different base costs and included resources.
 */

import type { CustomizationConfig } from '@craft/types';

export type PricingTier = 'basic' | 'standard' | 'premium';

export interface ResourceUsage {
    cpuCores: number;        // vCPUs
    memoryGB: number;        // GB
    storageGB: number;       // GB
    bandwidthGB: number;     // GB
    durationHours: number;   // Hours of usage
}

export interface CostBreakdown {
    computeCost: number;     // CPU + Memory
    storageCost: number;
    networkCost: number;     // Bandwidth
    baseTierCost: number;
    totalCost: number;
}

export interface ProjectedCost {
    daily: number;
    monthly: number;
    yearly: number;
}

export interface TierConfig {
    name: PricingTier;
    baseMonthlyCost: number;
    includedCpuCores: number;
    includedMemoryGB: number;
    includedStorageGB: number;
    includedBandwidthGB: number;
}

export interface DeploymentComplexityInput {
    customizationConfig?: Partial<CustomizationConfig> | null;
    sorobanInvocationCount?: number;
    vercelComputeUnits?: number;
}

export interface DeploymentCostEstimate {
    currency: 'USD';
    baseCost: number;
    computeCost: number;
    sorobanInvocationCost: number;
    featureCost: number;
    enabledFeatureCount: number;
    sorobanInvocations: number;
    complexityScore: number;
    totalCost: number;
    breakdown: {
        baseCost: number;
        computeCost: number;
        sorobanInvocationCost: number;
        featureCost: number;
        total: number;
    };
}

export const TIER_CONFIGS: Record<PricingTier, TierConfig> = {
    basic: {
        name: 'basic',
        baseMonthlyCost: 10,
        includedCpuCores: 1,
        includedMemoryGB: 2,
        includedStorageGB: 10,
        includedBandwidthGB: 100,
    },
    standard: {
        name: 'standard',
        baseMonthlyCost: 20,
        includedCpuCores: 2,
        includedMemoryGB: 4,
        includedStorageGB: 50,
        includedBandwidthGB: 500,
    },
    premium: {
        name: 'premium',
        baseMonthlyCost: 50,
        includedCpuCores: 4,
        includedMemoryGB: 8,
        includedStorageGB: 100,
        includedBandwidthGB: 1000,
    },
};

const OVERAGE_RATES = {
    cpuPerHour: 0.01,
    memoryPerHour: 0.005,
    storagePerMonth: 0.10,
    bandwidthPerGB: 0.05,
    deploymentBaseCost: 12.5,
    sorobanInvocationCost: 2.5,
    featureCost: 2.5,
    vercelComputeCostPerUnit: 1.5,
};

function roundCurrency(value: number): number {
    return Number(value.toFixed(2));
}

function normalizeNumber(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, value);
}

export class CostEstimationService {
    /**
     * Calculate cost for a specific usage and tier
     */
    calculateCost(usage: ResourceUsage, tier: PricingTier): CostBreakdown {
        const config = TIER_CONFIGS[tier];

        const baseTierCost = config.baseMonthlyCost;
        const cpuOverage = Math.max(0, usage.cpuCores - config.includedCpuCores);
        const memoryOverage = Math.max(0, usage.memoryGB - config.includedMemoryGB);

        const computeCost = (cpuOverage * OVERAGE_RATES.cpuPerHour * usage.durationHours) +
                            (memoryOverage * OVERAGE_RATES.memoryPerHour * usage.durationHours);

        const storageOverage = Math.max(0, usage.storageGB - config.includedStorageGB);
        const storageCost = storageOverage * OVERAGE_RATES.storagePerMonth;

        const bandwidthOverage = Math.max(0, usage.bandwidthGB - config.includedBandwidthGB);
        const networkCost = bandwidthOverage * OVERAGE_RATES.bandwidthPerGB;

        const totalCost = baseTierCost + computeCost + storageCost + networkCost;

        return {
            computeCost: Number(computeCost.toFixed(2)),
            storageCost: Number(storageCost.toFixed(2)),
            networkCost: Number(networkCost.toFixed(2)),
            baseTierCost: Number(baseTierCost.toFixed(2)),
            totalCost: Number(totalCost.toFixed(2)),
        };
    }

    calculateTemplateComplexityScore(input: DeploymentComplexityInput): DeploymentCostEstimate {
        const config = (input.customizationConfig && typeof input.customizationConfig === 'object')
            ? input.customizationConfig as Partial<CustomizationConfig>
            : {};

        const featureConfig = (config.features && typeof config.features === 'object') ? config.features : {};
        const stellarConfig = (config.stellar && typeof config.stellar === 'object') ? config.stellar : {};

        const enabledFeatureCount = Object.values(featureConfig).filter(Boolean).length;
        const sorobanInvocations = Math.max(
            normalizeNumber(input.sorobanInvocationCount, 0),
            Object.keys((stellarConfig as { contractAddresses?: Record<string, string> }).contractAddresses ?? {}).length,
        );
        const vercelComputeUnits = normalizeNumber(input.vercelComputeUnits, 0.5 + enabledFeatureCount * 0.25);

        const baseCost = OVERAGE_RATES.deploymentBaseCost;
        const computeCost = vercelComputeUnits * OVERAGE_RATES.vercelComputeCostPerUnit;
        const sorobanInvocationCost = sorobanInvocations * OVERAGE_RATES.sorobanInvocationCost;
        const featureCost = enabledFeatureCount * OVERAGE_RATES.featureCost;
        const totalCost = baseCost + computeCost + sorobanInvocationCost + featureCost;

        const estimate: DeploymentCostEstimate = {
            currency: 'USD',
            baseCost: roundCurrency(baseCost),
            computeCost: roundCurrency(computeCost),
            sorobanInvocationCost: roundCurrency(sorobanInvocationCost),
            featureCost: roundCurrency(featureCost),
            enabledFeatureCount,
            sorobanInvocations,
            complexityScore: roundCurrency(totalCost),
            totalCost: roundCurrency(totalCost),
            breakdown: {
                baseCost: roundCurrency(baseCost),
                computeCost: roundCurrency(computeCost),
                sorobanInvocationCost: roundCurrency(sorobanInvocationCost),
                featureCost: roundCurrency(featureCost),
                total: roundCurrency(totalCost),
            },
        };

        return estimate;
    }

    estimateDeploymentCost(input: DeploymentComplexityInput): DeploymentCostEstimate {
        return this.calculateTemplateComplexityScore(input);
    }

    /**
     * Project costs over time based on current breakdown
     */
    projectCost(breakdown: CostBreakdown, timeframe: 'daily' | 'monthly' | 'yearly'): number {
        const monthlyTotal = breakdown.totalCost;

        switch (timeframe) {
            case 'daily':
                return Number((monthlyTotal / 30).toFixed(2));
            case 'monthly':
                return Number(monthlyTotal.toFixed(2));
            case 'yearly':
                return Number((monthlyTotal * 12).toFixed(2));
            default:
                return 0;
        }
    }

    /**
     * Check if cost exceeds a threshold
     */
    checkAlert(currentCost: number, threshold: number): { triggered: boolean; message: string | null } {
        if (currentCost >= threshold) {
            return {
                triggered: true,
                message: `Cost alert: Current cost $${currentCost} has reached or exceeded threshold $${threshold}`,
            };
        }

        if (currentCost >= threshold * 0.9) {
            return {
                triggered: true,
                message: `Cost warning: Current cost $${currentCost} is approaching threshold $${threshold} (90%)`,
            };
        }

        return { triggered: false, message: null };
    }

    /**
     * Calculate complexity-based cost estimation.
     * Complexity score = base cost + N * soroban_invocation_cost + M * feature_cost
     * where base cost includes Vercel compute usage.
     */
    calculateComplexityScore(
        config: CustomizationConfig,
        tier: PricingTier,
        options?: {
            sorobanInvocations?: number;
            vercelComputeUsageSeconds?: number;
        }
    ): number {
        const tierConfig = TIER_CONFIGS[tier] || TIER_CONFIGS['basic'];
        const baseInfrastructureCost = tierConfig.baseMonthlyCost;

        // enabled features count (M)
        const enabledFeaturesCount = Object.values(config.features || {}).filter(Boolean).length;

        // vercel compute usage (estimated if not provided)
        const vercelComputeUsageSeconds = options?.vercelComputeUsageSeconds ?? 
            (100 + enabledFeaturesCount * 50);
        const vercelComputeCostRate = 0.01; // $0.01 per compute second
        const vercelComputeCost = vercelComputeUsageSeconds * vercelComputeCostRate;

        // base cost is infrastructure + Vercel compute cost
        const baseCost = baseInfrastructureCost + vercelComputeCost;

        // Soroban invocations (estimated if not provided)
        // If there's a soroban RPC URL or contract addresses, we assume higher usage
        const hasSoroban = !!(config.stellar?.sorobanRpcUrl || 
                             (config.stellar?.contractAddresses && Object.keys(config.stellar.contractAddresses).length > 0));
        const sorobanInvocations = options?.sorobanInvocations ?? (hasSoroban ? 1000 : 0);
        const sorobanInvocationCost = 0.005; // $0.005 per invocation
        const sorobanCost = sorobanInvocations * sorobanInvocationCost;

        // Features cost
        const featureCostRate = 2.50; // $2.50 per enabled feature
        const featuresCost = enabledFeaturesCount * featureCostRate;

        const totalCost = baseCost + sorobanCost + featuresCost;
        return Number(totalCost.toFixed(2));
    }
}

export const costEstimationService = new CostEstimationService();
