/**
 * Template Dependency Validation Tests
 *
 * Validates package.json dependency constraints across all four CRAFT templates:
 *   - stellar-dex
 *   - soroban-defi
 *   - payment-gateway
 *   - asset-issuance
 *
 * Covers: version constraint format, compatibility, peer dependency requirements,
 * dependency resolution (no duplicates / conflicts), and known-vulnerability detection.
 *
 * No network calls are made — all checks operate on the static package.json files.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { satisfies, validRange } from 'semver';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PackageJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TEMPLATES_ROOT = resolve(__dirname, '..');

const TEMPLATE_NAMES = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'] as const;

function loadPkg(templateName: string): PackageJson {
  const path = resolve(TEMPLATES_ROOT, templateName, 'package.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const PACKAGES = Object.fromEntries(
  TEMPLATE_NAMES.map(name => [name, loadPkg(name)])
) as Record<typeof TEMPLATE_NAMES[number], PackageJson>;

// ── Known-vulnerability registry (CVE → affected range) ──────────────────────
// Extend this list as new advisories are published.

const KNOWN_VULNERABILITIES: Array<{ pkg: string; vulnerableRange: string; cve: string }> = [
  // next <14.1.1 — SSRF via Host header (CVE-2024-34351)
  { pkg: 'next', vulnerableRange: '<14.1.1', cve: 'CVE-2024-34351' },
  // next <13.5.1 — open redirect (CVE-2023-46298)
  { pkg: 'next', vulnerableRange: '<13.5.1', cve: 'CVE-2023-46298' },
];

// ── Peer-dependency requirements ──────────────────────────────────────────────
// next@14 requires react@^18 and react-dom@^18.

const PEER_REQUIREMENTS: Array<{ host: string; hostRange: string; peer: string; peerRange: string }> = [
  { host: 'next', hostRange: '>=14.0.0', peer: 'react',     peerRange: '^18.0.0' },
  { host: 'next', hostRange: '>=14.0.0', peer: 'react-dom', peerRange: '^18.0.0' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function allDeps(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

/** Strip leading range operators to get a representative version for satisfies(). */
function representativeVersion(range: string): string | null {
  // e.g. "^18.2.0" → "18.2.0", "14.0.4" → "14.0.4"
  const match = range.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Template dependency validation — version constraint format', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: all dependency ranges are valid semver`, () => {
      const deps = allDeps(PACKAGES[name]);
      for (const [pkg, range] of Object.entries(deps)) {
        expect(
          validRange(range),
          `${pkg}@"${range}" is not a valid semver range`
        ).not.toBeNull();
      }
    });
  }

  it('all templates pin next to the same major version', () => {
    const nextVersions = TEMPLATE_NAMES.map(name => PACKAGES[name].dependencies?.next ?? '');
    const majors = nextVersions.map(v => representativeVersion(v)?.split('.')[0]);
    expect(new Set(majors).size, 'next major versions diverge across templates').toBe(1);
  });

  it('all templates pin stellar-sdk to the same major version', () => {
    const sdkVersions = TEMPLATE_NAMES.map(name => PACKAGES[name].dependencies?.['stellar-sdk'] ?? '');
    const majors = sdkVersions.map(v => representativeVersion(v)?.split('.')[0]);
    expect(new Set(majors).size, 'stellar-sdk major versions diverge across templates').toBe(1);
  });
});

