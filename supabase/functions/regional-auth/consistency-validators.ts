/**
 * State Consistency Validators
 * 
 * Ensures auth state consistency across regions.
 * Validates that user profiles are synchronized and
 * tokens are consistent across all regional deployments.
 */

import { SUPPORTED_REGIONS } from '../_shared/regions.ts';
import { getRegionalSupabaseAdmin } from './auth-utils.ts';

export interface ConsistencyCheckResult {
  userId: string;
  consistent: boolean;
  regions: Record<string, RegionState>;
  mismatches: string[];
  syncRequired: boolean;
}

export interface RegionState {
  exists: boolean;
  lastUpdated?: string;
  subscriptionTier?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

/**
 * Check if user profiles are consistent across all regions
 */
export async function validateUserStateConsistency(
  userId: string
): Promise<ConsistencyCheckResult> {
  const regions = SUPPORTED_REGIONS;
  const states: Record<string, RegionState> = {};
  const mismatches: string[] = [];
  let referenceState: RegionState | null = null;
  let referenceRegion: string | null = null;

  // Fetch user profile from all regions
  for (const region of regions) {
    try {
      const admin = getRegionalSupabaseAdmin(region);

      const { data, error } = await admin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        states[region] = {
          exists: false,
          error: error.message,
        };
      } else if (data) {
        states[region] = {
          exists: true,
          lastUpdated: data.updated_at || data.created_at,
          subscriptionTier: data.subscription_tier,
          metadata: {
            created_at: data.created_at,
            updated_at: data.updated_at,
          },
        };

        // Set reference state from first region
        if (!referenceState) {
          referenceState = states[region];
          referenceRegion = region;
        }
      } else {
        states[region] = { exists: false };
      }
    } catch (error) {
      states[region] = {
        exists: false,
        error: String(error),
      };
    }
  }

  // Check for inconsistencies
  if (referenceState) {
    for (const [region, state] of Object.entries(states)) {
      if (region === referenceRegion) continue;

      if (state.exists !== referenceState.exists) {
        mismatches.push(
          `Region ${region} existence differs from ${referenceRegion}`
        );
      }

      if (
        state.subscriptionTier !== referenceState.subscriptionTier &&
        state.exists &&
        referenceState.exists
      ) {
        mismatches.push(
          `Region ${region} subscription tier (${state.subscriptionTier}) differs from ${referenceRegion} (${referenceState.subscriptionTier})`
        );
      }
    }
  }

  const consistent = mismatches.length === 0;

  return {
    userId,
    consistent,
    regions: states,
    mismatches,
    syncRequired: !consistent,
  };
}

/**
 * Check auth token consistency across regions
 */
export async function validateTokenConsistency(
  userId: string,
  accessToken: string
): Promise<{ valid: boolean; regions: Record<string, boolean>; mismatches: string[] }> {
  const regions = SUPPORTED_REGIONS;
  const tokenStates: Record<string, boolean> = {};
  const mismatches: string[] = [];

  // Verify token in each region
  for (const region of regions) {
    try {
      const admin = getRegionalSupabaseAdmin(region);

      const { data: user, error } = await admin.auth.getUser(accessToken);

      if (error || !user) {
        tokenStates[region] = false;
        mismatches.push(`Token invalid in region ${region}`);
      } else if (user.id === userId) {
        tokenStates[region] = true;
      } else {
        tokenStates[region] = false;
        mismatches.push(`Token user ID mismatch in region ${region}`);
      }
    } catch (error) {
      tokenStates[region] = false;
      mismatches.push(`Token verification failed in region ${region}: ${String(error)}`);
    }
  }

  const valid = Object.values(tokenStates).every((state) => state);

  return {
    valid,
    regions: tokenStates,
    mismatches,
  };
}

/**
 * Sync user profile from source region to all other regions
 */
export async function syncUserProfileToAllRegions(
  userId: string,
  sourceRegion: string
): Promise<{ success: boolean; synced: Record<string, boolean>; errors: Record<string, string> }> {
  const regions = SUPPORTED_REGIONS;
  const synced: Record<string, boolean> = {};
  const errors: Record<string, string> = {};

  // Fetch profile from source region
  const sourceAdmin = getRegionalSupabaseAdmin(sourceRegion);
  const { data: sourceProfile, error: sourceError } = await sourceAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (sourceError || !sourceProfile) {
    return {
      success: false,
      synced: {},
      errors: {
        [sourceRegion]: sourceError?.message || 'Profile not found',
      },
    };
  }

  // Sync to all other regions
  for (const region of regions) {
    if (region === sourceRegion) {
      synced[region] = true;
      continue;
    }

    try {
      const admin = getRegionalSupabaseAdmin(region);

      // Check if profile exists
      const { data: existing } = await admin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

      if (existing) {
        // Update existing profile
        const { error: updateError } = await admin
          .from('profiles')
          .update(sourceProfile)
          .eq('id', userId);

        if (updateError) {
          synced[region] = false;
          errors[region] = updateError.message;
        } else {
          synced[region] = true;
        }
      } else {
        // Insert new profile
        const { error: insertError } = await admin
          .from('profiles')
          .insert([sourceProfile]);

        if (insertError) {
          synced[region] = false;
          errors[region] = insertError.message;
        } else {
          synced[region] = true;
        }
      }
    } catch (error) {
      synced[region] = false;
      errors[region] = String(error);
    }
  }

  const success = Object.values(synced).every((s) => s);

  return {
    success,
    synced,
    errors,
  };
}

