import { NextResponse } from 'next/server';
import { inFlightCount, isDraining } from '@/lib/shutdown-manager';

/**
 * GET /api/health/drain
 *
 * Returns the current drain status of the server, including the number
 * of in-flight deployment operations and whether the server is actively
 * draining.
 */
export async function GET(): Promise<NextResponse> {
    return NextResponse.json({
        inFlightCount: inFlightCount(),
        draining: isDraining(),
    });
}