describe('Template dependency validation — compatibility', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: react and react-dom versions are compatible (same range)`, () => {
      const deps = PACKAGES[name].dependencies ?? {};
      expect(deps['react'], 'react missing').toBeDefined();
      expect(deps['react-dom'], 'react-dom missing').toBeDefined();
      expect(deps['react']).toBe(deps['react-dom']);
    });

    it(`${name}: typescript devDependency is present and >=5.0.0`, () => {
      const devDeps = PACKAGES[name].devDependencies ?? {};
      expect(devDeps['typescript'], 'typescript devDependency missing').toBeDefined();
      const ver = representativeVersion(devDeps['typescript']!);
      expect(ver).not.toBeNull();
      expect(satisfies(ver!, '>=5.0.0'), `typescript ${ver} is below 5.0.0`).toBe(true);
    });

    it(`${name}: @types/node devDependency is present and >=18.0.0`, () => {
      const devDeps = PACKAGES[name].devDependencies ?? {};
      expect(devDeps['@types/node'], '@types/node devDependency missing').toBeDefined();
      const ver = representativeVersion(devDeps['@types/node']!);
      expect(ver).not.toBeNull();
      expect(satisfies(ver!, '>=18.0.0'), `@types/node ${ver} is below 18.0.0`).toBe(true);
    });
  }
});

describe('Template dependency validation — security vulnerabilities', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: no dependencies match known vulnerable ranges`, () => {
      const deps = allDeps(PACKAGES[name]);
      for (const { pkg, vulnerableRange, cve } of KNOWN_VULNERABILITIES) {
        if (!deps[pkg]) continue;
        const ver = representativeVersion(deps[pkg]);
        if (!ver) continue;
        expect(
          satisfies(ver, vulnerableRange),
          `${pkg}@${ver} in template "${name}" is vulnerable (${cve})`
        ).toBe(false);
      }
    });
  }
});

describe('Template dependency validation — peer dependency requirements', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: peer dependencies of installed packages are satisfied`, () => {
      const deps = allDeps(PACKAGES[name]);
      for (const { host, hostRange, peer, peerRange } of PEER_REQUIREMENTS) {
        if (!deps[host]) continue;
        const hostVer = representativeVersion(deps[host]);
        if (!hostVer || !satisfies(hostVer, hostRange)) continue;

        const peerVer = deps[peer] ? representativeVersion(deps[peer]) : null;
        expect(peerVer, `${host} requires peer "${peer}" but it is missing`).not.toBeNull();
        expect(
          satisfies(peerVer!, peerRange),
          `${peer}@${peerVer} does not satisfy ${host}'s peer requirement "${peerRange}"`
        ).toBe(true);
      }
    });
  }
});

describe('Template dependency validation — dependency resolution', () => {
  it('no template declares the same package in both dependencies and devDependencies', () => {
    for (const name of TEMPLATE_NAMES) {
      const pkg = PACKAGES[name];
      const prodKeys = new Set(Object.keys(pkg.dependencies ?? {}));
      const devKeys = Object.keys(pkg.devDependencies ?? {});
      const duplicates = devKeys.filter(k => prodKeys.has(k));
      expect(duplicates, `${name} has duplicate entries: ${duplicates.join(', ')}`).toHaveLength(0);
    }
  });

  it('all templates declare the required runtime dependencies', () => {
    const required = ['next', 'react', 'react-dom', 'stellar-sdk'];
    for (const name of TEMPLATE_NAMES) {
      const deps = PACKAGES[name].dependencies ?? {};
      for (const dep of required) {
        expect(deps[dep], `${name} is missing required dependency "${dep}"`).toBeDefined();
      }
    }
  });

  it('all templates declare the required devDependencies', () => {
    const required = ['typescript', '@types/node', '@types/react'];
    for (const name of TEMPLATE_NAMES) {
      const devDeps = PACKAGES[name].devDependencies ?? {};
      for (const dep of required) {
        expect(devDeps[dep], `${name} is missing required devDependency "${dep}"`).toBeDefined();
      }
    }
  });

  it('all templates have the required build scripts', () => {
    const required = ['dev', 'build', 'start'];
    for (const name of TEMPLATE_NAMES) {
      const scripts = (PACKAGES[name] as any).scripts ?? {};
      for (const script of required) {
        expect(scripts[script], `${name} is missing script "${script}"`).toBeDefined();
      }
    }
  });
});
