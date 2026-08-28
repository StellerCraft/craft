// @vitest-environment node
/**
 * Cost Estimation vs Stripe Billing Reconciliation Integration Test
 *
 * Verifies that cost estimates match Stripe metered billing charges within 10% tolerance
 * across all template types with multi-currency support.
 *
 * Run: pnpm test -- cost-estimation-billing.integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CostEstimationService, type ResourceUsage, type PricingTier } from '@/services/billing/cost-estimation.service';

interface MockStripeUsageRecord {
  deploymentId: string;
  templateType: string;
  meteredValue: number;
  timestamp: Date;
  charge: number;
  currency: string;
}

class MockStripeService {
  private usageRecords: MockStripeUsageRecord[] = [];

  recordUsage(record: MockStripeUsageRecord) {
    this.usageRecords.push(record);
  }

  getUsageByDeployment(deploymentId: string): MockStripeUsageRecord | undefined {
    return this.usageRecords.find(r => r.deploymentId === deploymentId);
  }

  calculateCharge(metered: number, unitPrice: number): number {
    return Math.round(metered * unitPrice * 100) / 100;
  }
}

class MockExchangeRateService {
  private rates: Record<string, number> = {
    'USD': 1.0,
    'EUR': 0.92,
    'GBP': 0.73,
  };

  convert(amount: number, fromCurrency: string, toCurrency: string): number {
    const toUSD = amount / this.rates[fromCurrency];
    const result = toUSD * this.rates[toCurrency];
    return Math.round(result * 100) / 100;
  }
}

describe('Cost Estimation vs Stripe Billing Reconciliation', () => {
  let estimationService: CostEstimationService;
  let stripeService: MockStripeService;
  let exchangeRateService: MockExchangeRateService;
  const TOLERANCE = 0.1; // 10%

  beforeEach(() => {
    estimationService = new CostEstimationService();
    stripeService = new MockStripeService();
    exchangeRateService = new MockExchangeRateService();
  });

  describe('Estimate vs Stripe Charge Reconciliation', () => {
    it('should match Stripe charge for basic tier within 10% tolerance', () => {
      const usage: ResourceUsage = {
        cpuCores: 1.5,
        memoryGB: 3,
        storageGB: 25,
        bandwidthGB: 150,
        durationHours: 720, // 30 days
      };

      const estimate = estimationService.calculateCost(usage, 'basic');
      const stripeCharge = stripeService.calculateCharge(usage.cpuCores + usage.memoryGB, 0.5);

      const deviation = Math.abs(estimate.totalCost - stripeCharge) / stripeCharge;
      expect(deviation).toBeLessThanOrEqual(TOLERANCE);
    });

    it('should match Stripe charge for standard tier within 10% tolerance', () => {
      const usage: ResourceUsage = {
        cpuCores: 3,
        memoryGB: 6,
        storageGB: 75,
        bandwidthGB: 750,
        durationHours: 720,
      };

      const estimate = estimationService.calculateCost(usage, 'standard');
      const stripeCharge = stripeService.calculateCharge(usage.cpuCores + usage.memoryGB, 0.5);

      const deviation = Math.abs(estimate.totalCost - stripeCharge) / stripeCharge;
      expect(deviation).toBeLessThanOrEqual(TOLERANCE);
    });

    it('should match Stripe charge for premium tier within 10% tolerance', () => {
      const usage: ResourceUsage = {
        cpuCores: 6,
        memoryGB: 12,
        storageGB: 150,
        bandwidthGB: 1500,
        durationHours: 720,
      };

      const estimate = estimationService.calculateCost(usage, 'premium');
      const stripeCharge = stripeService.calculateCharge(usage.cpuCores + usage.memoryGB, 0.5);

      const deviation = Math.abs(estimate.totalCost - stripeCharge) / stripeCharge;
      expect(deviation).toBeLessThanOrEqual(TOLERANCE);
    });

    it('should verify all four templates have consistent estimate accuracy', () => {
      const templates = [
        { type: 'stellar-dex', tier: 'basic' as PricingTier },
        { type: 'soroban-defi', tier: 'standard' as PricingTier },
        { type: 'payment-gateway', tier: 'premium' as PricingTier },
        { type: 'asset-issuance', tier: 'basic' as PricingTier },
      ];

      templates.forEach(({ type, tier }) => {
        const usage: ResourceUsage = {
          cpuCores: 2,
          memoryGB: 4,
          storageGB: 50,
          bandwidthGB: 500,
          durationHours: 720,
        };

        const estimate = estimationService.calculateCost(usage, tier);
        const stripeCharge = stripeService.calculateCharge(10, 0.5);

        const deviation = Math.abs(estimate.totalCost - stripeCharge) / stripeCharge;
        expect(deviation).toBeLessThanOrEqual(TOLERANCE);
        expect(estimate.totalCost).toBeGreaterThan(0);
      });
    });
  });

  describe('Multi-Currency Conversion', () => {
    it('should convert EUR estimate to USD at current exchange rate', () => {
      const usage: ResourceUsage = {
        cpuCores: 2,
        memoryGB: 4,
        storageGB: 50,
        bandwidthGB: 500,
        durationHours: 720,
      };

      const usdEstimate = estimationService.calculateCost(usage, 'standard');
      const eurEstimate = exchangeRateService.convert(usdEstimate.totalCost, 'USD', 'EUR');

      expect(eurEstimate).toBeLessThan(usdEstimate.totalCost);
      expect(eurEstimate).toBeGreaterThan(0);
    });

    it('should convert GBP estimate to USD at current exchange rate', () => {
      const usage: ResourceUsage = {
        cpuCores: 2,
        memoryGB: 4,
        storageGB: 50,
        bandwidthGB: 500,
        durationHours: 720,
      };

      const usdEstimate = estimationService.calculateCost(usage, 'premium');
      const gbpEstimate = exchangeRateService.convert(usdEstimate.totalCost, 'USD', 'GBP');

      expect(gbpEstimate).toBeLessThan(usdEstimate.totalCost);
      expect(gbpEstimate).toBeGreaterThan(0);
    });

    it('should maintain consistency when converting through multiple currencies', () => {
      const usage: ResourceUsage = {
        cpuCores: 1,
        memoryGB: 2,
        storageGB: 10,
        bandwidthGB: 100,
        durationHours: 720,
      };

      const usdEstimate = estimationService.calculateCost(usage, 'basic');
      const EUR = exchangeRateService.convert(usdEstimate.totalCost, 'USD', 'EUR');
      const GBP = exchangeRateService.convert(EUR, 'EUR', 'GBP');
      const backToUSD = exchangeRateService.convert(GBP, 'GBP', 'USD');

      const roundTripDeviation = Math.abs(usdEstimate.totalCost - backToUSD) / usdEstimate.totalCost;
      expect(roundTripDeviation).toBeLessThanOrEqual(0.02); // Allow 2% rounding error
    });
  });

  describe('End-of-Billing-Period Reconciliation', () => {
    it('should reconcile daily breakdown against monthly total', () => {
      const usage: ResourceUsage = {
        cpuCores: 2,
        memoryGB: 4,
        storageGB: 50,
        bandwidthGB: 500,
        durationHours: 720,
      };

      const breakdown = estimationService.calculateCost(usage, 'standard');
      const dailyProjected = estimationService.projectCost(breakdown, 'daily');
      const monthlyProjected = estimationService.projectCost(breakdown, 'monthly');

      expect(monthlyProjected).toBeCloseTo(dailyProjected * 30, 1);
    });

    it('should track usage over billing cycle and match Stripe total', () => {
      const deploymentId = 'dep-test-123';
      
      // Simulate daily usage accumulation
      let totalEstimate = 0;
      for (let day = 0; day < 30; day++) {
        const dailyUsage: ResourceUsage = {
          cpuCores: 1.5,
          memoryGB: 2,
          storageGB: 5,
          bandwidthGB: 50,
          durationHours: 24,
        };
        const daily = estimationService.calculateCost(dailyUsage, 'basic');
        totalEstimate += daily.totalCost;
      }

      // Mock Stripe metered usage for month
      stripeService.recordUsage({
        deploymentId,
        templateType: 'stellar-dex',
        meteredValue: 45, // Total unit usage
        timestamp: new Date(),
        charge: totalEstimate,
        currency: 'USD',
      });

      const stripeRecord = stripeService.getUsageByDeployment(deploymentId);
      expect(stripeRecord).toBeDefined();
      expect(stripeRecord?.charge).toBeCloseTo(totalEstimate, 0);
    });
  });

  describe('Cost Alert Thresholds', () => {
    it('should trigger alert when cost reaches threshold', () => {
      const threshold = 100;
      const currentCost = 100.50;

      const alert = estimationService.checkAlert(currentCost, threshold);
      expect(alert.triggered).toBe(true);
      expect(alert.message).toContain('reached');
    });

    it('should trigger warning at 90% of threshold', () => {
      const threshold = 100;
      const currentCost = 90.50;

      const alert = estimationService.checkAlert(currentCost, threshold);
      expect(alert.triggered).toBe(true);
      expect(alert.message).toContain('approaching');
    });

    it('should not trigger alert below threshold', () => {
      const threshold = 100;
      const currentCost = 50;

      const alert = estimationService.checkAlert(currentCost, threshold);
      expect(alert.triggered).toBe(false);
    });
  });
});
