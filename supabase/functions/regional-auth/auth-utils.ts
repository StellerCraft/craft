/**
 * Regional Auth Utilities
 *
 * Provides shared authentication utilities for cross-region auth edge functions.
 * Handles JWT token generation, validation, and region-aware session management.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPPORTED_REGIONS, getRegionalEndpointConfig, detectRegionFromRequest } from '../_shared/regions.ts';

// Re-export detectRegionFromRequest for backwards compatibility
export { detectRegionFromRequest };

export interface RegionalAuthContext {
  region: string;
  timestamp: number;
  requestId: string;
}

export interface AuthResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  metadata?: {
    region: string;
    processingTime: number;
    requestId: string;
  };
}

/**
 * Get Supabase client for the specified region
 * Each region maintains its own database connection pool
 */
export function getRegionalSupabaseClient(region: string) {
  const config = getRegionalEndpointConfig(region);
  return createClient(config.supabaseUrl, config.anonKey);
}

/**
 * Get the admin Supabase client for the region
 * Used for operations that require admin privileges (like profile creation)
 */
export function getRegionalSupabaseAdmin(region: string) {
  const config = getRegionalEndpointConfig(region);
  return createClient(config.supabaseUrl, config.serviceRoleKey);
}

/**
 * Create auth response metadata with region and timing info
 */
export function createAuthResponse<T>(
  success: boolean,
  context: RegionalAuthContext,
  data?: T,
  error?: { code: string; message: string }
): AuthResponse<T> {
  const startTime = context.timestamp;
  const processingTime = Date.now() - startTime;

  return {
    success,
    data,
    error,
    metadata: {
      region: context.region,
      processingTime,
      requestId: context.requestId,
    },
  };
}

/**
 * Verify JWT signature is valid for the region
 * Ensures tokens from one region can be validated in another
 */
export async function verifyRegionalJWT(
  token: string,
  region: string
): Promise<{ valid: boolean; payload?: Record<string, unknown>; error?: string }> {
  try {
    const admin = getRegionalSupabaseAdmin(region);
    const {
      data: { user },
      error,
    } = await admin.auth.getUser(token);

    if (error || !user) {
      return { valid: false, error: error?.message || 'Invalid token' };
    }

    return { valid: true, payload: { user_id: user.id, email: user.email } };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

/**
 * Sync user profile across regions for state consistency
 * Called after successful auth operations in one region
 */
export async function syncUserProfileAcrossRegions(
  userId: string,
  email: string,
  sourceRegion: string,
  profile: Record<string, unknown>
): Promise<{ synced: boolean; errors: Record<string, string>; regionTimings: Record<string, number> }> {
  const errors: Record<string, string> = {};
  const regionTimings: Record<string, number> = {};

  const syncOps = SUPPORTED_REGIONS
    .filter((region) => region !== sourceRegion)
    .map(async (region) => {
      const start = Date.now();
      try {
        const admin = getRegionalSupabaseAdmin(region);

        const { data: existingProfile } = await admin
          .from('profiles')
          .select('id')
          .eq('id', userId)
          .single();

        if (!existingProfile) {
          const { error } = await admin.from('profiles').insert({
            id: userId,
            ...profile,
          });

          if (error) {
            errors[region] = error.message;
          }
        } else {
          const { error } = await admin
            .from('profiles')
            .update(profile)
            .eq('id', userId);

          if (error) {
            errors[region] = error.message;
          }
        }
      } catch (error) {
        errors[region] = String(error);
      } finally {
        regionTimings[region] = Date.now() - start;
      }
    });

  await Promise.allSettled(syncOps);

  return { synced: Object.keys(errors).length === 0, errors, regionTimings };
}

/**
 * Log auth event for audit trail and monitoring
 */
export async function logAuthEvent(
  userId: string | null,
  eventType: 'signin' | 'signup' | 'refresh' | 'logout' | 'failure',
  region: string,
  requestId: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  try {
    const admin = getRegionalSupabaseAdmin(region);

    await admin.from('auth_audit_logs').insert({
      user_id: userId,
      event_type: eventType,
      region,
      request_id: requestId,
      details,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    // Log to console but don't fail the auth operation
    console.error(`Failed to log auth event: ${String(error)}`);
  }
}
