/**
 * Deployment Cost Estimation Service
 * 
 * Calculates infrastructure costs based on resource usage and pricing tiers.
 * Supports Basic, Standard, and Premium tiers with different base costs and included resources.
 */

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

// Overage rates
const OVERAGE_RATES = {
    cpuPerHour: 0.01,    // $0.01 per additional vCPU-hour
    memoryPerHour: 0.005, // $0.005 per additional GB-hour
    storagePerMonth: 0.10, // $0.10 per additional GB-month
    bandwidthPerGB: 0.05,  // $0.05 per additional GB
};

export class CostEstimationService {
    /**
     * Calculate cost for a specific usage and tier
     */
    calculateCost(usage: ResourceUsage, tier: PricingTier): CostBreakdown {
        const config = TIER_CONFIGS[tier];
        
        // Base cost (prorated by duration if less than a month, but usually base cost is monthly)
        // For estimation, we'll use baseMonthlyCost as a starting point if duration is long,
        // or just calculate the incremental cost for the specific duration.
        // Let's assume baseMonthlyCost is the minimum.
        const baseTierCost = config.baseMonthlyCost;

        // Compute Cost (CPU + Memory)
        const cpuOverage = Math.max(0, usage.cpuCores - config.includedCpuCores);
        const memoryOverage = Math.max(0, usage.memoryGB - config.includedMemoryGB);
        
        const computeCost = (cpuOverage * OVERAGE_RATES.cpuPerHour * usage.durationHours) +
                            (memoryOverage * OVERAGE_RATES.memoryPerHour * usage.durationHours);

        // Storage Cost
        const storageOverage = Math.max(0, usage.storageGB - config.includedStorageGB);
        const storageCost = storageOverage * OVERAGE_RATES.storagePerMonth;

        // Network Cost
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

    /**
     * Project costs over time based on current breakdown
     */
    projectCost(breakdown: CostBreakdown, timeframe: 'daily' | 'monthly' | 'yearly'): number {
        // Assume the breakdown is for a 30-day (720-hour) month
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
}

export const costEstimationService = new CostEstimationService();
