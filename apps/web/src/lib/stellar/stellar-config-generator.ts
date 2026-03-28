/**
 * StellarConfigGenerator
 *
 * Maps a validated StellarConfig into template-ready configuration artifacts:
 *   - Environment variable records (for .env.local and Vercel project env vars)
 *   - A typed runtime config object (for src/lib/stellar-config.ts)
 *   - Asset pair initializer code (for DEX / DeFi templates)
 *   - Contract address map (for Soroban templates)
 *
 * This module is the single source of truth for how Stellar settings are
 * translated into generated files. It is consumed by CodeGeneratorService
 * and can be used independently for testing or preview generation.
 *
 * Design doc properties satisfied:
 *   Property 12 — Network Configuration Mapping
 *   Property 16 — Code Generation Completeness
 *   Property 42 — Configuration-Driven Blockchain Settings
 *   Property 46 — Stellar SDK Inclusion
 *   Property 47 — Soroban Configuration Inclusion
 *
 * Feature: stellar-configuration-generation
 * Issue branch: issue-065-implement-stellar-configuration-generation
 */

import type { StellarConfig, AssetPair, StellarAsset } from '@craft/types';
import { NETWORK_PASSPHRASE, DEFAULT_HORIZON_URL } from '@/services/code-generator.service';
import type { TemplateFamilyId } from '@/services/code-generator.service';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Flat key-value map of environment variables derived from a StellarConfig.
 * All values are strings, ready to be written to .env.local or passed to
 * the Vercel API as EnvironmentVariable records.
 */
export interface StellarEnvVars {
    NEXT_PUBLIC_STELLAR_NETWORK: string;
    NEXT_PUBLIC_HORIZON_URL: string;
    NEXT_PUBLIC_NETWORK_PASSPHRASE: string;
    NEXT_PUBLIC_SOROBAN_RPC_URL?: string;
    /** JSON-serialised AssetPair[] — only present when assetPairs is non-empty */
    NEXT_PUBLIC_ASSET_PAIRS?: string;
    /** JSON-serialised Record<string,string> — only present when contractAddresses is non-empty */
    NEXT_PUBLIC_CONTRACT_ADDRESSES?: string;
}

/**
 * Structured runtime configuration derived from a StellarConfig.
 * Mirrors the shape written into src/lib/stellar-config.ts.
 */
