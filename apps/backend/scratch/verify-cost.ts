import { costEstimationService } from '../src/services/billing/cost-estimation.service';

const usage = {
    cpuCores: 2,
    memoryGB: 4,
    storageGB: 10,
    bandwidthGB: 100,
    durationHours: 100
};

const result = costEstimationService.calculateCost(usage, 'basic');
console.log('Calculation Result:', JSON.stringify(result, null, 2));

const projection = costEstimationService.projectCost(result, 'monthly');
console.log('Monthly Projection:', projection);

const alert = costEstimationService.checkAlert(result.totalCost, 10);
console.log('Alert Check:', JSON.stringify(alert, null, 2));

if (result.totalCost === 12) {
    console.log('✅ Basic calculation passed');
} else {
    console.log('❌ Basic calculation failed');
}
