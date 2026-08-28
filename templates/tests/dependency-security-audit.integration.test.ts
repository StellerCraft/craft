/**
 * Dependency CVE Regression Integration Test
 *
 * Scans all package.json files in the monorepo and cross-references them
 * against a mock CVE database fixture.
 *
 * Rules:
 *  - CVSS >= 7.0 (HIGH/CRITICAL): test FAILS unless the CVE is in the
 *    security baseline (accepted exceptions).
 *  - CVSS < 7.0 (MEDIUM/LOW): test WARNS but passes if the CVE is in the
 *    baseline with a valid justification.
 *  - Any accepted baseline entry that has expired is treated as a new
 *    unaccepted vulnerability.
 *
 * No network calls are made — everything runs against fixture files.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { satisfies } from 'semver';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CveEntry {
  id: string;
  package: string;
  vulnerableRange: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  cvss: number;
  title: string;
  patchedVersion: string;
}

interface CveDatabase {
  vulnerabilities: CveEntry[];
}

interface BaselineEntry {
  cveId: string;
  package: string;
  severity: string;
  cvss: number;
  justification: string;
  acceptedBy: string;
  acceptedAt: string;
  expiresAt: string;
  trackingIssue: string;
}

interface SecurityBaseline {
  acceptedVulnerabilities: BaselineEntry[];
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface Finding {
  cveId: string;
  package: string;
  installedVersion: string;
  cvss: number;
  severity: string;
  title: string;
  patchedVersion: string;
  packageJsonPath: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '..', '..');
const FIXTURES_DIR = resolve(__dirname, 'fixtures');

// ── Load fixtures ─────────────────────────────────────────────────────────────

const CVE_DB: CveDatabase = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'mock-cve-database.json'), 'utf-8')
);

const BASELINE: SecurityBaseline = JSON.parse(
  readFileSync(resolve(__dirname, 'security-baseline.json'), 'utf-8')
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect all package.json paths in the monorepo (excludes node_modules). */
function findPackageJsonFiles(root: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git') continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (entry === 'package.json') {
        results.push(full);
      }
    }
  }

  walk(root);
  return results;
}

/** Extract the representative bare version from a range like "^14.0.4" → "14.0.4". */
function bareVersion(range: string): string | null {
  const m = range.match(/(\d+\.\d+\.\d+[-\w.]*)/);
  return m ? m[1] : null;
}

/** Return all {dep, version} pairs from a package.json. */
function allDeps(pkg: PackageJson): Array<{ name: string; range: string }> {
  return [
    ...Object.entries(pkg.dependencies ?? {}),
    ...Object.entries(pkg.devDependencies ?? {}),
  ].map(([name, range]) => ({ name, range }));
}

/** Check whether a baseline entry is still valid (not expired). */
function isBaselineValid(entry: BaselineEntry): boolean {
  return new Date(entry.expiresAt) >= new Date();
}

/** Build a Set of "cveId:packageName" keys from valid baseline entries. */
function buildAcceptedSet(baseline: SecurityBaseline): Set<string> {
  return new Set(
    baseline.acceptedVulnerabilities
      .filter(isBaselineValid)
      .map(e => `${e.cveId}:${e.package}`)
  );
}

/**
 * Scan all package.json files against the CVE database and return findings
 * grouped by severity threshold.
 */
function audit(cvss_threshold: number): Finding[] {
  const packageFiles = findPackageJsonFiles(REPO_ROOT);
  const findings: Finding[] = [];

  for (const pkgPath of packageFiles) {
    let pkg: PackageJson;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      continue;
    }

    const deps = allDeps(pkg);

    for (const { name, range } of deps) {
      const ver = bareVersion(range);
      if (!ver) continue;

      for (const cve of CVE_DB.vulnerabilities) {
        if (cve.package !== name) continue;
        if (cve.cvss < cvss_threshold) continue;

        let vulnerable = false;
        try {
          vulnerable = satisfies(ver, cve.vulnerableRange);
        } catch {
          // invalid semver range in fixture — skip
          continue;
        }

        if (vulnerable) {
          findings.push({
            cveId: cve.id,
            package: name,
            installedVersion: ver,
            cvss: cve.cvss,
            severity: cve.severity,
            title: cve.title,
            patchedVersion: cve.patchedVersion,
            packageJsonPath: pkgPath.replace(REPO_ROOT + '/', ''),
          });
        }
      }
    }
  }

  return findings;
}

