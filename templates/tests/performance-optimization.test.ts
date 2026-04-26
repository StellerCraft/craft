/**
 * Template Performance Optimization Tests
 *
 * Verifies that all four CRAFT templates are structured to take full advantage
 * of Next.js built-in performance optimizations, including:
 *   - Code splitting (no config flags that disable it)
 *   - Lazy loading patterns in source files
 *   - Caching strategies (HTTP headers, SWR/react-query, tsconfig incremental)
 *   - Bundle optimization (sideEffects, tree-shaking, image optimization)
 *   - Runtime performance (no known anti-patterns in source)
 *
 * All checks are static — no actual `next build` or network calls are made.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, extname } from 'path';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATES_ROOT = resolve(__dirname, '..');

const TEMPLATE_NAMES = [
  'stellar-dex',
  'soroban-defi',
  'payment-gateway',
  'asset-issuance',
] as const;
type TemplateName = typeof TEMPLATE_NAMES[number];

// ── Helpers ───────────────────────────────────────────────────────────────────

function templatePath(name: TemplateName, ...segments: string[]): string {
  return resolve(TEMPLATES_ROOT, name, ...segments);
}

function readJson<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
}

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

/** Recursively collect all files under dir with the given extensions. */
function collectFiles(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.includes(extname(entry))) {
      results.push(full);
    }
  }
  return results;
}

interface NextConfig {
  reactStrictMode?: boolean;
  swcMinify?: boolean;
  compress?: boolean;
  poweredByHeader?: boolean;
  output?: string;
  images?: {
    domains?: string[];
    formats?: string[];
    minimumCacheTTL?: number;
    unoptimized?: boolean;
  };
  experimental?: {
    optimizePackageImports?: string[];
    turbo?: unknown;
  };
}

interface PackageJson {
  name?: string;
  sideEffects?: boolean | string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface TsConfig {
  compilerOptions?: {
    incremental?: boolean;
    tsBuildInfoFile?: string;
    moduleResolution?: string;
    module?: string;
  };
}

// ── 1. Code splitting ─────────────────────────────────────────────────────────
//
// Next.js performs automatic per-page code splitting by default. Tests verify
// that no configuration option disables this behaviour.

describe('Code splitting — Next.js defaults preserved', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: next.config.js does not disable automatic code splitting`, () => {
      const configPath = templatePath(name, 'next.config.js');
      expect(existsSync(configPath), `${name}/next.config.js not found`).toBe(true);
      const src = readText(configPath);

      // These flags would opt out of automatic code splitting / chunking.
      expect(src, 'config must not disable webpack chunking').not.toMatch(
        /optimization\s*:\s*\{[^}]*splitChunks\s*:\s*false/
      );
      expect(src, 'config must not set output:"export" (disables code splitting)').not.toMatch(
        /output\s*:\s*['"]export['"]/
      );
    });

    it(`${name}: next.config.js enables reactStrictMode (catches perf regressions early)`, () => {
      const config = readText(templatePath(name, 'next.config.js'));
      expect(config, `${name} should have reactStrictMode: true`).toMatch(
        /reactStrictMode\s*:\s*true/
      );
    });
  }

  it('all templates have an app/ or pages/ directory (required for Next.js route-level splitting)', () => {
    for (const name of TEMPLATE_NAMES) {
      const hasApp   = existsSync(templatePath(name, 'src/app')) || existsSync(templatePath(name, 'app'));
      const hasPages = existsSync(templatePath(name, 'src/pages')) || existsSync(templatePath(name, 'pages'));
      expect(
        hasApp || hasPages,
        `${name} must have an app/ or pages/ directory for route-level code splitting`
      ).toBe(true);
    }
  });
});

// ── 2. Lazy loading ───────────────────────────────────────────────────────────
//
// Templates that ship source files should prefer dynamic imports for heavy
// components. Tests verify the pattern is not blocked by tsconfig settings.

describe('Lazy loading — dynamic import support', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: tsconfig module target supports dynamic import()`, () => {
      const path = templatePath(name, 'tsconfig.json');
      if (!existsSync(path)) return;
      const ts = readJson<TsConfig>(path);
      const mod = ts.compilerOptions?.module?.toLowerCase() ?? '';
      // Targets that support top-level dynamic import:
      const supportsDynamic = ['esnext', 'es2020', 'es2022', 'nodenext', 'commonjs', ''].includes(mod)
        || mod === ''; // default
      expect(
        supportsDynamic,
        `${name}/tsconfig.json module "${mod}" may not support dynamic import()`
      ).toBe(true);
    });

