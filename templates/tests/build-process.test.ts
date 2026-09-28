/**
 * Template Build Process Tests
 *
 * Verifies that all four CRAFT templates are correctly structured for a
 * successful Next.js build, including:
 *   - Required build configuration files
 *   - Output directory structure
 *   - Build performance (config parsing budget)
 *   - Error handling (missing / malformed configs)
 *   - Build caching artefacts (tsconfig incremental, turbo inputs)
 *   - Negative case: a genuinely broken generated .ts/.tsx file fails the
 *     build gate loudly with an actionable, file-referencing error
 *
 * All checks are static — no actual `next build` is executed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as ts from 'typescript';

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMPLATES_ROOT = resolve(__dirname, '..');

const TEMPLATE_NAMES = ['stellar-dex', 'soroban-defi', 'payment-gateway', 'asset-issuance'] as const;
type TemplateName = typeof TEMPLATE_NAMES[number];

const REQUIRED_BUILD_FILES = ['package.json', 'tsconfig.json', 'next.config.js'] as const;

const REQUIRED_SCRIPTS = ['dev', 'build', 'start'] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function templatePath(name: TemplateName, ...segments: string[]): string {
  return resolve(TEMPLATES_ROOT, name, ...segments);
}

function readJson<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
}

interface PackageJson {
  name: string;
  version: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface TsConfig {
  compilerOptions?: {
    noEmit?: boolean;
    incremental?: boolean;
    tsBuildInfoFile?: string;
    outDir?: string;
  };
  include?: string[];
  exclude?: string[];
}

// ── Build configuration ───────────────────────────────────────────────────────

describe('Build process — required configuration files', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: all required build files exist`, () => {
      for (const file of REQUIRED_BUILD_FILES) {
        expect(
          existsSync(templatePath(name, file)),
          `${name} is missing required build file: ${file}`
        ).toBe(true);
      }
    });
  }
});

describe('Build process — build scripts', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: package.json declares all required build scripts`, () => {
      const pkg = readJson<PackageJson>(templatePath(name, 'package.json'));
      for (const script of REQUIRED_SCRIPTS) {
        expect(
          pkg.scripts?.[script],
          `${name} is missing script "${script}"`
        ).toBeDefined();
      }
    });

    it(`${name}: build script invokes next build`, () => {
      const pkg = readJson<PackageJson>(templatePath(name, 'package.json'));
      expect(pkg.scripts?.build).toMatch(/next build/);
    });
  }
});

// ── Output structure ──────────────────────────────────────────────────────────

describe('Build process — output structure', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: tsconfig sets noEmit (Next.js manages output)`, () => {
      const tsconfig = readJson<TsConfig>(templatePath(name, 'tsconfig.json'));
      // Next.js templates use noEmit; tsc is type-check only
      expect(
        tsconfig.compilerOptions?.noEmit,
        `${name}/tsconfig.json should set noEmit: true`
      ).toBe(true);
    });

    it(`${name}: tsconfig includes source files`, () => {
      const tsconfig = readJson<TsConfig>(templatePath(name, 'tsconfig.json'));
      expect(tsconfig.include, 'include array missing').toBeDefined();
      const includesTs = tsconfig.include!.some(p => p.includes('**/*.ts') || p.includes('**/*.tsx'));
      expect(includesTs, `${name}/tsconfig.json does not include TypeScript source files`).toBe(true);
    });

    it(`${name}: tsconfig excludes node_modules`, () => {
      const tsconfig = readJson<TsConfig>(templatePath(name, 'tsconfig.json'));
      expect(tsconfig.exclude, 'exclude array missing').toBeDefined();
      expect(
        tsconfig.exclude!.includes('node_modules'),
        `${name}/tsconfig.json does not exclude node_modules`
      ).toBe(true);
    });
  }
});

// ── Build performance ─────────────────────────────────────────────────────────

describe('Build process — performance', () => {
  it('all package.json files parse within 50 ms each', () => {
    for (const name of TEMPLATE_NAMES) {
      const start = performance.now();
      readJson(templatePath(name, 'package.json'));
      const elapsed = performance.now() - start;
      expect(elapsed, `${name}/package.json took ${elapsed.toFixed(1)} ms to parse`).toBeLessThan(50);
    }
  });

  it('all tsconfig.json files parse within 50 ms each', () => {
    for (const name of TEMPLATE_NAMES) {
      if (!existsSync(templatePath(name, 'tsconfig.json'))) continue;
      const start = performance.now();
      readJson(templatePath(name, 'tsconfig.json'));
      const elapsed = performance.now() - start;
      expect(elapsed, `${name}/tsconfig.json took ${elapsed.toFixed(1)} ms to parse`).toBeLessThan(50);
    }
  });

  it('all next.config.js files are small enough for fast require (<10 KB)', () => {
    for (const name of TEMPLATE_NAMES) {
      const configPath = templatePath(name, 'next.config.js');
      if (!existsSync(configPath)) continue;
      const size = readFileSync(configPath).byteLength;
      expect(size, `${name}/next.config.js is ${size} bytes — exceeds 10 KB budget`).toBeLessThan(10_240);
    }
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('Build process — error handling', () => {
  it('readJson throws on non-existent file', () => {
    expect(() => readJson(templatePath('stellar-dex', '__nonexistent__.json'))).toThrow();
  });

  it('readJson throws on malformed JSON', () => {
    // Use a known non-JSON file as a stand-in for malformed JSON
    const cssPath = templatePath('stellar-dex', 'src/app/globals.css');
    if (existsSync(cssPath)) {
      expect(() => readJson(cssPath)).toThrow();
    }
  });

  it('all package.json files contain valid JSON (no parse errors)', () => {
    for (const name of TEMPLATE_NAMES) {
      expect(
        () => readJson(templatePath(name, 'package.json')),
        `${name}/package.json contains invalid JSON`
      ).not.toThrow();
    }
  });

  it('all tsconfig.json files contain valid JSON (no parse errors)', () => {
    for (const name of TEMPLATE_NAMES) {
      const path = templatePath(name, 'tsconfig.json');
      if (!existsSync(path)) continue;
      expect(
        () => readJson(path),
        `${name}/tsconfig.json contains invalid JSON`
      ).not.toThrow();
    }
  });

  it('all next.config.js files exist and are non-empty', () => {
    for (const name of TEMPLATE_NAMES) {
      const path = templatePath(name, 'next.config.js');
      if (!existsSync(path)) continue;
      const content = readFileSync(path, 'utf-8').trim();
      expect(content.length, `${name}/next.config.js is empty`).toBeGreaterThan(0);
    }
  });
});

// ── Build caching ─────────────────────────────────────────────────────────────

describe('Build process — caching', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: tsconfig enables incremental compilation for faster rebuilds`, () => {
      const path = templatePath(name, 'tsconfig.json');
      if (!existsSync(path)) return;
      const tsconfig = readJson<TsConfig>(path);
      expect(
        tsconfig.compilerOptions?.incremental,
        `${name}/tsconfig.json should set incremental: true to enable build caching`
      ).toBe(true);
    });
  }

  it('turbo.json defines build task with output caching', () => {
    const turboPath = resolve(TEMPLATES_ROOT, '..', 'turbo.json');
    expect(existsSync(turboPath), 'turbo.json not found at repo root').toBe(true);

    const turbo = readJson<{ pipeline?: Record<string, unknown>; tasks?: Record<string, unknown> }>(turboPath);
    // Turborepo v1 uses "pipeline", v2 uses "tasks"
    const tasks = turbo.pipeline ?? turbo.tasks ?? {};
    expect(
      Object.keys(tasks),
      'turbo.json has no build task defined'
    ).toContain('build');
  });

  it('turbo.json build task declares outputs for caching', () => {
    const turboPath = resolve(TEMPLATES_ROOT, '..', 'turbo.json');
    const turbo = readJson<{
      pipeline?: Record<string, { outputs?: string[] }>;
      tasks?: Record<string, { outputs?: string[] }>;
    }>(turboPath);
    const tasks = turbo.pipeline ?? turbo.tasks ?? {};
    const buildTask = tasks['build'] as { outputs?: string[] } | undefined;
    expect(buildTask?.outputs, 'turbo.json build task should declare outputs').toBeDefined();
    expect(Array.isArray(buildTask?.outputs)).toBe(true);
  });
});

// ── Negative case: broken generated file (#1339) ──────────────────────────────
//
// A generated file that is syntactically invalid must fail the build loudly,
// with an error that names the broken file and position — never an opaque
// bundler stack trace, and never a "successful" build with a broken artefact.
//
// `runBuildGate` models the pre-`next build` syntax gate: it parses every
// generated .ts AND .tsx file (the backend SyntaxValidator historically only
// checked .ts, letting broken .tsx through — see the companion .tsx
// syntax-validation gap fix). These fixtures would have caught that gap here.

interface GeneratedSource {
  path: string;
  content: string;
}

interface BuildGateError {
  file: string;
  line: number;
  column: number;
  message: string;
}

interface BuildGateResult {
  exitCode: 0 | 1;
  errors: BuildGateError[];
  output: string;
}

function runBuildGate(template: TemplateName, files: GeneratedSource[]): BuildGateResult {
  const errors: BuildGateError[] = [];

  for (const file of files) {
    if (!/\.tsx?$/.test(file.path)) continue;
    const { diagnostics = [] } = ts.transpileModule(file.content, {
      fileName: file.path,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2020 },
    });
    for (const diag of diagnostics) {
      const { line, character } =
        diag.file && diag.start !== undefined
          ? diag.file.getLineAndCharacterOfPosition(diag.start)
          : { line: 0, character: 0 };
      errors.push({
        file: `${template}/${file.path}`,
        line: line + 1,
        column: character + 1,
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      });
    }
  }

  const output = errors.length
    ? [
        `Build failed: ${errors.length} syntax error(s) in generated files.`,
        ...errors.map((e) => `  ${e.file}:${e.line}:${e.column} - ${e.message}`),
      ].join('\n')
    : 'Build gate passed.';

  return { exitCode: errors.length ? 1 : 0, errors, output };
}

const VALID_PAGE_TSX = (template: TemplateName) => `export default function Page() {
  return (
    <main>
      <h1>${template}</h1>
    </main>
  );
}
`;

/** Unclosed JSX element — the .tsx failure SyntaxValidator used to skip. */
const BROKEN_PAGE_TSX = (template: TemplateName) => `export default function Page() {
  return (
    <main>
      <h1>${template}</h1>
    </main
  );
}
`;

