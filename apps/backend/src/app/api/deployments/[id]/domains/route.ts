/**
 * POST /api/deployments/[id]/domains
 *
 * Adds a custom domain to a deployment and returns DNS configuration
 * instructions so the user can point their domain to the deployment.
 *
 * Authentication & ownership:
 *   Requires a valid session (401) and ownership of the deployment (403).
 *
 * Request body:
 *   { "customDomain": "app.example.com" }
 *
 * Responses:
 *   200 — Domain saved; DNS configuration returned
 *         { domain, records, providerInstructions, notes }
 *   400 — Missing or invalid domain
 *   401 — Not authenticated
 *   403 — Not authorized for this deployment
 *   404 — Deployment not found
 *   500 — Unexpected error
 *
 * Issue: #204
 * Branch: create-post-domain-configuration-api-route
 */

import { NextRequest, NextResponse } from 'next/server';
import { withDeploymentAuth } from '@/lib/api/with-auth';
import { validateCustomDomain } from '@/lib/customization/validate-domain';
import { generateDnsConfiguration } from '@/lib/dns/dns-configuration';

export const POST = withDeploymentAuth(async (req: NextRequest, { params, supabase }) => {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawDomain = (body as Record<string, unknown>)?.customDomain;
    const validation = validateCustomDomain(rawDomain);

    if (!validation.valid) {
        return NextResponse.json(
            { error: validation.message, field: validation.field, code: validation.code },
            { status: 400 },
        );
    }

    const { domain } = validation;

    const { error: updateError } = await supabase
        .from('deployments')
        .update({ custom_domain: domain, updated_at: new Date().toISOString() })
        .eq('id', params.id);

    if (updateError) {
        const isUniquenessViolation = updateError.message?.includes('unique constraint') ||
                                      updateError.message?.includes('duplicate key');
        if (isUniquenessViolation) {
            console.warn(`[domains-post] Domain already attached: ${domain}`);
            return NextResponse.json(
                { error: 'Domain already attached to another deployment' },
                { status: 409 }
            );
        }
        console.error(`[domains-post] Failed to save domain for ${params.id}:`, updateError.message);
        return NextResponse.json({ error: 'Failed to save domain' }, { status: 500 });
    }

    const config = generateDnsConfiguration(domain);
    return NextResponse.json(config);
});
