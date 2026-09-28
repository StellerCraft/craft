import { NextRequest, NextResponse } from 'next/server';
import { withDeploymentAuth } from '@/lib/api/with-auth';
import { analyticsService } from '@/services/analytics.service';

export const GET = withDeploymentAuth(async (req: NextRequest, { params, supabase }) => {
    try {
        const { data: deployment } = await supabase
            .from('deployments')
            .select('name')
            .eq('id', params.id)
            .single();

        const searchParams = req.nextUrl.searchParams;
        const startDate = searchParams.get('startDate') ? new Date(searchParams.get('startDate')!) : undefined;
        const endDate = searchParams.get('endDate') ? new Date(searchParams.get('endDate')!) : undefined;

        const csv = await analyticsService.exportAnalytics(params.id, startDate, endDate);

        return new NextResponse(csv, {
            headers: {
                'Content-Type': 'text/csv',
                'Content-Disposition': `attachment; filename="analytics-${deployment?.name ?? params.id}-${Date.now()}.csv"`,
            },
        });
    } catch (error: any) {
        console.error('Error exporting analytics:', error);
        const isRowLimitError = error.message?.includes('exceeding limit') ||
                               error.message?.includes('row limit');
        const status = isRowLimitError ? 400 : 500;
        return NextResponse.json(
            { error: error.message || 'Failed to export analytics' },
            { status }
        );
    }
});