export interface StellarRuntimeConfig {
    network: 'mainnet' | 'testnet';
    horizonUrl: string;
    networkPassphrase: string;
    sorobanRpcUrl?: string;
    assetPairs: AssetPair[];
    contractAddresses: Record<string, string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the network passphrase for a given network, falling back to the
 * NETWORK_PASSPHRASE constant from CodeGeneratorService.
 */
function resolvePassphrase(network: 'mainnet' | 'testnet'): string {
    return NETWORK_PASSPHRASE[network];
}

/**
 * Resolve the Horizon URL, preferring the user-supplied value and falling
 * back to the canonical default for the selected network.
 */
function resolveHorizonUrl(stellar: StellarConfig): string {
    return stellar.horizonUrl || DEFAULT_HORIZON_URL[stellar.network];
}

/**
 * Serialise an AssetPair array to a compact JSON string safe for env vars.
 * Returns undefined when the array is empty or absent.
 */
function serialiseAssetPairs(pairs: AssetPair[] | undefined): string | undefined {
    if (!pairs || pairs.length === 0) return undefined;
    return JSON.stringify(pairs);
}

/**
 * Serialise a contract address map to a compact JSON string safe for env vars.
 * Returns undefined when the map is empty or absent.
 */
function serialiseContractAddresses(
    addresses: Record<string, string> | undefined
): string | undefined {
    if (!addresses || Object.keys(addresses).length === 0) return undefined;
    return JSON.stringify(addresses);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the complete set of Stellar environment variables from a validated
 * StellarConfig. The result can be written directly to .env.local or
 * forwarded to the Vercel API.
 *
 * @param stellar - Validated StellarConfig from CustomizationConfig
 * @returns Flat env-var record with only defined keys present
 */
export function buildStellarEnvVars(stellar: StellarConfig): StellarEnvVars {
    const vars: StellarEnvVars = {
        NEXT_PUBLIC_STELLAR_NETWORK: stellar.network,
        NEXT_PUBLIC_HORIZON_URL: resolveHorizonUrl(stellar),
        NEXT_PUBLIC_NETWORK_PASSPHRASE: resolvePassphrase(stellar.network),
    };

    if (stellar.sorobanRpcUrl) {
        vars.NEXT_PUBLIC_SOROBAN_RPC_URL = stellar.sorobanRpcUrl;
    }

    const assetPairsSerialized = serialiseAssetPairs(stellar.assetPairs);
    if (assetPairsSerialized !== undefined) {
        vars.NEXT_PUBLIC_ASSET_PAIRS = assetPairsSerialized;
    }

    const contractsSerialized = serialiseContractAddresses(stellar.contractAddresses);
    if (contractsSerialized !== undefined) {
        vars.NEXT_PUBLIC_CONTRACT_ADDRESSES = contractsSerialized;
    }

    return vars;
}

/**
 * Build a structured runtime config object from a validated StellarConfig.
 * This is the typed representation that gets embedded in src/lib/stellar-config.ts.
 *
 * @param stellar - Validated StellarConfig
 * @returns StellarRuntimeConfig with all fields resolved
 */
export function buildStellarRuntimeConfig(stellar: StellarConfig): StellarRuntimeConfig {
    return {
        network: stellar.network,
        horizonUrl: resolveHorizonUrl(stellar),
        networkPassphrase: resolvePassphrase(stellar.network),
        ...(stellar.sorobanRpcUrl ? { sorobanRpcUrl: stellar.sorobanRpcUrl } : {}),
        assetPairs: stellar.assetPairs ?? [],
        contractAddresses: stellar.contractAddresses ?? {},
    };
}

/**
 * Generate the content of `src/lib/stellar-config.ts` for a given template
 * family and Stellar configuration. This file is the runtime entry point for
 * all Stellar settings in the generated app.
 *
 * @param family - Template family identifier
 * @param stellar - Validated StellarConfig
 * @returns File content string
 */
export function generateStellarConfigFile(
    family: TemplateFamilyId,
    stellar: StellarConfig
): string {
    const passphrase = resolvePassphrase(stellar.network);
    const horizonUrl = resolveHorizonUrl(stellar);

    const sorobanLine =
        stellar.sorobanRpcUrl
            ? `    sorobanRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || '${stellar.sorobanRpcUrl}',\n`
            : family === 'soroban-defi'
            ? `    sorobanRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',\n`
            : '';

    const assetPairsLine = buildAssetPairsConfigLine(stellar.assetPairs);
    const contractsLine = buildContractAddressesConfigLine(stellar.contractAddresses);

    return `// Auto-generated by CRAFT Platform
// Template: ${family}
// Feature: stellar-configuration-generation

import type { AssetPair } from '@craft/types';

export const stellarConfig = {
    network: (process.env.NEXT_PUBLIC_STELLAR_NETWORK as 'mainnet' | 'testnet') || '${stellar.network}',
    horizonUrl: process.env.NEXT_PUBLIC_HORIZON_URL || '${horizonUrl}',
    networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || '${passphrase}',
${sorobanLine}${assetPairsLine}${contractsLine}} as const satisfies {
    network: 'mainnet' | 'testnet';
    horizonUrl: string;
    networkPassphrase: string;
    sorobanRpcUrl?: string;
    assetPairs: AssetPair[];
    contractAddresses: Record<string, string>;
};

export default stellarConfig;
`;
}

// ── Internal code-gen helpers ─────────────────────────────────────────────────

/**
 * Render the assetPairs config line.
 * Reads from env var at runtime; falls back to the baked-in value.
 */
function buildAssetPairsConfigLine(pairs: AssetPair[] | undefined): string {
    const fallback = pairs && pairs.length > 0 ? JSON.stringify(pairs) : '[]';
    return `    assetPairs: JSON.parse(process.env.NEXT_PUBLIC_ASSET_PAIRS || '${escapeForTemplateLiteral(fallback)}') as AssetPair[],\n`;
}

/**
 * Render the contractAddresses config line.
 * Reads from env var at runtime; falls back to the baked-in value.
 */
function buildContractAddressesConfigLine(
    addresses: Record<string, string> | undefined
): string {
    const fallback =
        addresses && Object.keys(addresses).length > 0 ? JSON.stringify(addresses) : '{}';
    return `    contractAddresses: JSON.parse(process.env.NEXT_PUBLIC_CONTRACT_ADDRESSES || '${escapeForTemplateLiteral(fallback)}') as Record<string, string>,\n`;
}

/**
 * Escape a JSON string for safe embedding inside a single-quoted JS string.
 */
function escapeForTemplateLiteral(json: string): string {
    return json.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Format a StellarAsset as a human-readable string for comments.
 * e.g. "USDC (GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5)"
 */
export function formatAssetLabel(asset: StellarAsset): string {
    if (asset.type === 'native') return 'XLM (native)';
    return `${asset.code} (${asset.issuer})`;
}

/**
 * Determine whether a template family requires Soroban configuration.
 */
export function requiresSoroban(family: TemplateFamilyId): boolean {
    return family === 'soroban-defi';
}

/**
 * Determine whether a template family uses asset pairs.
 */
export function usesAssetPairs(family: TemplateFamilyId): boolean {
    return family === 'stellar-dex' || family === 'soroban-defi';
}

/**
 * Determine whether a template family uses contract addresses.
 */
export function usesContractAddresses(family: TemplateFamilyId): boolean {
    return family === 'soroban-defi' || family === 'asset-issuance';
}