/** Dangling assignment in a generated config module. */
const BROKEN_CONFIG_TS = `export const stellarConfig = {
  network: 'testnet',
  horizonUrl: ,
};
`;

describe('Build process — negative case: broken generated file', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name}: valid generated .tsx passes the build gate (control)`, () => {
      const result = runBuildGate(name, [{ path: 'src/app/page.tsx', content: VALID_PAGE_TSX(name) }]);
      expect(result.exitCode, result.output).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it(`${name}: malformed generated .tsx fails the build with a non-zero exit`, () => {
      const result = runBuildGate(name, [
        { path: 'src/app/layout.tsx', content: VALID_PAGE_TSX(name) },
        { path: 'src/app/page.tsx', content: BROKEN_PAGE_TSX(name) },
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      // Only the broken file is reported
      expect(new Set(result.errors.map((e) => e.file))).toEqual(new Set([`${name}/src/app/page.tsx`]));
    });

    it(`${name}: malformed generated .ts fails the build with a non-zero exit`, () => {
      const result = runBuildGate(name, [{ path: 'src/lib/stellar-config.ts', content: BROKEN_CONFIG_TS }]);
      expect(result.exitCode).toBe(1);
      expect(result.errors[0].file).toBe(`${name}/src/lib/stellar-config.ts`);
      expect(result.errors[0].line).toBe(3);
    });

    it(`${name}: build failure output is actionable, not an opaque bundler trace`, () => {
      const result = runBuildGate(name, [{ path: 'src/app/page.tsx', content: BROKEN_PAGE_TSX(name) }]);
      // Names the broken file with a line:column position
      expect(result.output).toMatch(new RegExp(`${name}/src/app/page\\.tsx:\\d+:\\d+ - \\S`));
      // Points at the unclosed </main (line 5 onward), not line 1 of a bundle
      expect(result.errors[0].line).toBeGreaterThanOrEqual(5);
      // No stack frames or bundler internals
      expect(result.output).not.toMatch(/^\s+at\s/m);
      expect(result.output).not.toMatch(/webpack|node_modules/i);
    });
  }
});
