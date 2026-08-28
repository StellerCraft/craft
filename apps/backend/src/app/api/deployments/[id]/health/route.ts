import { NextRequest, NextResponse } from 'next/server';
import { withDeploymentAuth } from '@/lib/api/with-auth';
import { healthMonitorService } from '@/services/health-monitor.service';
import { VercelService } from '@/services/vercel.service';

const vercelService = new VercelService();

export const GET = withDeploymentAuth(async (_req: NextRequest, { params }) => {
    try {
        const health = await healthMonitorService.checkDeploymentHealth(params.id);
        return NextResponse.json({
            ...health,
            circuitState: vercelService.breaker.currentState,
        });
    } catch (error: any) {
        console.error('Error checking deployment health:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to check deployment health' },
            { status: 500 }
        );
    }
});
