/**
 * BrandingReplacer
 *
 * Applies BrandingConfig values across generated template assets and
 * configuration files by replacing stable `{{PLACEHOLDER}}` tokens.
 *
 * Responsibilities:
 *   - Define the canonical placeholder token registry
 *   - Replace tokens in arbitrary file content strings
 *   - Generate CSS custom property blocks for color/typography tokens
 *   - Generate a branding config TypeScript snippet for config.ts
 *   - Report missing placeholders explicitly so callers can fail fast
 *
 * Placeholder strategy:
 *   All tokens use the `{{TOKEN_NAME}}` format (double curly braces, uppercase).
 *   This format is safe in TypeScript, CSS, JSON, and Markdown without escaping.
 *   Tokens are replaced exactly once per call — no recursive substitution.
 *
 * Design doc properties satisfied:
 *   Property 16 — Code Generation Completeness
 *   Property 42 — Configuration-Driven Blockchain Settings
 *
 * Feature: branding-placeholder-replacement
 * Issue branch: issue-063-implement-branding-placeholder-replacement
 */

import type { BrandingConfig } from '@craft/types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** All known branding placeholder token names. */
export type BrandingTokenKey =
    | 'APP_NAME'
    | 'PRIMARY_COLOR'
    | 'SECONDARY_COLOR'
    | 'FONT_FAMILY'
    | 'LOGO_URL';

/** Metadata for a single branding token. */
export interface BrandingTokenMeta {
    token: string;           // e.g. "{{APP_NAME}}"
    key: BrandingTokenKey;
    description: string;
    required: boolean;
}

/** Result of a replacement operation on a single file. */
export interface ReplacementResult {
    content: string;
    replacedTokens: BrandingTokenKey[];
    missingTokens: BrandingTokenKey[];
}

/** A missing placeholder warning. */
export interface MissingPlaceholderWarning {
    token: string;
    key: BrandingTokenKey;
    description: string;
}

// ── Token registry ────────────────────────────────────────────────────────────

/**
 * Canonical registry of all branding placeholder tokens.
 * This is the single source of truth for token names and metadata.
 */
export const BRANDING_TOKEN_REGISTRY: Record<BrandingTokenKey, BrandingTokenMeta> = {
    APP_NAME: {
        token: '{{APP_NAME}}',
        key: 'APP_NAME',
        description: 'Application display name',
        required: true,
    },
    PRIMARY_COLOR: {
        token: '{{PRIMARY_COLOR}}',
        key: 'PRIMARY_COLOR',
        description: 'Primary brand color (hex)',
        required: true,
    },
    SECONDARY_COLOR: {
        token: '{{SECONDARY_COLOR}}',
        key: 'SECONDARY_COLOR',
        description: 'Secondary brand color (hex)',
        required: true,
    },
    FONT_FAMILY: {
        token: '{{FONT_FAMILY}}',
        key: 'FONT_FAMILY',
        description: 'Font family for UI typography',
        required: true,
    },
    LOGO_URL: {
        token: '{{LOGO_URL}}',
        key: 'LOGO_URL',
        description: 'URL of the application logo image',
        required: false,
    },
};

const ALL_TOKEN_KEYS = Object.keys(BRANDING_TOKEN_REGISTRY) as BrandingTokenKey[];

// ── Token value resolver ──────────────────────────────────────────────────────

/**
 * Resolve the replacement value for a given token key from a BrandingConfig.
 * Returns undefined for optional tokens that have no value set.
 */
