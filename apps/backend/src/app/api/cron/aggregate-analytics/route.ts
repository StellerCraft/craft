import { NextRequest, NextResponse } from 'next/server';
import { withCronAuth } from '@/lib/api/cron-auth';
import { analyticsAggregationService } from '@/services/analytics-aggregation.service';
import { cronFailureTrackerService } from '@/services/cron-failure-tracker.service';

const JOB_NAME = 'aggregate-analytics';

async function handleAggregateAnalytics(_req: NextRequest) {
    try {
        const [hourly, daily] = await Promise.all([
            analyticsAggregationService.aggregate('1h'),
            analyticsAggregationService.aggregate('24h'),
        ]);

        await cronFailureTrackerService.recordSuccess(JOB_NAME);

        return NextResponse.json({
            success: true,
            hourly: { bucketsWritten: hourly.bucketsWritten },
            daily:  { bucketsWritten: daily.bucketsWritten },
        });
    } catch (error: any) {
        console.error('Analytics aggregation failed:', error);
        const errorMessage = error.message || 'Aggregation failed';
        await cronFailureTrackerService.recordFailure(JOB_NAME, errorMessage);

        return NextResponse.json(
            { error: errorMessage },
            { status: 500 }
        );
    }
}

export const GET = withCronAuth(handleAggregateAnalytics);
