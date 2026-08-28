/**
 * Regional Sign-Up Edge Function
 * 
 * Handles user registration with cross-region state synchronization.
 * Automatically detects user's region and creates account locally,
 * then syncs to other regions for consistency.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import {
  getRegionalSupabaseClient,
  getRegionalSupabaseAdmin,
  detectRegionFromRequest,
  createAuthResponse,
  syncUserProfileAcrossRegions,
  logAuthEvent,
  type RegionalAuthContext,
  type AuthResponse,
} from './auth-utils.ts';
import { repairUserStateConsistency } from './consistency-validators.ts';

interface SignUpRequest {
  email: string;
  password: string;
  metadata?: Record<string, unknown>;
}

interface SignUpResponse {
  userId: string;
  email: string;
  createdAt: string;
  sessionToken?: string;
  refreshToken?: string;
}

/**
 * Generate request ID for tracing
 */
function generateRequestId(): string {
  return `auth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sign up handler - creates new user account in the nearest region
 */
async function handleSignUp(req: Request): Promise<Response> {
  const requestId = generateRequestId();
  const startTime = Date.now();

  try {
    // Detect user's region from request
    const region = detectRegionFromRequest(req);

    const context: RegionalAuthContext = {
      region,
      timestamp: startTime,
      requestId,
    };

    // Parse request body
    let body: SignUpRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify(
          createAuthResponse(false, context, undefined, {
            code: 'INVALID_REQUEST',
            message: 'Invalid JSON in request body',
          })
        ),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate input
    if (!body.email || !body.password) {
      return new Response(
        JSON.stringify(
          createAuthResponse(false, context, undefined, {
            code: 'MISSING_FIELDS',
            message: 'Email and password are required',
          })
        ),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return new Response(
        JSON.stringify(
          createAuthResponse(false, context, undefined, {
            code: 'INVALID_EMAIL',
            message: 'Invalid email format',
          })
        ),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate password strength
    if (body.password.length < 8) {
      return new Response(
        JSON.stringify(
          createAuthResponse(false, context, undefined, {
            code: 'WEAK_PASSWORD',
            message: 'Password must be at least 8 characters long',
          })
        ),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create user in regional Supabase instance
    const supabase = getRegionalSupabaseAdmin(region);
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: body.metadata || {},
    });

    if (authError || !authData.user) {
      await logAuthEvent(null, 'failure', region, requestId, {
        reason: authError?.message || 'Unknown error',
        email: body.email,
      });

      return new Response(
        JSON.stringify(
          createAuthResponse(false, context, undefined, {
            code: authError?.code || 'SIGNUP_ERROR',
            message: authError?.message || 'Failed to create user',
          })
        ),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create user profile in the local region
    const userId = authData.user.id;
    const { error: profileError } = await supabase.from('profiles').insert({
      id: userId,
      subscription_tier: 'free',
      created_at: new Date().toISOString(),
      region,
      ...body.metadata,
    });

    if (profileError) {
      // Clean up user if profile creation fails
      await supabase.auth.admin.deleteUser(userId);

      await logAuthEvent(null, 'failure', region, requestId, {
        reason: 'Profile creation failed',
        error: profileError.message,
      });

      return new Response(
        JSON.stringify(
          createAuthResponse(false, context, undefined, {
            code: 'PROFILE_ERROR',
            message: 'Failed to create user profile',
          })
        ),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Sync profile to other regions for consistency
    const syncResult = await syncUserProfileAcrossRegions(
      userId,
      body.email,
      region,
      {
        subscription_tier: 'free',
        created_at: new Date().toISOString(),
        region,
        ...body.metadata,
      }
    );

    if (!syncResult.synced) {
      // #977 fix: a failed cross-region profile sync must not be silently
      // dropped.  We:
      //   1. Write a durable audit record so operators can query partial-sync
      //      failures and the follow-up repair job has a discoverable trace.
      //   2. Attempt an inline repair via repairUserStateConsistency() so the
      //      state is corrected as soon as possible without blocking the caller.
      // The 201 response contract is unchanged — sign-up succeeds from the
      // user's perspective regardless of cross-region replication status.

      // Step 1: durable audit log with needsRepair flag
      await logAuthEvent(userId, 'failure', region, `${requestId}-sync-failure`, {
        reason: 'cross-region profile sync incomplete',
        failedRegions: Object.keys(syncResult.errors),
        errors: syncResult.errors,
        needsRepair: true,
      });

      // Step 2: attempt inline repair (best-effort; errors are logged, not thrown)
      try {
        await repairUserStateConsistency(userId, region);
      } catch (repairError) {
        console.error(`Inline repair failed for user ${userId}:`, repairError);
      }
    }

    // Log successful signup (includes sync outcome so operators have full picture)
    await logAuthEvent(userId, 'signup', region, requestId, {
      email: body.email,
      syncRegionTimings: syncResult.regionTimings,
      syncSucceeded: syncResult.synced,
      ...(syncResult.synced ? {} : { syncErrors: syncResult.errors }),
    });

    // Create session
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: body.email,
    });

    const responseData: SignUpResponse = {
      userId,
      email: body.email,
      createdAt: new Date().toISOString(),
    };

    if (!sessionError && sessionData.properties?.hashed_token) {
      responseData.sessionToken = sessionData.properties.hashed_token;
    }

    return new Response(
      JSON.stringify(createAuthResponse(true, context, responseData)),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sign-up error:', error);

    const context: RegionalAuthContext = {
      region: 'unknown',
      timestamp: startTime,
      requestId,
    };

    return new Response(
      JSON.stringify(
        createAuthResponse(false, context, undefined, {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        })
      ),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Handle OPTIONS requests for CORS
 */
function handleOptions(req: Request): Response {
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    ...(Deno.env.get('ALLOWED_ORIGINS')?.split(',') || []),
  ];

  const origin = req.headers.get('origin') || '';
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

/**
 * Main edge function handler
 */
serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return handleOptions(req);
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Only POST requests are allowed',
        },
      }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Add CORS headers to all responses
  const corsHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
  };

  const response = await handleSignUp(req);
  
  // Add CORS headers to response
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }

  return response;
});
