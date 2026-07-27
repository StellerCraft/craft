import { describe, expect, it } from 'vitest';
import { CostEstimationService } from './cost-estimation.service';

const service = new CostEstimationService();

describe('CostEstimationService', () => {
  it('applies soroban invocation, feature, and compute costs to the complexity score', () => {
    const estimate = service.estimateDeploymentCost({
      customizationConfig: {
        branding: {
          appName: 'Test DEX',
          primaryColor: '#4f9eff',
          secondaryColor: '#1a1f36',
          fontFamily: 'Inter',
        },
        features: {
          enableCharts: true,
          enableTransactionHistory: true,
          enableAnalytics: false,
          enableNotifications: false,
        },
        stellar: {
          network: 'testnet',
          horizonUrl: 'https://horizon-testnet.stellar.org',
          contractAddresses: { vault: 'CC123' },
        },
      },
      tier: 'standard',
      vercelComputeHours: 3,
    });

    expect(estimate.complexityScore).toBe(33.56);
    expect(estimate.breakdown.sorobanInvocationCost).toBe(7.5);
    expect(estimate.breakdown.featureCost).toBe(6);
    expect(estimate.breakdown.vercelComputeCost).toBe(0.06);
  });

  it('keeps the estimate within a reasonable range for premium deployments', () => {
    const estimate = service.estimateDeploymentCost({
      customizationConfig: {
        branding: {
          appName: 'Premium App',
          primaryColor: '#000000',
          secondaryColor: '#ffffff',
          fontFamily: 'Roboto',
        },
        features: {
          enableCharts: false,
          enableTransactionHistory: false,
          enableAnalytics: false,
          enableNotifications: false,
        },
        stellar: {
          network: 'mainnet',
          horizonUrl: 'https://horizon.stellar.org',
        },
      },
      tier: 'premium',
      vercelComputeHours: 24,
    });

    expect(estimate.complexityScore).toBe(50.48);
    expect(estimate.estimatedYearlyCost).toBe(605.76);
  });

  it('stays within 10% of a known Stripe monthly charge during billing reconciliation', () => {
    const actualStripeCharge = 40.5;
    const estimate = service.estimateDeploymentCost({
      customizationConfig: {
        branding: {
          appName: 'Reconciled App',
          primaryColor: '#123456',
          secondaryColor: '#abcdef',
          fontFamily: 'Inter',
        },
        features: {
          enableCharts: true,
          enableTransactionHistory: false,
          enableAnalytics: true,
          enableNotifications: false,
        },
        stellar: {
          network: 'testnet',
          horizonUrl: 'https://horizon-testnet.stellar.org',
          contractAddresses: { vault: 'CC123', market: 'CC456' },
        },
      },
      tier: 'standard',
      vercelComputeHours: 5,
    });

    const variance = Math.abs(estimate.estimatedMonthlyCost - actualStripeCharge) / actualStripeCharge;
    expect(variance).toBeLessThanOrEqual(0.1);
  });
});
