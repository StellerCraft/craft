/**
 * Tests for BrandingReplacer
 *
 * Covers:
 *   - replaceBrandingTokens
 *   - auditBrandingTokens
 *   - generateBrandingCss
 *   - generateBrandingConfigSnippet
 *   - buildBrandingTokenMap
 *
 * Feature: branding-placeholder-replacement
 * Issue branch: issue-063-implement-branding-placeholder-replacement
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
    replaceBrandingTokens,
    auditBrandingTokens,
    generateBrandingCss,
    generateBrandingConfigSnippet,
    buildBrandingTokenMap,
    BRANDING_TOKEN_REGISTRY,
} from './branding-replacer';
import type { BrandingConfig } from '@craft/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FULL_BRANDING: BrandingConfig = {
    appName: 'My DEX App',
    primaryColor: '#4f9eff',
    secondaryColor: '#1a1f36',
    fontFamily: 'Inter',
    logoUrl: 'https://example.com/logo.png',
};

const MINIMAL_BRANDING: BrandingConfig = {
    appName: 'Minimal App',
    primaryColor: '#ff0000',
    secondaryColor: '#0000ff',
    fontFamily: 'sans-serif',
};

const ALL_TOKENS_CONTENT = `
APP: {{APP_NAME}}
PRIMARY: {{PRIMARY_COLOR}}
SECONDARY: {{SECONDARY_COLOR}}
FONT: {{FONT_FAMILY}}
LOGO: {{LOGO_URL}}
`.trim();

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbHexColor = fc
    .integer({ min: 0, max: 0xffffff })
    .map((n) => `#${n.toString(16).padStart(6, '0')}`);

const arbBranding = fc.record<BrandingConfig>({
    appName: fc.string({ minLength: 1, maxLength: 60 }),
    primaryColor: arbHexColor,
    secondaryColor: arbHexColor,
    fontFamily: fc.constantFrom('Inter', 'Roboto', 'sans-serif', 'monospace'),
    logoUrl: fc.option(fc.constant('https://example.com/logo.png'), { nil: undefined }),
});

// ── replaceBrandingTokens ─────────────────────────────────────────────────────

describe('replaceBrandingTokens', () => {
    describe('basic replacement', () => {
        it('replaces {{APP_NAME}}', () => {
            const { content } = replaceBrandingTokens('Hello {{APP_NAME}}', FULL_BRANDING);
            expect(content).toBe('Hello My DEX App');
        });

        it('replaces {{PRIMARY_COLOR}}', () => {
            const { content } = replaceBrandingTokens('color: {{PRIMARY_COLOR}}', FULL_BRANDING);
            expect(content).toBe('color: #4f9eff');
        });

        it('replaces {{SECONDARY_COLOR}}', () => {
            const { content } = replaceBrandingTokens('bg: {{SECONDARY_COLOR}}', FULL_BRANDING);
            expect(content).toBe('bg: #1a1f36');
        });

        it('replaces {{FONT_FAMILY}}', () => {
            const { content } = replaceBrandingTokens('font: {{FONT_FAMILY}}', FULL_BRANDING);
            expect(content).toBe('font: Inter');
        });

        it('replaces {{LOGO_URL}} when logoUrl is set', () => {
            const { content } = replaceBrandingTokens('logo: {{LOGO_URL}}', FULL_BRANDING);
            expect(content).toBe('logo: https://example.com/logo.png');
        });

        it('replaces all tokens in a multi-token string', () => {
            const { content } = replaceBrandingTokens(ALL_TOKENS_CONTENT, FULL_BRANDING);
            expect(content).toContain('My DEX App');
            expect(content).toContain('#4f9eff');
            expect(content).toContain('#1a1f36');
            expect(content).toContain('Inter');
            expect(content).toContain('https://example.com/logo.png');
            expect(content).not.toContain('{{');
        });

        it('replaces multiple occurrences of the same token', () => {
            const { content } = replaceBrandingTokens(
                '{{APP_NAME}} and {{APP_NAME}}',
                FULL_BRANDING
            );
            expect(content).toBe('My DEX App and My DEX App');
        });

        it('leaves unknown {{...}} tokens untouched', () => {
            const { content } = replaceBrandingTokens(
                '{{APP_NAME}} {{UNKNOWN_TOKEN}}',
                FULL_BRANDING
            );
            expect(content).toContain('{{UNKNOWN_TOKEN}}');
            expect(content).toContain('My DEX App');
        });
    });

    describe('token accounting', () => {
        it('reports replaced tokens', () => {
            const { replacedTokens } = replaceBrandingTokens(
                '{{APP_NAME}} {{PRIMARY_COLOR}}',
                FULL_BRANDING
            );
            expect(replacedTokens).toContain('APP_NAME');
            expect(replacedTokens).toContain('PRIMARY_COLOR');
        });

        it('reports missing tokens when logoUrl is absent', () => {
            const { missingTokens } = replaceBrandingTokens(
                'logo: {{LOGO_URL}}',
                MINIMAL_BRANDING
            );
            expect(missingTokens).toContain('LOGO_URL');
        });

        it('does not report missing for tokens not present in content', () => {
            const { missingTokens } = replaceBrandingTokens('no tokens here', MINIMAL_BRANDING);
            expect(missingTokens).toHaveLength(0);
        });

        it('does not report replaced tokens that were not in content', () => {
            const { replacedTokens } = replaceBrandingTokens('{{APP_NAME}}', FULL_BRANDING);
            expect(replacedTokens).toEqual(['APP_NAME']);
        });
    });

    describe('edge cases', () => {
        it('handles empty content', () => {
            const { content, replacedTokens, missingTokens } = replaceBrandingTokens(
                '',
                FULL_BRANDING
            );
            expect(content).toBe('');
            expect(replacedTokens).toHaveLength(0);
            expect(missingTokens).toHaveLength(0);
        });

        it('handles content with no tokens', () => {
            const { content } = replaceBrandingTokens('no placeholders here', FULL_BRANDING);
            expect(content).toBe('no placeholders here');
        });

        it('handles app name with single quotes', () => {
            const branding = { ...FULL_BRANDING, appName: "O'Brien's DEX" };
            const { content } = replaceBrandingTokens('name: {{APP_NAME}}', branding);
            expect(content).toContain("O'Brien's DEX");
        });

        it('is deterministic — same inputs produce same output', () => {
            const a = replaceBrandingTokens(ALL_TOKENS_CONTENT, FULL_BRANDING);
            const b = replaceBrandingTokens(ALL_TOKENS_CONTENT, FULL_BRANDING);
            expect(a.content).toBe(b.content);
            expect(a.replacedTokens).toEqual(b.replacedTokens);
        });
    });

    describe('property: all required tokens replaced when values present', () => {
        it('holds for any branding config with all fields set', () => {
            fc.assert(
                fc.property(arbBranding, (branding) => {
                    const content = '{{APP_NAME}} {{PRIMARY_COLOR}} {{SECONDARY_COLOR}} {{FONT_FAMILY}}';
                    const { replacedTokens, missingTokens } = replaceBrandingTokens(
                        content,
                        branding
                    );
                    expect(replacedTokens).toContain('APP_NAME');
                    expect(replacedTokens).toContain('PRIMARY_COLOR');
                    expect(replacedTokens).toContain('SECONDARY_COLOR');
                    expect(replacedTokens).toContain('FONT_FAMILY');
                    expect(missingTokens).not.toContain('APP_NAME');
                    expect(missingTokens).not.toContain('PRIMARY_COLOR');
                })
            );
        });
    });

    describe('property: output never contains replaced token strings', () => {
        it('holds for any branding config', () => {
            fc.assert(
                fc.property(arbBranding, (branding) => {
                    const { content } = replaceBrandingTokens(ALL_TOKENS_CONTENT, branding);
                    // Required tokens should always be replaced
                    expect(content).not.toContain('{{APP_NAME}}');
                    expect(content).not.toContain('{{PRIMARY_COLOR}}');
                    expect(content).not.toContain('{{SECONDARY_COLOR}}');
                    expect(content).not.toContain('{{FONT_FAMILY}}');
                })
            );
        });
    });
});

// ── auditBrandingTokens ───────────────────────────────────────────────────────

describe('auditBrandingTokens', () => {
    it('reports present tokens found in content', () => {
        const { present } = auditBrandingTokens('{{APP_NAME}} {{PRIMARY_COLOR}}', FULL_BRANDING);
        expect(present).toContain('APP_NAME');
        expect(present).toContain('PRIMARY_COLOR');
    });

    it('reports notFound for tokens absent from content', () => {
        const { notFound } = auditBrandingTokens('{{APP_NAME}}', FULL_BRANDING);
        expect(notFound).toContain('SECONDARY_COLOR');
        expect(notFound).toContain('FONT_FAMILY');
    });

    it('reports missingValue for optional token with no value', () => {
        const { missingValue } = auditBrandingTokens('{{LOGO_URL}}', MINIMAL_BRANDING);
        expect(missingValue.map((w) => w.key)).toContain('LOGO_URL');
    });

    it('missingValue entries include token and description', () => {
        const { missingValue } = auditBrandingTokens('{{LOGO_URL}}', MINIMAL_BRANDING);
        const warning = missingValue.find((w) => w.key === 'LOGO_URL');
        expect(warning?.token).toBe('{{LOGO_URL}}');
        expect(warning?.description).toBeTruthy();
    });

    it('returns empty arrays for content with no tokens', () => {
        const result = auditBrandingTokens('no tokens here', FULL_BRANDING);
        expect(result.present).toHaveLength(0);
        expect(result.missingValue).toHaveLength(0);
    });

    it('present + notFound covers all registry keys', () => {
        const { present, notFound } = auditBrandingTokens(ALL_TOKENS_CONTENT, FULL_BRANDING);
        const all = [...present, ...notFound].sort();
        const expected = Object.keys(BRANDING_TOKEN_REGISTRY).sort();
        expect(all).toEqual(expected);
    });
});

// ── generateBrandingCss ───────────────────────────────────────────────────────

describe('generateBrandingCss', () => {
    it('includes :root block', () => {
        const css = generateBrandingCss(FULL_BRANDING);
        expect(css).toContain(':root {');
    });

    it('includes --primary-color', () => {
        const css = generateBrandingCss(FULL_BRANDING);
        expect(css).toContain('--primary-color: #4f9eff');
    });

    it('includes --secondary-color', () => {
        const css = generateBrandingCss(FULL_BRANDING);
        expect(css).toContain('--secondary-color: #1a1f36');
    });

    it('includes --font-family', () => {
        const css = generateBrandingCss(FULL_BRANDING);
        expect(css).toContain('--font-family: Inter');
    });

    it('includes --logo-url when logoUrl is set', () => {
        const css = generateBrandingCss(FULL_BRANDING);
        expect(css).toContain('--logo-url');
        expect(css).toContain('https://example.com/logo.png');
    });

    it('omits --logo-url when logoUrl is absent', () => {
        const css = generateBrandingCss(MINIMAL_BRANDING);
        expect(css).not.toContain('--logo-url');
    });

    it('includes CRAFT attribution comment', () => {
        const css = generateBrandingCss(FULL_BRANDING);
        expect(css).toContain('Auto-generated by CRAFT Platform');
    });

    describe('property: always produces valid CSS structure', () => {
        it('always contains :root { and closing }', () => {
            fc.assert(
                fc.property(arbBranding, (branding) => {
                    const css = generateBrandingCss(branding);
                    expect(css).toContain(':root {');
                    expect(css).toContain('}');
                })
            );
        });
    });
});

// ── generateBrandingConfigSnippet ─────────────────────────────────────────────

describe('generateBrandingConfigSnippet', () => {
    it('includes appName with env var fallback', () => {
        const snippet = generateBrandingConfigSnippet(FULL_BRANDING);
        expect(snippet).toContain('NEXT_PUBLIC_APP_NAME');
        expect(snippet).toContain('My DEX App');
    });

    it('includes primaryColor with env var fallback', () => {
        const snippet = generateBrandingConfigSnippet(FULL_BRANDING);
        expect(snippet).toContain('NEXT_PUBLIC_PRIMARY_COLOR');
        expect(snippet).toContain('#4f9eff');
    });

    it('includes secondaryColor with env var fallback', () => {
        const snippet = generateBrandingConfigSnippet(FULL_BRANDING);
        expect(snippet).toContain('NEXT_PUBLIC_SECONDARY_COLOR');
        expect(snippet).toContain('#1a1f36');
    });

    it('includes fontFamily with env var fallback', () => {
        const snippet = generateBrandingConfigSnippet(FULL_BRANDING);
        expect(snippet).toContain('NEXT_PUBLIC_FONT_FAMILY');
        expect(snippet).toContain('Inter');
    });

    it('includes logoUrl line when set', () => {
        const snippet = generateBrandingConfigSnippet(FULL_BRANDING);
        expect(snippet).toContain('NEXT_PUBLIC_LOGO_URL');
        expect(snippet).toContain('https://example.com/logo.png');
    });

    it('omits logoUrl line when absent', () => {
        const snippet = generateBrandingConfigSnippet(MINIMAL_BRANDING);
        expect(snippet).not.toContain('logoUrl');
    });

    it('wraps in branding: { ... }', () => {
        const snippet = generateBrandingConfigSnippet(FULL_BRANDING);
        expect(snippet.trimStart()).toStartWith('branding: {');
        expect(snippet.trimEnd()).toEndWith('},');
    });

    it('escapes single quotes in appName', () => {
        const branding = { ...FULL_BRANDING, appName: "O'Brien's" };
        const snippet = generateBrandingConfigSnippet(branding);
        expect(snippet).toContain("\\'");
    });
});

// ── buildBrandingTokenMap ─────────────────────────────────────────────────────

describe('buildBrandingTokenMap', () => {
    it('maps {{APP_NAME}} to appName value', () => {
        const map = buildBrandingTokenMap(FULL_BRANDING);
        expect(map['{{APP_NAME}}']).toBe('My DEX App');
    });

    it('maps {{PRIMARY_COLOR}} to primaryColor value', () => {
        const map = buildBrandingTokenMap(FULL_BRANDING);
        expect(map['{{PRIMARY_COLOR}}']).toBe('#4f9eff');
    });

    it('includes {{LOGO_URL}} when logoUrl is set', () => {
        const map = buildBrandingTokenMap(FULL_BRANDING);
        expect(map['{{LOGO_URL}}']).toBe('https://example.com/logo.png');
    });

    it('omits {{LOGO_URL}} when logoUrl is absent', () => {
        const map = buildBrandingTokenMap(MINIMAL_BRANDING);
        expect(map['{{LOGO_URL}}']).toBeUndefined();
    });

    it('always includes all required token keys', () => {
        const map = buildBrandingTokenMap(MINIMAL_BRANDING);
        expect(map['{{APP_NAME}}']).toBeDefined();
        expect(map['{{PRIMARY_COLOR}}']).toBeDefined();
        expect(map['{{SECONDARY_COLOR}}']).toBeDefined();
        expect(map['{{FONT_FAMILY}}']).toBeDefined();
    });

    describe('property: all values are non-empty strings', () => {
        it('holds for any branding config', () => {
            fc.assert(
                fc.property(arbBranding, (branding) => {
                    const map = buildBrandingTokenMap(branding);
                    for (const val of Object.values(map)) {
                        expect(typeof val).toBe('string');
                        expect(val.length).toBeGreaterThan(0);
                    }
                })
            );
        });
    });
});