/** Format a finding into a human-readable upgrade suggestion. */
function formatFinding(f: Finding): string {
  return (
    `  [${f.severity}] ${f.cveId} — ${f.package}@${f.installedVersion} ` +
    `(CVSS ${f.cvss}) in ${f.packageJsonPath}\n` +
    `    → "${f.title}"\n` +
    `    → Upgrade to: ${f.package}@${f.patchedVersion}`
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Dependency Security Audit — CVE regression', () => {
  const accepted = buildAcceptedSet(BASELINE);

  it('detects no unaccepted HIGH/CRITICAL vulnerabilities (CVSS >= 7.0)', () => {
    const highFindings = audit(7.0);
    const unaccepted = highFindings.filter(
      f => !accepted.has(`${f.cveId}:${f.package}`)
    );

    const message =
      unaccepted.length === 0
        ? ''
        : [
            `\n${unaccepted.length} unaccepted HIGH/CRITICAL CVE(s) found. Add them to security-baseline.json with justification, or upgrade:\n`,
            ...unaccepted.map(formatFinding),
          ].join('\n');

    expect(unaccepted, message).toHaveLength(0);
  });

  it('accepted HIGH/CRITICAL baseline entries have not expired', () => {
    const expired = BASELINE.acceptedVulnerabilities.filter(
      e => e.cvss >= 7.0 && !isBaselineValid(e)
    );
    const message =
      expired.length === 0
        ? ''
        : `Expired HIGH baseline entries (re-evaluate or patch):\n` +
          expired.map(e => `  ${e.cveId} (${e.package}) expired ${e.expiresAt} — tracking: ${e.trackingIssue}`).join('\n');

    expect(expired, message).toHaveLength(0);
  });

  it('security-baseline.json contains required fields for every entry', () => {
    const required = ['cveId', 'package', 'severity', 'cvss', 'justification', 'acceptedBy', 'acceptedAt', 'expiresAt'] as const;
    for (const entry of BASELINE.acceptedVulnerabilities) {
      for (const field of required) {
        expect(
          entry[field],
          `Baseline entry ${(entry as any).cveId ?? '(unknown)'} is missing field "${field}"`
        ).toBeDefined();
      }
      expect(entry.justification.trim().length, `Baseline entry ${entry.cveId} has empty justification`).toBeGreaterThan(0);
    }
  });

  it('mock CVE database is loadable and has expected structure', () => {
    expect(CVE_DB.vulnerabilities).toBeInstanceOf(Array);
    expect(CVE_DB.vulnerabilities.length).toBeGreaterThan(0);
    for (const cve of CVE_DB.vulnerabilities) {
      expect(cve.id).toBeDefined();
      expect(cve.package).toBeDefined();
      expect(cve.cvss).toBeTypeOf('number');
    }
  });

  it('MOCK-HIGH-001 fixture triggers a HIGH finding (validates audit logic)', () => {
    // The mock CVE database includes "mock-vulnerable-pkg" <99.0.0, CVSS 9.8.
    // No real package.json in the repo declares mock-vulnerable-pkg, so we
    // test the audit function directly with an inline package.json object.
    const fakePkg: PackageJson = {
      name: 'test-subject',
      dependencies: { 'mock-vulnerable-pkg': '1.0.0' },
    };

    const findings: Finding[] = [];
    const deps = allDeps(fakePkg);

    for (const { name, range } of deps) {
      const ver = bareVersion(range);
      if (!ver) continue;
      for (const cve of CVE_DB.vulnerabilities) {
        if (cve.package !== name || cve.cvss < 7.0) continue;
        if (satisfies(ver, cve.vulnerableRange)) {
          findings.push({
            cveId: cve.id,
            package: name,
            installedVersion: ver,
            cvss: cve.cvss,
            severity: cve.severity,
            title: cve.title,
            patchedVersion: cve.patchedVersion,
            packageJsonPath: '(inline)',
          });
        }
      }
    }

    const mockHighFinding = findings.find(f => f.cveId === 'MOCK-HIGH-001');
    expect(mockHighFinding, 'Audit logic must detect MOCK-HIGH-001').toBeDefined();
    expect(mockHighFinding!.cvss).toBeGreaterThanOrEqual(7.0);
    // Confirm it is NOT in the baseline (so real audit would fail for it)
    expect(accepted.has('MOCK-HIGH-001:mock-vulnerable-pkg')).toBe(false);
  });

  it('MOCK-MEDIUM-001 is below HIGH threshold and would not block CI', () => {
    const fakePkg: PackageJson = {
      name: 'test-subject',
      dependencies: { 'mock-medium-pkg': '1.0.0' },
    };

    const highFindings: Finding[] = [];
    for (const { name, range } of allDeps(fakePkg)) {
      const ver = bareVersion(range);
      if (!ver) continue;
      for (const cve of CVE_DB.vulnerabilities) {
        if (cve.package !== name || cve.cvss < 7.0) continue;
        if (satisfies(ver, cve.vulnerableRange)) {
          highFindings.push({
            cveId: cve.id,
            package: name,
            installedVersion: ver,
            cvss: cve.cvss,
            severity: cve.severity,
            title: cve.title,
            patchedVersion: cve.patchedVersion,
            packageJsonPath: '(inline)',
          });
        }
      }
    }

    // MOCK-MEDIUM-001 has cvss=5.0, so it should NOT appear in HIGH findings
    expect(highFindings.find(f => f.cveId === 'MOCK-MEDIUM-001')).toBeUndefined();
  });

  it('all accepted MEDIUM baseline entries have non-empty justifications', () => {
    const medium = BASELINE.acceptedVulnerabilities.filter(e => e.cvss < 7.0);
    for (const entry of medium) {
      expect(
        entry.justification.trim().length,
        `${entry.cveId} (${entry.package}) requires a justification`
      ).toBeGreaterThan(10);
    }
  });
});
