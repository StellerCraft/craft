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
import { minVersion, satisfies, validRange } from 'semver';

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

// ── Declared peer-dependency ranges ───────────────────────────────────────────
// Mirrors the `peerDependencies` published by each package the templates depend
// on. Each entry applies while the template's pinned version of `pkg` falls in
// `appliesTo`; every peer range is then resolved against the version the
// template itself pins for that peer (not just checked for range syntax).
// Extend this list when a template adds a dependency that declares peers.

interface PeerDeclaration {
  pkg: string;
  appliesTo: string;
  peers: Record<string, string>;
  /** Peers marked optional via `peerDependenciesMeta` — only checked if present. */
  optionalPeers?: string[];
}

const DECLARED_PEER_RANGES: PeerDeclaration[] = [
  { pkg: 'next',               appliesTo: '>=14.0.0 <15.0.0', peers: { react: '^18.2.0', 'react-dom': '^18.2.0' } },
  { pkg: 'react-dom',          appliesTo: '^18.0.0',          peers: { react: '^18.2.0' } },
  { pkg: 'eslint-config-next', appliesTo: '>=14.0.0 <15.0.0', peers: { eslint: '^7.23.0 || ^8.0.0', typescript: '>=3.3.1' }, optionalPeers: ['typescript'] },
  { pkg: 'autoprefixer',       appliesTo: '^10.0.0',          peers: { postcss: '^8.1.0' } },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function allDeps(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
}

function sharedDependencyMismatches(packages: Record<string, PackageJson>): string[] {
  const rangesByDependency = new Map<string, Set<string>>();
  for (const pkg of Object.values(packages)) {
    for (const [dependency, range] of Object.entries(allDeps(pkg))) {
      const ranges = rangesByDependency.get(dependency) ?? new Set<string>();
      ranges.add(range);
      rangesByDependency.set(dependency, ranges);
    }
  }

  return [...rangesByDependency]
    .filter(([, ranges]) => ranges.size > 1)
    .map(([dependency]) => dependency);
}

/** Strip leading range operators to get a representative version for satisfies(). */
function representativeVersion(range: string): string | null {
  // e.g. "^18.2.0" → "18.2.0", "14.0.4" → "14.0.4"
  const match = range.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/** Lowest version a pinned range can install — the worst case for satisfies(). */
function pinnedVersion(range: string): string | null {
  try {
    return minVersion(range)?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve every declared peer range against the versions this template pins.
 * Returns one human-readable violation per incompatible or missing peer.
 */
function findPeerViolations(
  pkg: PackageJson,
  declarations: PeerDeclaration[] = DECLARED_PEER_RANGES,
): string[] {
  const deps = allDeps(pkg);
  const violations: string[] = [];

  for (const { pkg: host, appliesTo, peers, optionalPeers = [] } of declarations) {
    if (!deps[host]) continue;
    const hostVer = pinnedVersion(deps[host]);
    if (!hostVer || !satisfies(hostVer, appliesTo)) continue;

    for (const [peer, peerRange] of Object.entries(peers)) {
      if (!deps[peer]) {
        if (!optionalPeers.includes(peer)) {
          violations.push(`${host}@${hostVer} requires peer "${peer}@${peerRange}" but it is not declared`);
        }
        continue;
      }
      const peerVer = pinnedVersion(deps[peer]);
      if (!peerVer || !satisfies(peerVer, peerRange)) {
        violations.push(
          `${peer}@${deps[peer]} (resolves to ${peerVer ?? 'nothing'}) is outside ${host}@${hostVer}'s peer range "${peerRange}"`,
        );
      }
    }
  }

  return violations;
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
    it(`${name}: every declared peer range is satisfied by the template's own pinned versions`, () => {
      expect(findPeerViolations(PACKAGES[name])).toEqual([]);
    });

    it(`${name}: pinned next version falls inside every dependency's declared next peer range`, () => {
      const nextVer = pinnedVersion(PACKAGES[name].dependencies?.next ?? '');
      expect(nextVer, `${name} does not pin next`).not.toBeNull();
      for (const { pkg, peers } of DECLARED_PEER_RANGES) {
        if (!peers.next || !allDeps(PACKAGES[name])[pkg]) continue;
        expect(
          satisfies(nextVer!, peers.next),
          `next@${nextVer} is outside ${pkg}'s peer range "${peers.next}"`,
        ).toBe(true);
      }
    });
  }

  describe('regression: incompatible fixtures are caught (#1337)', () => {
    const base = PACKAGES['stellar-dex'];

    it('flags a dependency whose next peer range excludes the pinned next major', () => {
      const fixture: PackageJson = {
        ...base,
        dependencies: { ...base.dependencies, 'fake-next-ui-kit': '^1.0.0' },
      };
      const declarations: PeerDeclaration[] = [
        ...DECLARED_PEER_RANGES,
        { pkg: 'fake-next-ui-kit', appliesTo: '^1.0.0', peers: { next: '^13.0.0' } },
      ];
      const violations = findPeerViolations(fixture, declarations);
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatch(/next@14\.1\.1.*fake-next-ui-kit.*\^13\.0\.0/);
    });

    it('flags react pinned below next@14\'s peer range', () => {
      const fixture: PackageJson = {
        ...base,
        dependencies: { ...base.dependencies, react: '^17.0.2', 'react-dom': '^17.0.2' },
      };
      const violations = findPeerViolations(fixture);
      expect(violations.some((v) => v.startsWith('react@^17.0.2'))).toBe(true);
      expect(violations.some((v) => v.startsWith('react-dom@^17.0.2'))).toBe(true);
    });

    it('flags a caret range whose lowest installable version is below the peer floor', () => {
      // "^18.0.0" is valid syntax and shares the major, but can install 18.0.0 < 18.2.0
      const fixture: PackageJson = {
        ...base,
        dependencies: { ...base.dependencies, react: '^18.0.0' },
      };
      expect(findPeerViolations(fixture).some((v) => v.includes('"^18.2.0"'))).toBe(true);
    });

    it('flags a missing required peer but not a missing optional one', () => {
      const devDependencies = { ...base.devDependencies };
      delete devDependencies.eslint;
      delete devDependencies.typescript;
      const fixture: PackageJson = { ...base, devDependencies };
      const violations = findPeerViolations(fixture);
      expect(violations.some((v) => v.includes('requires peer "eslint'))).toBe(true);
      expect(violations.some((v) => v.includes('requires peer "typescript'))).toBe(false);
    });
  });
});

describe('Template dependency validation — dependency resolution', () => {
  it('uses identical version constraints for dependencies shared across templates', () => {
    expect(sharedDependencyMismatches(PACKAGES)).toEqual([]);
  });

  it('detects a mismatched shared dependency range', () => {
    const fixture = {
      first: { name: 'first', version: '1.0.0', dependencies: { next: '14.1.1' } },
      second: { name: 'second', version: '1.0.0', dependencies: { next: '^14.1.1' } },
    };
    expect(sharedDependencyMismatches(fixture)).toEqual(['next']);
  });

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