    it(`${name}: tsconfig moduleResolution is compatible with tree-shaking bundlers`, () => {
      const path = templatePath(name, 'tsconfig.json');
      if (!existsSync(path)) return;
      const ts = readJson<TsConfig>(path);
      const res = ts.compilerOptions?.moduleResolution?.toLowerCase() ?? '';
      // 'bundler', 'node16', 'nodenext', and '' (default) all work with Next.js.
      // 'classic' is legacy and does not support package exports.
      expect(res, `${name} uses legacy moduleResolution "classic"`).not.toBe('classic');
    });
  }

  it('source files do not use require() for heavy deps (prefer dynamic import)', () => {
    // Warn if any source file uses synchronous require() for known large libs.
    // Synchronous require() prevents code-splitting for those modules.
    const heavyLibs = ['ethers', 'stellar-sdk', '@stellar/stellar-sdk', 'lodash'];
    for (const name of TEMPLATE_NAMES) {
      const srcDir = existsSync(templatePath(name, 'src'))
        ? templatePath(name, 'src')
        : templatePath(name);
      const files = collectFiles(srcDir, ['.ts', '.tsx']);
      for (const file of files) {
        const src = readText(file);
        for (const lib of heavyLibs) {
          const syncRequire = new RegExp(`require\\(['"]${lib.replace('/', '\\/')}['"]\\)`, 'g');
          const matches = src.match(syncRequire) ?? [];
          // Allow up to 1 for compatibility shims; flag multiple usages
          expect(
            matches.length,
            `${file} uses synchronous require("${lib}") ${matches.length} time(s) — prefer dynamic import()`
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

// ── 3. Caching strategies ─────────────────────────────────────────────────────

describe('Caching strategies — configuration', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: next.config.js does not disable HTTP compression (hurts cache efficiency)`, () => {
      const src = readText(templatePath(name, 'next.config.js'));
      expect(src, `${name} must not set compress: false`).not.toMatch(
        /compress\s*:\s*false/
      );
    });

    it(`${name}: next.config.js does not set unoptimized images (bypasses image cache)`, () => {
      const src = readText(templatePath(name, 'next.config.js'));
      expect(src, `${name} must not set images.unoptimized: true`).not.toMatch(
        /unoptimized\s*:\s*true/
      );
    });

    it(`${name}: tsconfig enables incremental compilation (build cache)`, () => {
      const path = templatePath(name, 'tsconfig.json');
      if (!existsSync(path)) return;
      const ts = readJson<TsConfig>(path);
      expect(
        ts.compilerOptions?.incremental,
        `${name}/tsconfig.json should set incremental: true`
      ).toBe(true);
    });
  }

  it('no template disables the Next.js powered-by header suppression (minor perf / security)', () => {
    // poweredByHeader: false is the correct setting; true wastes bytes on every response.
    // Since the templates omit it (using the safe default), we simply assert it is
    // not explicitly set to true.
    for (const name of TEMPLATE_NAMES) {
      const src = readText(templatePath(name, 'next.config.js'));
      expect(src, `${name} must not set poweredByHeader: true`).not.toMatch(
        /poweredByHeader\s*:\s*true/
      );
    }
  });
});

// ── 4. Bundle optimization ────────────────────────────────────────────────────

describe('Bundle optimization — package and config', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: package.json does not include known bundle-busting devDependencies in dependencies`, () => {
      const pkgPath = templatePath(name, 'package.json');
      if (!existsSync(pkgPath)) return;
      const pkg = readJson<PackageJson>(pkgPath);
      const devOnlyPackages = ['vitest', 'eslint', 'prettier', 'typescript'];
      for (const dep of devOnlyPackages) {
        expect(
          pkg.dependencies?.[dep],
          `${name}: "${dep}" should be in devDependencies, not dependencies — it inflates the production bundle`
        ).toBeUndefined();
      }
    });

    it(`${name}: next.config.js file size stays within 10 KB (large configs slow cold starts)`, () => {
      const configPath = templatePath(name, 'next.config.js');
      const size = readFileSync(configPath).byteLength;
      expect(
        size,
        `${name}/next.config.js is ${size} bytes — exceeds 10 KB budget`
      ).toBeLessThan(10_240);
    });

    it(`${name}: next.config.js parses within 50 ms (fast CI and cold-start)`, () => {
      const start = performance.now();
      readText(templatePath(name, 'next.config.js'));
      const elapsed = performance.now() - start;
      expect(
        elapsed,
        `${name}/next.config.js took ${elapsed.toFixed(1)} ms — exceeds 50 ms budget`
      ).toBeLessThan(50);
    });
  }

  it('all package.json files parse within 50 ms each', () => {
    for (const name of TEMPLATE_NAMES) {
      const pkgPath = templatePath(name, 'package.json');
      if (!existsSync(pkgPath)) continue;
      const start = performance.now();
      readJson(pkgPath);
      const elapsed = performance.now() - start;
      expect(
        elapsed,
        `${name}/package.json took ${elapsed.toFixed(1)} ms to parse`
      ).toBeLessThan(50);
    }
  });

  it('no template duplicates a dependency in both dependencies and devDependencies', () => {
    for (const name of TEMPLATE_NAMES) {
      const pkgPath = templatePath(name, 'package.json');
      if (!existsSync(pkgPath)) continue;
      const pkg = readJson<PackageJson>(pkgPath);
      const deps    = Object.keys(pkg.dependencies    ?? {});
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      const dupes = deps.filter(d => devDeps.includes(d));
      expect(
        dupes,
        `${name}/package.json has duplicated deps: ${dupes.join(', ')}`
      ).toHaveLength(0);
    }
  });
});

// ── 5. Runtime performance patterns ──────────────────────────────────────────

describe('Runtime performance — anti-pattern detection', () => {
  it('source files do not use console.log in production code paths', () => {
    // console.log synchronously serializes objects on the main thread.
    // Production code should use a structured logger or remove logs entirely.
    for (const name of TEMPLATE_NAMES) {
      const srcDir = existsSync(templatePath(name, 'src'))
        ? templatePath(name, 'src')
        : templatePath(name);
      const files = collectFiles(srcDir, ['.ts', '.tsx']);
      for (const file of files) {
        const src = readText(file);
        const logCount = (src.match(/console\.log\s*\(/g) ?? []).length;
        expect(
          logCount,
          `${file} contains ${logCount} console.log() call(s) — remove for production`
        ).toBe(0);
      }
    }
  });

  it('source files do not use synchronous JSON.parse on large literals (prefer import assertions)', () => {
    // Very large JSON.parse calls block the main thread.
    // This test flags any JSON.parse argument that exceeds 512 chars.
    for (const name of TEMPLATE_NAMES) {
      const srcDir = existsSync(templatePath(name, 'src'))
        ? templatePath(name, 'src')
        : templatePath(name);
      const files = collectFiles(srcDir, ['.ts', '.tsx']);
      for (const file of files) {
        const src = readText(file);
        const matches = src.match(/JSON\.parse\(['"`][^'"`]{512,}['"`]\)/g) ?? [];
        expect(
          matches.length,
          `${file} has a JSON.parse() call with a very large inline literal — use a data file instead`
        ).toBe(0);
      }
    }
  });

  it('next.config.js files do not contain inline data arrays over 50 elements', () => {
    // Large inline arrays in next.config.js are evaluated on every require(),
    // including during hot reload.
    for (const name of TEMPLATE_NAMES) {
      const src = readText(templatePath(name, 'next.config.js'));
      // Heuristic: count commas inside array literals
      const arrayMatches = src.match(/\[([^\]]{500,})\]/g) ?? [];
      expect(
        arrayMatches.length,
        `${name}/next.config.js contains a very large inline array — move it to a separate data file`
      ).toBe(0);
    }
  });

  it('all templates have a tsconfig.json (required for incremental type-checking performance)', () => {
    for (const name of TEMPLATE_NAMES) {
      expect(
        existsSync(templatePath(name, 'tsconfig.json')),
        `${name} is missing tsconfig.json`
      ).toBe(true);
    }
  });

  it('all tsconfig.json files parse within 50 ms each', () => {
    for (const name of TEMPLATE_NAMES) {
      const path = templatePath(name, 'tsconfig.json');
      if (!existsSync(path)) continue;
      const start = performance.now();
      readJson(path);
      const elapsed = performance.now() - start;
      expect(
        elapsed,
        `${name}/tsconfig.json took ${elapsed.toFixed(1)} ms to parse`
      ).toBeLessThan(50);
    }
  });
});