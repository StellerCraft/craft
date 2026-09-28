import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { SUPPORTED_REGIONS } from '../_shared/regions.ts';
import { getRegionalSupabaseAdmin } from '../regional-auth/auth-utils.ts';
import { repairUserStateConsistency } from '../regional-auth/consistency-validators.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const reconciliationToken = Deno.env.get('REGIONAL_AUTH_RECONCILIATION_TOKEN');
  if (!reconciliationToken || req.headers.get('authorization') !== `Bearer ${reconciliationToken}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let scanned = 0;
  let repaired = 0;
  let pending = 0;
  const failedRegions: string[] = [];

  for (const region of SUPPORTED_REGIONS) {
    const admin = getRegionalSupabaseAdmin(region);
    const { data: records, error } = await admin
      .from('auth_audit_logs')
      .select('id, user_id, region, details')
      .eq('event_type', 'failure')
      .contains('details', { syncStatus: 'pending' })
      .not('user_id', 'is', null)
      .limit(100);

    if (error) {
      failedRegions.push(region);
      console.error(`Failed to load pending signup repairs in ${region}:`, error.message);
      continue;
    }

    for (const record of records ?? []) {
      scanned++;
      let isRepaired = false;

      try {
        const result = await repairUserStateConsistency(record.user_id, record.region);
        isRepaired = result.repaired;
      } catch (repairError) {
        console.error(`Pending signup repair failed for ${record.user_id}:`, repairError);
      }

      const details = {
        ...((record.details ?? {}) as Record<string, unknown>),
        syncStatus: isRepaired ? 'complete' : 'pending',
        needsRepair: !isRepaired,
        repairAttemptedAt: new Date().toISOString(),
      };
      const { error: updateError } = await admin
        .from('auth_audit_logs')
        .update({ details })
        .eq('id', record.id);

      if (updateError) {
        failedRegions.push(region);
        pending++;
        console.error(`Failed to update signup repair record ${record.id}:`, updateError.message);
      } else if (isRepaired) {
        repaired++;
      } else {
        pending++;
      }
    }
  }

  return new Response(JSON.stringify({ scanned, repaired, pending, failedRegions }), {
    status: failedRegions.length ? 503 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
});