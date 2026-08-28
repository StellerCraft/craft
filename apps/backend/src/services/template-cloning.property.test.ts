/**
 * Property-based tests for TemplateCloningService file tree integrity
 *
 * Invariants under test:
 *   1. Cloned tree has same file count as source (no files silently dropped)
 *   2. All cloned file paths preserve relative structure (no absolute path leakage)
 *   3. Dot-files (.gitignore, .env.example, etc.) are cloned correctly
 *   4. Zero-file source yields an empty but valid result
 *   5. Source entries containing ../ traversal segments are skipped with a
 *      warning; the rest of the clone still succeeds
 *
 * Feature: template-cloning-logic
 * Issue: #733
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as nodePath from 'path';
import {
  TemplateCloningService,
  type FileSystemAdapter,
  type CloningConfig,
  type CloneRequest,
} from './template-cloning.service';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_SOURCE = '/allowed/templates';
const ALLOWED_WORKSPACE = '/allowed/workspaces';

const testConfig: CloningConfig = {
  allowedSourceRoots: [ALLOWED_SOURCE],
  allowedWorkspaceRoots: [ALLOWED_WORKSPACE],
};

const SRC_BASE = `${ALLOWED_SOURCE}/my-template`;

// ── Mock helpers ──────────────────────────────────────────────────────────────

interface MockFsState {
  dirs: Set<string>;
  files: Map<string, string>;
}

function makeMockFs(state: MockFsState): FileSystemAdapter {
  return {
    async mkdir(path) {
      state.dirs.add(path);
    },
    async readdir(path) {
      const prefix = path.endsWith(nodePath.sep) ? path : path + nodePath.sep;
      return Array.from(state.files.keys())
        .filter((f) => f.startsWith(prefix))
        .map((f) => nodePath.relative(path, f));
    },
    async copyFile(src, dest) {
      state.files.set(dest, state.files.get(src) ?? '');
    },
    async exists(path) {
      return state.dirs.has(path) || state.files.has(path);
    },
    async readFile(path) {
      const content = state.files.get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    async writeFile(path, content) {
      state.files.set(path, content);
    },
  };
}

function makeState(relativePaths: string[]): MockFsState {
  const files = new Map<string, string>();
  for (const rel of relativePaths) {
    files.set(`${SRC_BASE}/${rel}`, 'content');
  }
  return { dirs: new Set(), files };
}

function makeRequest(overrides: Partial<CloneRequest> = {}): CloneRequest {
  return {
    source: { type: 'local', path: SRC_BASE },
    workspaceRoot: ALLOWED_WORKSPACE,
    runId: 'run-prop-test',
    ...overrides,
  };
}

function makeService(state: MockFsState): TemplateCloningService {
  return new TemplateCloningService(makeMockFs(state), testConfig);
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const safeSegment = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), {
    minLength: 1,
    maxLength: 12,
  })
  .filter((s) => s !== '..' && s !== '.');

const dotFileName = fc.constantFrom(
  '.gitignore',
  '.env.example',
  '.eslintrc',
  '.prettierrc',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
);

const regularFileName = safeSegment.chain((name) =>
  fc.constantFrom('.ts', '.js', '.json', '.md', '.yml', '.css').map((ext) => `${name}${ext}`)
);

const relativeFilePath = fc.oneof(
  regularFileName,
  fc.tuple(safeSegment, regularFileName).map(([dir, file]) => `${dir}/${file}`),
  fc.tuple(safeSegment, safeSegment, regularFileName).map(
    ([d1, d2, file]) => `${d1}/${d2}/${file}`
  ),
  dotFileName,
);

/** Non-empty array of unique relative file paths */
const fileTreeArb = fc
  .array(relativeFilePath, { minLength: 1, maxLength: 30 })
  .map((paths) => [...new Set(paths)])
  .filter((paths) => paths.length > 0);

// ── Property 1: File count invariant ─────────────────────────────────────────

describe('Property 1 — file count invariant', () => {
  it('cloned tree always has the same number of files as the source tree', async () => {
    await fc.assert(
      fc.asyncProperty(fileTreeArb, async (relativePaths) => {
        const state = makeState(relativePaths);
        const svc = makeService(state);
        const result = await svc.clone(makeRequest());

        expect(result.success).toBe(true);

        const ws = result.workspacePath!;
        const clonedCount = Array.from(state.files.keys()).filter((p) =>
          p.startsWith(ws + '/')
        ).length;

        expect(clonedCount).toBe(relativePaths.length);
      }),
      { numRuns: 200 }
    );
  });
});