/**
 * Repair inconsistent user state across regions
 */
export async function repairUserStateConsistency(
  userId: string,
  authorityRegion?: string
): Promise<{
  repaired: boolean;
  authorityRegion: string;
  repairs: Record<string, { repaired: boolean; error?: string }>;
}> {
  const regions = SUPPORTED_REGIONS;
  const repairs: Record<string, { repaired: boolean; error?: string }> = {};

  // Determine authority region (most recent or explicitly specified)
  let selectedAuthority = authorityRegion || 'us-east';

  if (!authorityRegion) {
    let mostRecentRegion = 'us-east';
    let mostRecentTime = new Date(0);

    for (const region of regions) {
      try {
        const admin = getRegionalSupabaseAdmin(region);
        const { data } = await admin
          .from('profiles')
          .select('updated_at')
          .eq('id', userId)
          .single();

        if (data?.updated_at) {
          const updateTime = new Date(data.updated_at);
          if (updateTime > mostRecentTime) {
            mostRecentTime = updateTime;
            mostRecentRegion = region;
          }
        }
      } catch {
        // Skip regions with errors
      }
    }

    selectedAuthority = mostRecentRegion;
  }

  // Sync from authority region to all others
  const syncResult = await syncUserProfileToAllRegions(userId, selectedAuthority);

  // Build repairs map
  for (const region of regions) {
    if (region === selectedAuthority) {
      repairs[region] = { repaired: true };
    } else {
      repairs[region] = {
        repaired: syncResult.synced[region] ?? false,
        error: syncResult.errors[region],
      };
    }
  }

  const repaired = Object.values(repairs).every((r) => r.repaired);

  return {
    repaired,
    authorityRegion: selectedAuthority,
    repairs,
  };
}

/**
 * Validate regional auth audit log consistency for a given user.
 *
 * IMPORTANT — per-region logging semantics:
 *   `logAuthEvent()` inserts audit rows only into the region that handled the
 *   current request; there is NO automatic cross-region replication of audit
 *   events.  Counts will therefore legitimately differ across regions for
 *   virtually every active user.
 *
 *   Do NOT use this function to assert equal counts across regions, and do NOT
 *   use its result to trigger cross-region alerts based on count equality.
 *
 * What "consistent" means here:
 *   Each region that recorded at least one event for the user within the time
 *   window has those events present and retrievable.  A region that recorded
 *   zero events is also "consistent" — it simply had no traffic for this user.
 *   The only inconsistency we can detect is a region returning an error when
 *   queried (which may indicate a database connectivity problem).
 *
 * @param userId          - UUID of the user to check.
 * @param timeWindowMinutes - Look-back window (default 60 min).
 */
export async function validateAuditLogConsistency(
  userId: string,
  timeWindowMinutes: number = 60
): Promise<{
  consistent: boolean;
  regions: Record<string, number>;
  message: string;
}> {
  const regions = SUPPORTED_REGIONS;
  const regionCounts: Record<string, number> = {};
  const cutoff = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
  const errorRegions: string[] = [];

  for (const region of regions) {
    try {
      const admin = getRegionalSupabaseAdmin(region);

      const { count, error } = await admin
        .from('auth_audit_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', cutoff.toISOString());

      if (error) {
        // A query error means we cannot confirm the region's data is accessible.
        regionCounts[region] = -1;
        errorRegions.push(region);
      } else {
        // Zero is a valid, non-erroneous count (events were recorded elsewhere).
        regionCounts[region] = count ?? 0;
      }
    } catch (err) {
      // Network / runtime failure — region is unreachable.
      regionCounts[region] = -1;
      errorRegions.push(region);
    }
  }

  // Consistent = every reachable region responded without error.
  // Differing counts across regions is expected and is NOT an inconsistency.
  const consistent = errorRegions.length === 0;

  const totalEvents = Object.values(regionCounts)
    .filter((c) => c >= 0)
    .reduce((sum, c) => sum + c, 0);

  const message = consistent
    ? `Audit logs consistent: ${totalEvents} total events across regions (per-region logging — counts differ by design)`
    : `Audit log check failed: regions [${errorRegions.join(', ')}] returned errors; per-region counts: ${JSON.stringify(regionCounts)}`;

  return {
    consistent,
    regions: regionCounts,
    message,
  };
}
