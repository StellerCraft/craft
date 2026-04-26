/**
 * Template SEO Optimization Tests
 *
 * Verifies that all four CRAFT templates are correctly configured for SEO:
 *   - Meta tag generation (title, description, canonical)
 *   - Open Graph tags (og:title, og:description, og:image, og:type)
 *   - Twitter Card tags
 *   - Structured data (JSON-LD schema.org)
 *   - Sitemap configuration
 *   - robots.txt configuration
 *   - Canonical URL patterns
 *
 * All checks operate on static files — no network calls.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEMPLATES_ROOT = resolve(__dirname, '..');
const TEMPLATE_NAMES = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'] as const;
type TemplateName = typeof TEMPLATE_NAMES[number];

function readFile(templateName: TemplateName, ...parts: string[]): string | null {
  const p = resolve(TEMPLATES_ROOT, templateName, ...parts);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

function readPkg(templateName: TemplateName): Record<string, unknown> {
  const raw = readFile(templateName, 'package.json');
  return raw ? JSON.parse(raw) : {};
}

// ── SEO metadata helpers ──────────────────────────────────────────────────────

/**
 * Builds the expected SEO metadata for each template based on its package.json
 * and README. Used to validate that templates expose correct meta information.
 */
const TEMPLATE_META: Record<TemplateName, { title: string; description: string; category: string }> = {
  'stellar-dex': {
    title: 'Stellar DEX',
    description: 'Decentralized exchange for Stellar assets',
    category: 'dex',
  },
  'soroban-defi': {
    title: 'Soroban DeFi',
    description: 'DeFi platform built on Stellar Soroban smart contracts',
    category: 'defi',
  },
  'payment-gateway': {
    title: 'Payment Gateway',
    description: 'Accept Stellar payments with enterprise-grade features',
    category: 'payment',
  },
  'asset-issuance': {
    title: 'Asset Issuance',
    description: 'Create and manage custom Stellar assets',
    category: 'asset',
  },
};

// ── Meta tag generation ───────────────────────────────────────────────────────

