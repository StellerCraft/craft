/**
 * Re-exports from the unified regional topology module.
 *
 * @deprecated Import directly from '../_shared/regions.ts' instead.
 *   This file exists for backwards compatibility and will be removed in a
 *   future release.
 */

export {
  SUPPORTED_REGIONS,
  getRegionalEndpointConfig,
  detectRegionFromRequest,
} from './regions.ts';
export type { Region, RegionalEndpointConfig } from './regions.ts';