function resolveTokenValue(key: BrandingTokenKey, branding: BrandingConfig): string | undefined {
    switch (key) {
        case 'APP_NAME':      return branding.appName;
        case 'PRIMARY_COLOR': return branding.primaryColor;
        case 'SECONDARY_COLOR': return branding.secondaryColor;
        case 'FONT_FAMILY':   return branding.fontFamily;
        case 'LOGO_URL':      return branding.logoUrl;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Replace all known branding tokens in a file content string.
 *
 * - Required tokens with no value in BrandingConfig are reported as missing.
 * - Optional tokens with no value are left unreplaced and reported as missing.
 * - Unknown `{{...}}` tokens that are not in the registry are left untouched.
 * - Replacement is non-recursive and deterministic.
 *
 * @param content - Raw file content string containing `{{TOKEN}}` placeholders
 * @param branding - Validated BrandingConfig
 * @returns ReplacementResult with updated content and token accounting
 */
export function replaceBrandingTokens(
    content: string,
    branding: BrandingConfig
): ReplacementResult {
    let result = content;
    const replacedTokens: BrandingTokenKey[] = [];
    const missingTokens: BrandingTokenKey[] = [];

    for (const key of ALL_TOKEN_KEYS) {
        const meta = BRANDING_TOKEN_REGISTRY[key];
        const value = resolveTokenValue(key, branding);

        if (value !== undefined && value !== '') {
            if (result.includes(meta.token)) {
                result = replaceAll(result, meta.token, escapeReplacement(value));
                replacedTokens.push(key);
            }
        } else {
            // Token has no value — report as missing if it appears in the content
            if (result.includes(meta.token)) {
                missingTokens.push(key);
            }
        }
    }

    return { content: result, replacedTokens, missingTokens };
}

/**
 * Scan a file content string for branding tokens and report which are present,
 * which are missing values, and which required tokens are absent from the file.
 *
 * Useful for pre-flight checks before replacement.
 */
export function auditBrandingTokens(
    content: string,
    branding: BrandingConfig
): {
    present: BrandingTokenKey[];
    missingValue: MissingPlaceholderWarning[];
    notFound: BrandingTokenKey[];
} {
    const present: BrandingTokenKey[] = [];
    const missingValue: MissingPlaceholderWarning[] = [];
    const notFound: BrandingTokenKey[] = [];

    for (const key of ALL_TOKEN_KEYS) {
        const meta = BRANDING_TOKEN_REGISTRY[key];
        const value = resolveTokenValue(key, branding);
        const inContent = content.includes(meta.token);

        if (!inContent) {
            notFound.push(key);
            continue;
        }

        present.push(key);

        if (value === undefined || value === '') {
            missingValue.push({
                token: meta.token,
                key,
                description: meta.description,
            });
        }
    }

    return { present, missingValue, notFound };
}

/**
 * Generate a CSS `:root` block with branding custom properties.
 * Suitable for injecting into `globals.css` or a CSS module.
 *
 * @param branding - Validated BrandingConfig
 * @returns CSS string with custom property declarations
 */
export function generateBrandingCss(branding: BrandingConfig): string {
    const lines: string[] = [
        `/* Auto-generated by CRAFT Platform — branding-placeholder-replacement */`,
        `:root {`,
        `  --primary-color: ${branding.primaryColor};`,
        `  --secondary-color: ${branding.secondaryColor};`,
        `  --font-family: ${escapeReplacement(branding.fontFamily)};`,
    ];

    if (branding.logoUrl) {
        lines.push(`  --logo-url: url('${escapeReplacement(branding.logoUrl)}');`);
    }

    lines.push(`}`);
    return lines.join('\n') + '\n';
}

/**
 * Generate the branding section of a `config.ts` file.
 * Values are read from env vars at runtime with baked-in fallbacks.
 *
 * @param branding - Validated BrandingConfig
 * @returns TypeScript object literal string (indented, no outer braces)
 */
export function generateBrandingConfigSnippet(branding: BrandingConfig): string {
    const logoLine = branding.logoUrl
        ? `        logoUrl: process.env.NEXT_PUBLIC_LOGO_URL || '${escapeStr(branding.logoUrl)}',\n`
        : '';

    return [
        `    branding: {`,
        `        appName: process.env.NEXT_PUBLIC_APP_NAME || '${escapeStr(branding.appName)}',`,
        `        primaryColor: process.env.NEXT_PUBLIC_PRIMARY_COLOR || '${branding.primaryColor}',`,
        `        secondaryColor: process.env.NEXT_PUBLIC_SECONDARY_COLOR || '${branding.secondaryColor}',`,
        `        fontFamily: process.env.NEXT_PUBLIC_FONT_FAMILY || '${escapeStr(branding.fontFamily)}',`,
        logoLine.trimEnd(),
        `    },`,
    ]
        .filter((l) => l !== '')
        .join('\n');
}

/**
 * Build a flat map of all branding token → value pairs for a given config.
 * Optional tokens with no value are omitted.
 */
export function buildBrandingTokenMap(branding: BrandingConfig): Record<string, string> {
    const map: Record<string, string> = {};

    for (const key of ALL_TOKEN_KEYS) {
        const meta = BRANDING_TOKEN_REGISTRY[key];
        const value = resolveTokenValue(key, branding);
        if (value !== undefined && value !== '') {
            map[meta.token] = value;
        }
    }

    return map;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Replace all occurrences of a literal string (no regex). */
function replaceAll(str: string, search: string, replacement: string): string {
    return str.split(search).join(replacement);
}

/**
 * Escape a value for safe embedding inside a single-quoted JS/TS string literal.
 */
function escapeStr(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Escape a replacement value to prevent it from being interpreted as a
 * special replacement pattern (e.g. `$&`, `$1`) in String.prototype.replace.
 * Not needed here since we use split/join, but exported for completeness.
 */
function escapeReplacement(s: string): string {
    return s.replace(/\$/g, '$$$$');
}