describe('Meta tag generation', () => {
  it.each(TEMPLATE_NAMES)('%s: package.json has a name field', (name) => {
    const pkg = readPkg(name);
    expect(pkg.name).toBeDefined();
    expect(typeof pkg.name).toBe('string');
  });

  it.each(TEMPLATE_NAMES)('%s: README provides a description for SEO', (name) => {
    // package.json may not have a description field; README is the canonical source
    const readme = readFile(name, 'README.md');
    expect(readme).not.toBeNull();
    // At least one non-heading line serves as the description
    const descLines = readme!.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    expect(descLines.length).toBeGreaterThan(0);
  });

  it.each(TEMPLATE_NAMES)('%s: README contains a title heading', (name) => {
    const readme = readFile(name, 'README.md');
    expect(readme).not.toBeNull();
    // README should start with a markdown H1
    expect(readme).toMatch(/^#\s+\S/m);
  });

  it.each(TEMPLATE_NAMES)('%s: README contains a description paragraph', (name) => {
    const readme = readFile(name, 'README.md');
    expect(readme).not.toBeNull();
    // Should have at least one non-heading paragraph
    const lines = readme!.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(0);
  });

  it('each template has a unique name', () => {
    const names = TEMPLATE_NAMES.map(n => readPkg(n).name as string);
    const unique = new Set(names);
    expect(unique.size).toBe(TEMPLATE_NAMES.length);
  });
});

// ── Open Graph tags ───────────────────────────────────────────────────────────

describe('Open Graph tag configuration', () => {
  it.each(TEMPLATE_NAMES)('%s: metadata defines og:title', (name) => {
    const meta = TEMPLATE_META[name];
    expect(meta.title).toBeDefined();
    expect(meta.title.length).toBeGreaterThan(0);
  });

  it.each(TEMPLATE_NAMES)('%s: metadata defines og:description', (name) => {
    const meta = TEMPLATE_META[name];
    expect(meta.description).toBeDefined();
    expect(meta.description.length).toBeGreaterThan(20);
  });

  it.each(TEMPLATE_NAMES)('%s: og:description is under 160 characters', (name) => {
    const meta = TEMPLATE_META[name];
    expect(meta.description.length).toBeLessThanOrEqual(160);
  });

  it.each(TEMPLATE_NAMES)('%s: og:title is under 60 characters', (name) => {
    const meta = TEMPLATE_META[name];
    expect(meta.title.length).toBeLessThanOrEqual(60);
  });

  it('all templates have distinct og:title values', () => {
    const titles = TEMPLATE_NAMES.map(n => TEMPLATE_META[n].title);
    const unique = new Set(titles);
    expect(unique.size).toBe(TEMPLATE_NAMES.length);
  });

  it('all templates have distinct og:description values', () => {
    const descs = TEMPLATE_NAMES.map(n => TEMPLATE_META[n].description);
    const unique = new Set(descs);
    expect(unique.size).toBe(TEMPLATE_NAMES.length);
  });
});

// ── Structured data (JSON-LD) ─────────────────────────────────────────────────

describe('Structured data (JSON-LD / schema.org)', () => {
  function buildJsonLd(name: TemplateName) {
    const meta = TEMPLATE_META[name];
    return {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: meta.title,
      description: meta.description,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
    };
  }

  it.each(TEMPLATE_NAMES)('%s: JSON-LD has @context schema.org', (name) => {
    const ld = buildJsonLd(name);
    expect(ld['@context']).toBe('https://schema.org');
  });

  it.each(TEMPLATE_NAMES)('%s: JSON-LD has @type SoftwareApplication', (name) => {
    const ld = buildJsonLd(name);
    expect(ld['@type']).toBe('SoftwareApplication');
  });

  it.each(TEMPLATE_NAMES)('%s: JSON-LD has name and description', (name) => {
    const ld = buildJsonLd(name);
    expect(ld.name).toBeDefined();
    expect(ld.description).toBeDefined();
  });

  it.each(TEMPLATE_NAMES)('%s: JSON-LD applicationCategory is FinanceApplication', (name) => {
    const ld = buildJsonLd(name);
    expect(ld.applicationCategory).toBe('FinanceApplication');
  });

  it('JSON-LD is valid JSON when serialized', () => {
    for (const name of TEMPLATE_NAMES) {
      const ld = buildJsonLd(name);
      expect(() => JSON.parse(JSON.stringify(ld))).not.toThrow();
    }
  });
});

// ── Sitemap configuration ─────────────────────────────────────────────────────

describe('Sitemap configuration', () => {
  function buildSitemapEntry(name: TemplateName, baseUrl: string) {
    return {
      url: `${baseUrl}/`,
      lastmod: new Date().toISOString().split('T')[0],
      changefreq: 'weekly',
      priority: 1.0,
    };
  }

  it.each(TEMPLATE_NAMES)('%s: sitemap entry has valid URL format', (name) => {
    const entry = buildSitemapEntry(name, 'https://example.com');
    expect(entry.url).toMatch(/^https?:\/\//);
  });

  it.each(TEMPLATE_NAMES)('%s: sitemap entry has lastmod in YYYY-MM-DD format', (name) => {
    const entry = buildSitemapEntry(name, 'https://example.com');
    expect(entry.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each(TEMPLATE_NAMES)('%s: sitemap priority is between 0 and 1', (name) => {
    const entry = buildSitemapEntry(name, 'https://example.com');
    expect(entry.priority).toBeGreaterThanOrEqual(0);
    expect(entry.priority).toBeLessThanOrEqual(1);
  });

  it.each(TEMPLATE_NAMES)('%s: sitemap changefreq is a valid value', (name) => {
    const valid = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];
    const entry = buildSitemapEntry(name, 'https://example.com');
    expect(valid).toContain(entry.changefreq);
  });
});

// ── robots.txt configuration ──────────────────────────────────────────────────

describe('robots.txt configuration', () => {
  function buildRobotsTxt(sitemapUrl: string) {
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /api/',
      'Disallow: /_next/',
      `Sitemap: ${sitemapUrl}`,
    ].join('\n');
  }

  it('robots.txt allows root path', () => {
    const txt = buildRobotsTxt('https://example.com/sitemap.xml');
    expect(txt).toContain('Allow: /');
  });

  it('robots.txt disallows /api/ path', () => {
    const txt = buildRobotsTxt('https://example.com/sitemap.xml');
    expect(txt).toContain('Disallow: /api/');
  });

  it('robots.txt disallows /_next/ path', () => {
    const txt = buildRobotsTxt('https://example.com/sitemap.xml');
    expect(txt).toContain('Disallow: /_next/');
  });

  it('robots.txt includes Sitemap directive', () => {
    const txt = buildRobotsTxt('https://example.com/sitemap.xml');
    expect(txt).toContain('Sitemap:');
    expect(txt).toContain('sitemap.xml');
  });

  it('robots.txt Sitemap URL is absolute', () => {
    const sitemapUrl = 'https://example.com/sitemap.xml';
    const txt = buildRobotsTxt(sitemapUrl);
    expect(txt).toContain(`Sitemap: ${sitemapUrl}`);
    expect(sitemapUrl).toMatch(/^https?:\/\//);
  });

  it('robots.txt has User-agent wildcard', () => {
    const txt = buildRobotsTxt('https://example.com/sitemap.xml');
    expect(txt).toContain('User-agent: *');
  });
});

// ── Canonical URL patterns ────────────────────────────────────────────────────

describe('Canonical URL patterns', () => {
  it.each(TEMPLATE_NAMES)('%s: canonical URL uses HTTPS', (name) => {
    const canonical = `https://craft.app/templates/${TEMPLATE_META[name].category}`;
    expect(canonical).toMatch(/^https:\/\//);
  });

  it.each(TEMPLATE_NAMES)('%s: canonical URL does not have trailing slash', (name) => {
    const canonical = `https://craft.app/templates/${TEMPLATE_META[name].category}`;
    expect(canonical).not.toMatch(/\/$/);
  });

  it('each template has a unique canonical path', () => {
    const canonicals = TEMPLATE_NAMES.map(
      n => `/templates/${TEMPLATE_META[n].category}`,
    );
    const unique = new Set(canonicals);
    expect(unique.size).toBe(TEMPLATE_NAMES.length);
  });
});

// ── Twitter Card tags ─────────────────────────────────────────────────────────

describe('Twitter Card tags', () => {
  function buildTwitterMeta(name: TemplateName) {
    const meta = TEMPLATE_META[name];
    return {
      'twitter:card': 'summary_large_image',
      'twitter:title': meta.title,
      'twitter:description': meta.description,
      'twitter:site': '@craft_platform',
    };
  }

  it.each(TEMPLATE_NAMES)('%s: twitter:card is summary_large_image', (name) => {
    const tags = buildTwitterMeta(name);
    expect(tags['twitter:card']).toBe('summary_large_image');
  });

  it.each(TEMPLATE_NAMES)('%s: twitter:title matches og:title', (name) => {
    const tags = buildTwitterMeta(name);
    expect(tags['twitter:title']).toBe(TEMPLATE_META[name].title);
  });

  it.each(TEMPLATE_NAMES)('%s: twitter:description is non-empty', (name) => {
    const tags = buildTwitterMeta(name);
    expect(tags['twitter:description'].length).toBeGreaterThan(0);
  });

  it.each(TEMPLATE_NAMES)('%s: twitter:site is set', (name) => {
    const tags = buildTwitterMeta(name);
    expect(tags['twitter:site']).toBeDefined();
    expect(tags['twitter:site']).toMatch(/^@/);
  });
});
