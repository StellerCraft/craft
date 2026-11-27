import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  SUPPORTED_REGIONS,
  getRegionalEndpointConfig,
} from './regions.ts';

// Stub environment variables before tests run.
// Deno.env.get falls back to the defaults defined in the module-level map when
// the variables are not set, so we simply confirm the returned config shapes
// against the expected defaults.

Deno.test('SUPPORTED_REGIONS contains us-east, eu-west, and ap-southeast', () => {
  assertEquals(SUPPORTED_REGIONS.includes('us-east'), true);
  assertEquals(SUPPORTED_REGIONS.includes('eu-west'), true);
  assertEquals(SUPPORTED_REGIONS.includes('ap-southeast'), true);
  assertEquals(SUPPORTED_REGIONS.length, 3);
});

Deno.test('getRegionalEndpointConfig returns a config with expected keys for each supported region', () => {
  for (const region of SUPPORTED_REGIONS) {
    const config = getRegionalEndpointConfig(region);
    // All four keys must be present.
    assertEquals(typeof config.baseUrl, 'string');
    assertEquals(typeof config.anonKey, 'string');
    assertEquals(typeof config.supabaseUrl, 'string');
    assertEquals(typeof config.serviceRoleKey, 'string');
  }
});

Deno.test('getRegionalEndpointConfig baseUrl uses per-region default when env var is absent', () => {
  const usConfig = getRegionalEndpointConfig('us-east');
  assertEquals(usConfig.baseUrl, 'https://us-east.functions.supabase.co');

  const euConfig = getRegionalEndpointConfig('eu-west');
  assertEquals(euConfig.baseUrl, 'https://eu-west.functions.supabase.co');

  const apConfig = getRegionalEndpointConfig('ap-southeast');
  assertEquals(apConfig.baseUrl, 'https://ap-southeast.functions.supabase.co');
});

Deno.test('getRegionalEndpointConfig falls back to us-east for an unknown region', () => {
  const config = getRegionalEndpointConfig('unknown-region');
  const usEastConfig = getRegionalEndpointConfig('us-east');
  assertEquals(config.baseUrl, usEastConfig.baseUrl);
});

// Security: service-role keys must not appear in the anonKey field.
Deno.test('getRegionalEndpointConfig anonKey is distinct from serviceRoleKey', () => {
  for (const region of SUPPORTED_REGIONS) {
    const config = getRegionalEndpointConfig(region);
    // Both may be undefined/empty strings when no env vars are set, but they
    // must never be the same non-empty value (which would indicate a mix-up).
    if (config.anonKey && config.serviceRoleKey) {
      assertNotEquals(config.anonKey, config.serviceRoleKey);
    }
  }
});
