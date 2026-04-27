import { describe, it, expect } from 'vitest';
import { costEstimationService, PricingTier, ResourceUsage } from '../../src/services/billing/cost-estimation.service';

describe('CostEstimationService', () => {
    describe('Pricing Tier Calculation', () => {
        const usage: ResourceUsage = {
            cpuCores: 1,
            memoryGB: 2,
            storageGB: 10,
            bandwidthGB: 100,
            durationHours: 720 // 1 month
        };

        it('should calculate correct total cost for Basic tier (base only)', () => {
            const result = costEstimationService.calculateCost(usage, 'basic');
            expect(result.baseTierCost).toBe(10);
            expect(result.totalCost).toBe(10);
        });

        it('should calculate correct total cost for Standard tier (base only)', () => {
            const result = costEstimationService.calculateCost(usage, 'standard');
            expect(result.baseTierCost).toBe(20);
            expect(result.totalCost).toBe(20);
        });

        it('should calculate correct total cost for Premium tier (base only)', () => {
            const result = costEstimationService.calculateCost(usage, 'premium');
            expect(result.baseTierCost).toBe(50);
            expect(result.totalCost).toBe(50);
        });
    });

    describe('Resource Usage Overage Estimation', () => {
        it('should calculate CPU and Memory overages correctly', () => {
            const usage: ResourceUsage = {
                cpuCores: 2, // Basic tier includes 1
                memoryGB: 4,  // Basic tier includes 2
                storageGB: 10,
                bandwidthGB: 100,
                durationHours: 100
            };
            
            // Basic Tier: $10 base
            // CPU overage: (2-1) * $0.01 * 100 = $1.00
            // Memory overage: (4-2) * $0.005 * 100 = $1.00
            // Expected Compute Cost: $2.00
            
            const result = costEstimationService.calculateCost(usage, 'basic');
            expect(result.computeCost).toBe(2.00);
            expect(result.totalCost).toBe(12.00);
        });

        it('should calculate Storage and Bandwidth overages correctly', () => {
            const usage: ResourceUsage = {
                cpuCores: 1,
                memoryGB: 2,
                storageGB: 20,    // Basic includes 10
                bandwidthGB: 200,  // Basic includes 100
                durationHours: 720
            };

            // Basic Tier: $10 base
            // Storage overage: (20-10) * $0.10 = $1.00
            // Bandwidth overage: (200-100) * $0.05 = $5.00
            // Expected total overage: $6.00
            
            const result = costEstimationService.calculateCost(usage, 'basic');
            expect(result.storageCost).toBe(1.00);
            expect(result.networkCost).toBe(5.00);
            expect(result.totalCost).toBe(16.00);
        });

        it('should handle zero usage edge case', () => {
            const usage: ResourceUsage = {
                cpuCores: 0,
                memoryGB: 0,
                storageGB: 0,
                bandwidthGB: 0,
                durationHours: 0
            };
            const result = costEstimationService.calculateCost(usage, 'basic');
            expect(result.totalCost).toBe(10); // Still pays base cost
        });

        it('should handle high usage spikes correctly', () => {
            const usage: ResourceUsage = {
                cpuCores: 64,
                memoryGB: 128,
                storageGB: 1000,
                bandwidthGB: 10000,
                durationHours: 720
            };
            const result = costEstimationService.calculateCost(usage, 'premium');
            // Premium: $50 base
            // CPU: (64-4) * 0.01 * 720 = $432
            // Memory: (128-8) * 0.005 * 720 = $432
            // Storage: (1000-100) * 0.10 = $90
            // Bandwidth: (10000-1000) * 0.05 = $450
            // Total: 50 + 432 + 432 + 90 + 450 = $1454
            expect(result.totalCost).toBe(1454);
        });
    });

    describe('Cost Projection Accuracy', () => {
        it('should project daily, monthly, and yearly costs consistently', () => {
            const breakdown = {
                computeCost: 10,
                storageCost: 5,
                networkCost: 5,
                baseTierCost: 10,
                totalCost: 30
            };

            expect(costEstimationService.projectCost(breakdown, 'daily')).toBe(1.00);
            expect(costEstimationService.projectCost(breakdown, 'monthly')).toBe(30.00);
            expect(costEstimationService.projectCost(breakdown, 'yearly')).toBe(360.00);
        });

        it('should avoid rounding errors in projections', () => {
            const breakdown = {
                computeCost: 1.11,
                storageCost: 1.11,
                networkCost: 1.11,
                baseTierCost: 10,
                totalCost: 13.33
            };
            // 13.33 / 30 = 0.444333... -> 0.44
            expect(costEstimationService.projectCost(breakdown, 'daily')).toBe(0.44);
            expect(costEstimationService.projectCost(breakdown, 'yearly')).toBe(159.96);
        });
    });

    describe('Cost Breakdown Consistency', () => {
        it('should ensure total equals sum of breakdown parts', () => {
            const usage: ResourceUsage = {
                cpuCores: 5,
                memoryGB: 10,
                storageGB: 100,
                bandwidthGB: 500,
                durationHours: 720
            };
            const result = costEstimationService.calculateCost(usage, 'basic');
            const calculatedTotal = result.baseTierCost + result.computeCost + result.storageCost + result.networkCost;
            expect(result.totalCost).toBe(Number(calculatedTotal.toFixed(2)));
        });
    });

    describe('Cost Alert Thresholds', () => {
        it('should trigger alert when cost exceeds threshold', () => {
            const result = costEstimationService.checkAlert(120, 100);
            expect(result.triggered).toBe(true);
            expect(result.message).toContain('exceeded threshold');
        });

        it('should trigger warning when cost is at 90% of threshold', () => {
            const result = costEstimationService.checkAlert(95, 100);
            expect(result.triggered).toBe(true);
            expect(result.message).toContain('approaching threshold');
        });

        it('should not trigger when cost is well below threshold', () => {
            const result = costEstimationService.checkAlert(50, 100);
            expect(result.triggered).toBe(false);
            expect(result.message).toBeNull();
        });
    });
});
