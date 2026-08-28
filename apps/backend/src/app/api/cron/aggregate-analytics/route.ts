import { NextRequest, NextResponse } from 'next/server';
import { withCronAuth } from '@/lib/api/cron-auth';
import { analyticsAggregationService } from '@/services/analytics-aggregation.service';

async function handleAggregateAnalytics(_req: NextRequest) {
    try {
        const [hourly, daily] = await Promise.all([
            analyticsAggregationService.aggregate('1h'),
            analyticsAggregationService.aggregate('24h'),
        ]);

        return NextResponse.json({
            success: true,
            hourly: { bucketsWritten: hourly.bucketsWritten },
            daily:  { bucketsWritten: daily.bucketsWritten },
        });
    } catch (error: any) {
        console.error('Analytics aggregation failed:', error);
        return NextResponse.json(
            { error: error.message || 'Aggregation failed' },
            { status: 500 }
        );
    }
}

export const GET = withCronAuth(handleAggregateAnalytics);