// ── Property 2: Relative path structure preserved (no absolute path leakage) ─

describe('Property 2 — relative path structure preserved', () => {
  it('every file in the clone exists at the same relative path as in the source', async () => {
    await fc.assert(
      fc.asyncProperty(fileTreeArb, async (relativePaths) => {
        const state = makeState(relativePaths);
        const svc = makeService(state);
        const result = await svc.clone(makeRequest());

        expect(result.success).toBe(true);

        const ws = result.workspacePath!;

        for (const rel of relativePaths) {
          const destPath = `${ws}/${rel}`;
          expect(state.files.has(destPath)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ── Property 3: Dot-file handling ────────────────────────────────────────────

describe('Property 3 — dot-file handling', () => {
  it('dot-files are cloned alongside regular files without being dropped', async () => {
    const treeWithDotFiles = fc
      .tuple(
        fc.array(regularFileName, { minLength: 0, maxLength: 10 }),
        fc.array(dotFileName, { minLength: 1, maxLength: 5 }),
      )
      .map(([regular, dots]) => [...new Set([...regular, ...dots])]);

    await fc.assert(
      fc.asyncProperty(treeWithDotFiles, async (relativePaths) => {
        const state = makeState(relativePaths);
        const svc = makeService(state);
        const result = await svc.clone(makeRequest());

        expect(result.success).toBe(true);

        const ws = result.workspacePath!;
        const dotFiles = relativePaths.filter((p) => nodePath.basename(p).startsWith('.'));

        for (const dotFile of dotFiles) {
          expect(state.files.has(`${ws}/${dotFile}`)).toBe(true);
        }
      }),
      { numRuns: 200 }
    );
  });
});

// ── Property 4: Zero files ────────────────────────────────────────────────────

describe('Property 4 — zero-file source', () => {
  it('empty source tree returns success with no files in workspace', async () => {
    const state: MockFsState = { dirs: new Set(), files: new Map() };
    const svc = makeService(state);
    const result = await svc.clone(makeRequest());

    expect(result.success).toBe(true);
    expect(result.workspacePath).toBeDefined();
    expect(result.errors).toHaveLength(0);

    const ws = result.workspacePath!;
    const clonedFiles = Array.from(state.files.keys()).filter((p) =>
      p.startsWith(ws + '/')
    );
    expect(clonedFiles).toHaveLength(0);
  });
});

// ── Property 5: Path traversal entries are rejected ───────────────────────────

describe('Property 5 — path traversal protection', () => {
  it('readdir entries containing ../ are skipped with a warning; safe files are still cloned', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(regularFileName, { minLength: 1, maxLength: 10 }),
        fc.array(
          fc.constantFrom(
            '../../../etc/passwd',
            '../../secret.key',
            '../outside.ts',
            './../sneaky.json',
          ),
          { minLength: 1, maxLength: 3 }
        ),
        async (safeFiles, traversalEntries) => {
          const safeFileSet = [...new Set(safeFiles)];
          const files = new Map<string, string>();
          for (const rel of safeFileSet) {
            files.set(`${SRC_BASE}/${rel}`, 'safe-content');
          }

          const allEntries = [...safeFileSet, ...traversalEntries];

          const mockFs: FileSystemAdapter = {
            async mkdir(_p) {
              /* no-op */
            },
            async readdir() {
              return allEntries;
            },
            async copyFile(src, dest) {
              files.set(dest, files.get(src) ?? '');
            },
            async exists() {
              return false;
            },
            async readFile(path) {
              const c = files.get(path);
              if (c === undefined) throw new Error(`not found: ${path}`);
              return c;
            },
            async writeFile(path, content) {
              files.set(path, content);
            },
          };

          const svc = new TemplateCloningService(mockFs, testConfig);
          const result = await svc.clone(makeRequest());

          expect(result.success).toBe(true);
          expect(result.errors.some((e) => e.severity === 'warning')).toBe(true);

          const ws = result.workspacePath!;
          for (const safe of safeFileSet) {
            expect(files.has(`${ws}/${safe}`)).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('runId containing ../ is always rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('../escape', 'a/../b', '../../root', 'x/..'),
        async (maliciousRunId) => {
          const state: MockFsState = { dirs: new Set(), files: new Map() };
          const svc = makeService(state);
          const result = await svc.clone(makeRequest({ runId: maliciousRunId }));

          expect(result.success).toBe(false);
          expect(result.errors[0].severity).toBe('error');
          expect(result.workspacePath).toBeUndefined();
        }
      ),
      { numRuns: 50 }
    );
  });
});
