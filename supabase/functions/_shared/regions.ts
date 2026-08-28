/**
 * Unified Regional Topology Module
 *
 * Canonical source of truth for supported regions, per-region endpoint/env-var
 * resolution, and region detection from request headers.
 *
 * Consolidates previously duplicated region lists and lookup tables from
 * regional-router, regional-auth/auth-utils, regional-health-check, and
 * consistency-validators into a single module.
 */

export const SUPPORTED_REGIONS = ['us-east', 'eu-west', 'ap-southeast'] as const;
export type Region = (typeof SUPPORTED_REGIONS)[number];

const EU_WEST_COUNTRIES = ['GB', 'FR', 'DE', 'IE', 'NL', 'BE', 'IT', 'ES'];
const AP_SOUTHEAST_COUNTRIES = ['SG', 'AU', 'JP', 'KR', 'IN', 'NZ', 'HK'];

export interface RegionalEndpointConfig {
  baseUrl: string;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

const regionalConfigs: Record<string, RegionalEndpointConfig> = {
  'us-east': {
    baseUrl: Deno.env.get('EDGE_FUNCTION_URL_US_EAST') || 'https://us-east.functions.supabase.co',
    supabaseUrl: Deno.env.get('SUPABASE_URL_US_EAST') || Deno.env.get('SUPABASE_URL'),
    anonKey: Deno.env.get('SUPABASE_ANON_KEY_US_EAST') || Deno.env.get('SUPABASE_ANON_KEY'),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY_US_EAST') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  },
  'eu-west': {
    baseUrl: Deno.env.get('EDGE_FUNCTION_URL_EU_WEST') || 'https://eu-west.functions.supabase.co',
    supabaseUrl: Deno.env.get('SUPABASE_URL_EU_WEST') || Deno.env.get('SUPABASE_URL'),
    anonKey: Deno.env.get('SUPABASE_ANON_KEY_EU_WEST') || Deno.env.get('SUPABASE_ANON_KEY'),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY_EU_WEST') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  },
  'ap-southeast': {
    baseUrl: Deno.env.get('EDGE_FUNCTION_URL_AP_SOUTHEAST') || 'https://ap-southeast.functions.supabase.co',
    supabaseUrl: Deno.env.get('SUPABASE_URL_AP_SOUTHEAST') || Deno.env.get('SUPABASE_URL'),
    anonKey: Deno.env.get('SUPABASE_ANON_KEY_AP_SOUTHEAST') || Deno.env.get('SUPABASE_ANON_KEY'),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY_AP_SOUTHEAST') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  },
};

export function getRegionalEndpointConfig(region: string): RegionalEndpointConfig {
  return regionalConfigs[region] ?? regionalConfigs['us-east'];
}

export function detectRegionFromRequest(req: Request): string {
  const regionOverride = req.headers.get('x-region-override');
  if (regionOverride && (SUPPORTED_REGIONS as readonly string[]).includes(regionOverride)) {
    return regionOverride;
  }

  const cfCountry = req.headers.get('cf-ipcountry') || '';
  if (cfCountry) {
    if (EU_WEST_COUNTRIES.includes(cfCountry)) return 'eu-west';
    if (AP_SOUTHEAST_COUNTRIES.includes(cfCountry)) return 'ap-southeast';
  }

  const tzHeader = req.headers.get('x-timezone') || '';
  if (tzHeader.startsWith('Europe') || tzHeader.startsWith('GMT')) return 'eu-west';
  if (tzHeader.startsWith('Asia') || tzHeader.startsWith('Australia')) return 'ap-southeast';

  return 'us-east';
}
