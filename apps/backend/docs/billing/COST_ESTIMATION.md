# Deployment Cost Estimation Methodology

This document describes the methodology, pricing assumptions, and formulas used for estimating infrastructure costs on the CRAFT platform.

## Pricing Tiers

We offer three infrastructure tiers with different resource inclusions:

| Tier | Monthly Base Cost | Included CPU | Included RAM | Included Storage | Included Bandwidth |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Basic** | $10 | 1 vCPU | 2 GB | 10 GB | 100 GB |
| **Standard** | $20 | 2 vCPU | 4 GB | 50 GB | 500 GB |
| **Premium** | $50 | 4 vCPU | 8 GB | 100 GB | 1000 GB |

## Overage Rates

Usage exceeding the tier inclusions is billed at the following rates:

- **CPU**: $0.01 per additional vCPU-hour
- **Memory**: $0.005 per additional GB-hour
- **Storage**: $0.10 per additional GB-month
- **Bandwidth**: $0.05 per additional GB

## Calculation Formulas

### 1. Compute Cost
Compute cost is the sum of CPU and Memory overages calculated hourly.

$$ComputeCost = (CPU_{overage} \times Rate_{CPU} \times Hours) + (RAM_{overage} \times Rate_{RAM} \times Hours)$$

### 2. Storage Cost
Storage is billed based on the peak storage used during the month above the inclusion.

$$StorageCost = Storage_{overage} \times Rate_{Storage}$$

### 3. Network Cost
Bandwidth is billed per GB transferred above the inclusion.

$$NetworkCost = Bandwidth_{overage} \times Rate_{Bandwidth}$$

### 4. Total Cost
The total cost is the sum of the base tier cost and all overage costs.

$$TotalCost = BaseCost + ComputeCost + StorageCost + NetworkCost$$

## Projections

- **Daily**: Total Monthly Cost / 30
- **Monthly**: Total Monthly Cost (calculated above)
- **Yearly**: Total Monthly Cost × 12

## Alerts

- **Warning**: Triggered at 90% of the set cost threshold.
- **Critical Alert**: Triggered at 100% of the set cost threshold.
